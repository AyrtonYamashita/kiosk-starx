package com.pstarx.kiosk.kiosk

import android.app.ActivityManager
import android.app.AlarmManager
import android.app.PendingIntent
import android.app.admin.DevicePolicyManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.os.UserManager
import android.provider.Settings
import android.util.Log
import com.pstarx.kiosk.admin.AdminReceiver
import com.pstarx.kiosk.admin.DeviceOwner
import com.pstarx.kiosk.config.ConfigStore
import com.pstarx.kiosk.config.KioskConfig

/**
 * Leva o aparelho ao estado que a configuração pede (idempotente; roda no boot, ao salvar a configuração, quando
 * apps são instalados/removidos e no começo/fim de uma sessão de administração):
 *  - restrições de segurança (valem com o kiosk ligado ou não);
 *  - kiosk ligado: KioskActivity vira o launcher (addPersistentPreferredActivity) e roda em lock task; só o app,
 *    os apps da grade (e este app) rodam; barra de status, Home e menu de energia conforme a configuração;
 *  - kiosk desligado: tudo volta ao normal (launcher do aparelho, ajustes de tela originais).
 */
class KioskController private constructor(context: Context) {
    private val ctx = context.applicationContext
    val store = ConfigStore.get(ctx)
    private val dpm = ctx.getSystemService(DevicePolicyManager::class.java)
    private val admin = AdminReceiver.component(ctx)
    private val kioskComponent = ComponentName(ctx, KioskActivity::class.java)
    private val prefs = ctx.getSharedPreferences("kiosk_state", Context.MODE_PRIVATE)
    private val main = Handler(Looper.getMainLooper())
    private val listeners = mutableSetOf<() -> Unit>()

    /** Sessão de administração (depois do PIN): libera Configurações do Android e o seletor de arquivos. */
    @Volatile private var adminSessionUntilMs = 0L
    /** Uptime em que a administração terminou: a tela do kiosk reabre o app sem contar como queda. */
    @Volatile var adminClosedAtUptime = 0L
        private set

    val config: KioskConfig get() = store.config
    val isDeviceOwner: Boolean get() = DeviceOwner.isDeviceOwner(ctx)

    /** Kiosk aplicado agora (launcher do kiosk habilitado). */
    val enforced: Boolean
        get() = ctx.packageManager.getComponentEnabledSetting(kioskComponent) == PackageManager.COMPONENT_ENABLED_STATE_ENABLED

    val inLockTask: Boolean
        get() = ctx.getSystemService(ActivityManager::class.java).lockTaskModeState != ActivityManager.LOCK_TASK_MODE_NONE

    val adminSessionActive: Boolean get() = System.currentTimeMillis() < adminSessionUntilMs

    @Synchronized
    fun apply(trigger: String) {
        if (!isDeviceOwner) {
            Log.w(TAG, "Não é Device Owner: nada a aplicar ($trigger)")
            notifyListeners()
            return
        }
        val c = config
        val wasEnforced = enforced
        try {
            applySecurity(c)
            if (c.kiosk.enabled) enforce(c, bringToFront = trigger == "config") else release(wasEnforced)
        } catch (e: Exception) {
            Log.e(TAG, "Falha aplicando a configuração ($trigger)", e)
        }
        if (c.kiosk.enabled != wasEnforced) Log.i(TAG, "Kiosk ${if (c.kiosk.enabled) "ativado" else "desativado"} ($trigger)")
        main.post { CornerOverlay.update(ctx) }
        notifyListeners()
    }

    // ---------------------------------------------------------------- administração

    fun beginAdminSession() {
        adminSessionUntilMs = System.currentTimeMillis() + ADMIN_SESSION_MS
        scheduleAdminSessionEnd()
        apply("admin_session")
    }

    fun endAdminSession() {
        adminClosedAtUptime = SystemClock.uptimeMillis()
        if (adminSessionUntilMs == 0L) return
        adminSessionUntilMs = 0L
        apply("admin_session_end")
    }

    /** Remove o Device Owner: desfaz kiosk e restrições antes (o aparelho fica como um aparelho comum). */
    @Synchronized
    fun removeDeviceOwner(): String? {
        if (!isDeviceOwner) return "o app não é Device Owner"
        return try {
            release(wasEnforced = enforced)
            for ((restriction, _) in RESTRICTIONS) dpm.clearUserRestriction(admin, restriction)
            dpm.setKeyguardDisabled(admin, false)
            dpm.setStatusBarDisabled(admin, false)
            @Suppress("DEPRECATION")
            dpm.clearDeviceOwnerApp(ctx.packageName)
            Log.i(TAG, "Device Owner removido")
            notifyListeners()
            null
        } catch (e: Exception) {
            Log.e(TAG, "Falha ao remover o Device Owner", e)
            e.message ?: e.javaClass.simpleName
        }
    }

    // ---------------------------------------------------------------- aplicação

    private fun applySecurity(c: KioskConfig) {
        val s = c.security
        for ((restriction, wanted) in RESTRICTIONS) {
            if (wanted(s)) dpm.addUserRestriction(admin, restriction) else dpm.clearUserRestriction(admin, restriction)
        }
        // só funciona sem senha/padrão de bloqueio definido
        runCatching { dpm.setKeyguardDisabled(admin, s.disableLockScreen && c.kiosk.enabled) }
    }

    private fun enforce(c: KioskConfig, bringToFront: Boolean) {
        val packages = (listOf(ctx.packageName) + c.kioskPackages() + if (adminSessionActive) adminSessionPackages() else emptyList()).distinct()
        dpm.setLockTaskPackages(admin, packages.toTypedArray())
        setLockTaskFeatures(c)
        ctx.packageManager.setComponentEnabledSetting(kioskComponent, PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP)
        dpm.addPersistentPreferredActivity(admin, homeFilter(), kioskComponent)
        dpm.setStatusBarDisabled(admin, !c.security.allowNotifications)
        applyScreen(c)

        if (!inLockTask || bringToFront) {
            // Device Owner pode abrir activity a partir de segundo plano (exceção do Android 10+)
            ctx.startActivity(homeIntent())
        }
    }

    /**
     * Abre a tela do kiosk **como home** (ação MAIN + categoria HOME). Aberta com um intent comum, ela vira uma
     * tarefa "standard" e o Android continua com o launcher antigo como home: quando o app do kiosk cai, o
     * launcher do sistema aparece (visto no C6000). Sem componente explícito: no Android 10 um intent de HOME com
     * componente só vira home se vier do sistema; sem ele, a resolução cai na preferência persistente (o kiosk).
     */
    fun homeIntent(): Intent = Intent(Intent.ACTION_MAIN)
        .addCategory(Intent.CATEGORY_HOME)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    private fun setLockTaskFeatures(c: KioskConfig) {
        var f = 0
        if (c.display.showStatusBar || c.security.allowNotifications) f = f or DevicePolicyManager.LOCK_TASK_FEATURE_SYSTEM_INFO
        if (c.security.allowPowerMenu) f = f or DevicePolicyManager.LOCK_TASK_FEATURE_GLOBAL_ACTIONS
        // grade: o botão Home volta para a grade. Notificações exigem Home (regra do Android).
        val home = c.kiosk.mode == KioskConfig.Mode.APPS || c.security.allowNotifications
        if (home) f = f or DevicePolicyManager.LOCK_TASK_FEATURE_HOME
        if (c.security.allowNotifications) f = f or DevicePolicyManager.LOCK_TASK_FEATURE_NOTIFICATIONS
        try {
            dpm.setLockTaskFeatures(admin, f)
        } catch (e: IllegalArgumentException) {
            Log.w(TAG, "Combinação de recursos do lock task recusada ($f): ${e.message}")
            dpm.setLockTaskFeatures(admin, f and DevicePolicyManager.LOCK_TASK_FEATURE_GLOBAL_ACTIONS)
        }
    }

    private fun release(wasEnforced: Boolean) {
        restoreScreen(keep = null)
        if (!wasEnforced) return
        // a KioskActivity sai do lock task e fecha ao ser notificada; esvaziar a lista encerra o lock task de vez
        notifyListeners()
        dpm.clearPackagePersistentPreferredActivities(admin, ctx.packageName)
        dpm.setLockTaskPackages(admin, emptyArray())
        dpm.setStatusBarDisabled(admin, false)
        ctx.packageManager.setComponentEnabledSetting(kioskComponent, PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP)
        runCatching {
            ctx.startActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }

    private fun homeFilter() = IntentFilter(Intent.ACTION_MAIN).apply {
        addCategory(Intent.CATEGORY_HOME)
        addCategory(Intent.CATEGORY_DEFAULT)
    }

    /** Pacotes que atendem Configurações, Wi-Fi e o seletor de arquivos (importar/exportar). */
    private fun adminSessionPackages(): List<String> {
        val pm = ctx.packageManager
        val intents = listOf(
            Intent(Settings.ACTION_SETTINGS),
            Intent(Settings.ACTION_WIFI_SETTINGS),
            Intent(Settings.Panel.ACTION_WIFI),
            Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION),
            Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*"),
            Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/json"),
        )
        val resolved = intents.flatMap { i -> pm.queryIntentActivities(i, 0).map { it.activityInfo.packageName } }
        return (resolved + listOf("com.android.settings", "com.android.documentsui", "com.google.android.documentsui")).distinct()
    }

    private fun scheduleAdminSessionEnd() {
        val am = ctx.getSystemService(AlarmManager::class.java)
        val pi = PendingIntent.getBroadcast(
            ctx, 0, Intent(ctx, AdminSessionEnd::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, adminSessionUntilMs + 1_000, pi)
    }

    /** Fim do prazo da sessão de administração (caso a tela de configurações tenha ficado aberta). */
    class AdminSessionEnd : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val c = get(context)
            if (!c.adminSessionActive) c.apply("admin_session_expired")
        }
    }

    // ---------------------------------------------------------------- tela

    /** Tela sempre ligada / brilho fixo enquanto o kiosk estiver ativo. Desligado, volta ao valor original. */
    private fun applyScreen(c: KioskConfig) {
        val cr = ctx.contentResolver
        if (c.display.keepScreenOn) {
            saveOriginal(Settings.System.SCREEN_OFF_TIMEOUT, Settings.System.getString(cr, Settings.System.SCREEN_OFF_TIMEOUT))
            dpm.setSystemSetting(admin, Settings.System.SCREEN_OFF_TIMEOUT, Int.MAX_VALUE.toString())
        }
        c.display.brightness?.let { pct ->
            saveOriginal(Settings.System.SCREEN_BRIGHTNESS_MODE, Settings.System.getString(cr, Settings.System.SCREEN_BRIGHTNESS_MODE))
            saveOriginal(Settings.System.SCREEN_BRIGHTNESS, Settings.System.getString(cr, Settings.System.SCREEN_BRIGHTNESS))
            dpm.setSystemSetting(admin, Settings.System.SCREEN_BRIGHTNESS_MODE, Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL.toString())
            dpm.setSystemSetting(admin, Settings.System.SCREEN_BRIGHTNESS, (pct * 255 / 100).coerceIn(1, 255).toString())
        }
        restoreScreen(keep = c)
    }

    private fun restoreScreen(keep: KioskConfig?) {
        val restore = buildList {
            if (keep?.display?.keepScreenOn != true) add(Settings.System.SCREEN_OFF_TIMEOUT)
            if (keep?.display?.brightness == null) {
                add(Settings.System.SCREEN_BRIGHTNESS)
                add(Settings.System.SCREEN_BRIGHTNESS_MODE)
            }
        }
        for (key in restore) {
            val k = "orig_$key"
            if (!prefs.contains(k)) continue
            val value = prefs.getString(k, null)
            prefs.edit().remove(k).apply()
            if (value != null && value != NULL_MARK) runCatching { dpm.setSystemSetting(admin, key, value) }
        }
    }

    /** Valor original de um ajuste do sistema, gravado só na primeira vez que o kiosk o altera. */
    private fun saveOriginal(key: String, value: String?) {
        val k = "orig_$key"
        if (!prefs.contains(k)) prefs.edit().putString(k, value ?: NULL_MARK).apply()
    }

    // ---------------------------------------------------------------- avisos para as telas

    fun addListener(l: () -> Unit) = synchronized(listeners) { listeners += l }
    fun removeListener(l: () -> Unit) = synchronized(listeners) { listeners -= l }

    private fun notifyListeners() {
        val copy = synchronized(listeners) { listeners.toList() }
        main.post { copy.forEach { it() } }
    }

    companion object {
        private const val TAG = "Kiosk"
        private const val ADMIN_SESSION_MS = 10 * 60_000L
        private const val NULL_MARK = "\u0000null"

        /** Restrição do Android → se a configuração pede. */
        private val RESTRICTIONS: List<Pair<String, (KioskConfig.Security) -> Boolean>> = listOf(
            UserManager.DISALLOW_FACTORY_RESET to { it.blockFactoryReset },
            UserManager.DISALLOW_SAFE_BOOT to { it.blockSafeBoot },
            UserManager.DISALLOW_USB_FILE_TRANSFER to { it.blockUsbFileTransfer },
            UserManager.DISALLOW_DEBUGGING_FEATURES to { it.blockDebugging },
        )

        @Volatile private var instance: KioskController? = null

        fun get(context: Context): KioskController =
            instance ?: synchronized(this) { instance ?: KioskController(context).also { instance = it } }
    }
}
