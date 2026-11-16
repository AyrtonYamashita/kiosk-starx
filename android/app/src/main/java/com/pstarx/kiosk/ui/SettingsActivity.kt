package com.pstarx.kiosk.ui

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.ResolveInfo
import android.graphics.Color
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import com.pstarx.kiosk.BuildConfig
import com.pstarx.kiosk.admin.AdminReceiver
import com.pstarx.kiosk.admin.DeviceOwner
import com.pstarx.kiosk.config.ConfigPatch
import com.pstarx.kiosk.config.KioskConfig
import com.pstarx.kiosk.device.DeviceInfo
import com.pstarx.kiosk.kiosk.CornerOverlay
import com.pstarx.kiosk.kiosk.KioskController
import com.pstarx.kiosk.panel.PanelClient
import com.pstarx.kiosk.panel.PanelStore
import com.pstarx.kiosk.panel.PanelSync
import com.pstarx.kiosk.security.Pin
import org.json.JSONObject
import kotlin.concurrent.thread

/**
 * Configurações do kiosk no próprio aparelho (aberta pelo gesto no canto + PIN).
 * Edita uma cópia da configuração; "Salvar" grava e aplica. Abas: Geral, Tela, Segurança, Avançado.
 */
class SettingsActivity : Activity() {
    private lateinit var kiosk: KioskController
    private lateinit var saved: KioskConfig
    private lateinit var draft: KioskConfig
    private var tab = Tab.GENERAL
    private lateinit var tabs: LinearLayout
    private lateinit var content: LinearLayout
    private lateinit var status: TextView
    private lateinit var statusPill: LinearLayout
    /** Cartão em que as próximas linhas entram (cada seção abre um novo). */
    private var card: LinearLayout? = null

    private enum class Tab(val label: String) { GENERAL("Geral"), DISPLAY("Tela"), SECURITY("Segurança"), ADVANCED("Avançado") }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        kiosk = KioskController.get(this)
        saved = kiosk.config
        draft = saved
        window.decorView.setBackgroundColor(Theme.CANVAS)
        val d = { v: Int -> Ui.dp(this, v) }

        status = Ui.text(this, "", Theme.Type.CAPTION, Theme.SOFT)
        statusPill = LinearLayout(this)
        tabs = LinearLayout(this)
        content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(d(16), d(4), d(16), d(24))
        }

        // cabeçalho de página: título 24/600 + pílula de estado; contexto 11 cinza
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(d(16), d(20), d(16), d(12))
            addView(LinearLayout(this@SettingsActivity).apply {
                gravity = Gravity.CENTER_VERTICAL
                addView(Ui.text(this@SettingsActivity, "Configurações do kiosk", Theme.Type.PAGE_TITLE), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
                addView(statusPill)
            })
            addView(status.apply { setPadding(0, d(4), 0, d(14)) })
            addView(tabs)
        }
        // barra de ações: superfície branca com contorno de 1dp no topo
        val bottom = LinearLayout(this).apply {
            gravity = Gravity.END or Gravity.CENTER_VERTICAL
            setPadding(d(16), d(10), d(16), d(10))
            background = android.graphics.drawable.LayerDrawable(
                arrayOf(android.graphics.drawable.ColorDrawable(Theme.LINE), android.graphics.drawable.ColorDrawable(Theme.SURFACE)),
            ).apply { setLayerInset(1, 0, d(1).coerceAtLeast(1), 0, 0) }
            addView(Ui.button(this@SettingsActivity, "Fechar") { close() })
            addView(Ui.button(this@SettingsActivity, "Salvar", Ui.Variant.PRIMARY) { save() },
                LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginStart = d(8) })
        }
        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(header)
            addView(View(this@SettingsActivity).apply { setBackgroundColor(Theme.RULE) }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, d(1).coerceAtLeast(1)))
            addView(ScrollView(this@SettingsActivity).apply { addView(content) }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
            addView(bottom)
        })
        render()
    }

    override fun onResume() {
        super.onResume()
        CornerOverlay.update(this)
        render()
    }

    override fun onDestroy() {
        if (isFinishing) kiosk.endAdminSession()
        super.onDestroy()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() = close()

    // ---------------------------------------------------------------- estrutura

    private fun updateStatus() {
        val meta = kiosk.store.meta
        val (label, tone) = when {
            !kiosk.isDeviceOwner -> "não é Device Owner" to Ui.Tone.BAD
            kiosk.enforced -> "kiosk ativo" to Ui.Tone.GOOD
            else -> "kiosk desligado" to Ui.Tone.NEUTRAL
        }
        statusPill.removeAllViews()
        statusPill.addView(Ui.statusPill(this, label, tone))
        status.text = "Configuração rev ${meta.revision}${meta.source?.let { " · origem $it" } ?: ""}" +
            if (draft != saved) " · alterações não salvas" else ""
        status.setTextColor(if (draft != saved) Theme.WARN_DEEP else Theme.SOFT)
    }

    private fun render() {
        updateStatus()
        tabs.removeAllViews()
        tabs.addView(Ui.segmented(this, Tab.entries.map { it.label }, Tab.entries.indexOf(tab)) { i -> tab = Tab.entries[i]; render() })
        content.removeAllViews()
        card = null
        if (!kiosk.isDeviceOwner) {
            loose(Ui.banner(
                this,
                "O app não é Device Owner: o kiosk e as restrições não funcionam. Num aparelho sem contas, rode:\n" +
                    "adb shell dpm set-device-owner $packageName/.admin.AdminReceiver",
                critical = true,
            ))
        }
        if (PanelStore.get(this).state.let { it.enrolled && it.appliedHash != null }) {
            loose(Ui.banner(
                this,
                "Este aparelho segue a configuração do painel. O que você mudar aqui vale até o painel mudar o perfil ou reaplicar a configuração.",
            ))
        }
        when (tab) {
            Tab.GENERAL -> general()
            Tab.DISPLAY -> display()
            Tab.SECURITY -> security()
            Tab.ADVANCED -> advanced()
        }
    }

    private fun edit(block: (KioskConfig) -> KioskConfig, rerender: Boolean = false) {
        draft = block(draft)
        if (rerender) render() else updateStatus()
    }

    /** Linha no cartão atual (abre um, se preciso); linhas do mesmo cartão são separadas por uma divisória. */
    private fun add(v: View) {
        val c = card ?: Ui.card(this).also {
            card = it
            content.addView(it, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                topMargin = if (content.childCount > 0 && content.getChildAt(content.childCount - 1) is TextView) 0 else Ui.dp(this@SettingsActivity, 12)
            })
        }
        if (c.childCount > 0) c.addView(Ui.divider(this))
        c.addView(v)
    }

    /** Rótulo de seção; as linhas seguintes vão para um cartão novo logo abaixo. */
    private fun section(title: String) {
        content.addView(Ui.section(this, title))
        card = null
    }

    /** Fora dos cartões (avisos). */
    private fun loose(v: View) {
        content.addView(v, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = Ui.dp(this@SettingsActivity, 12) })
        card = null
    }

    // ---------------------------------------------------------------- Geral

    private fun general() {
        val k = draft.kiosk
        add(Ui.switchRow(this, "Kiosk ligado", "Desligado, o aparelho funciona normalmente", k.enabled) { on -> edit({ it.copy(kiosk = it.kiosk.copy(enabled = on)) }) })
        section("Modo")
        add(Ui.pills(this, KioskConfig.Mode.entries.map { it.label }, KioskConfig.Mode.entries.indexOf(k.mode)) { i ->
            edit({ it.copy(kiosk = it.kiosk.copy(mode = KioskConfig.Mode.entries[i])) }, rerender = true)
        })
        when (k.mode) {
            KioskConfig.Mode.APP -> {
                section("App único")
                add(Ui.row(this, "App", k.app?.let { "${label(it)} ($it)" } ?: "Nenhum: toque para escolher") { pickSingleApp() })
                add(Ui.slider(this, "Reabrir o app depois de fechar", k.relaunchDelaySec, 0..30, " s") { v -> edit({ it.copy(kiosk = it.kiosk.copy(relaunchDelaySec = v)) }) })
                add(Ui.note(this, "Se o app cair 5 vezes em 2 minutos, o kiosk espera 30 s antes de abrir de novo."))
            }
            KioskConfig.Mode.APPS -> {
                section("Apps da grade")
                add(Ui.row(this, "Escolher apps", if (k.apps.isEmpty()) "Nenhum" else k.apps.joinToString("\n") { "${label(it)} ($it)" }) { pickApps() })
                add(Ui.note(this, "O botão Home volta para a grade."))
            }
            KioskConfig.Mode.WEB -> {
                section("Site")
                add(Ui.labeled(this, "URL", Ui.textField(this, "https://…", k.web.url) { v -> edit({ it.copy(kiosk = it.kiosk.copy(web = it.kiosk.web.copy(url = v.trim()))) }) }))
                add(Ui.labeled(this, "Recarregar após erro (segundos, 0 = não)", Ui.textField(this, "15", k.web.reloadOnErrorSec.toString(), numeric = true) { v ->
                    edit({ it.copy(kiosk = it.kiosk.copy(web = it.kiosk.web.copy(reloadOnErrorSec = v.toIntOrNull()?.coerceIn(0, 3600) ?: 0))) })
                }))
                add(Ui.labeled(this, "Voltar à página inicial após inatividade (segundos, 0 = nunca)", Ui.textField(this, "0", k.web.inactivityReturnSec.toString(), numeric = true) { v ->
                    edit({ it.copy(kiosk = it.kiosk.copy(web = it.kiosk.web.copy(inactivityReturnSec = v.toIntOrNull()?.coerceIn(0, 86_400) ?: 0))) })
                }))
                add(Ui.switchRow(this, "Permitir zoom", null, k.web.allowZoom) { on -> edit({ it.copy(kiosk = it.kiosk.copy(web = it.kiosk.web.copy(allowZoom = on))) }) })
            }
        }
    }

    private fun launchableApps(): List<ResolveInfo> =
        packageManager.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0)
            .filter { it.activityInfo.packageName != packageName }
            .distinctBy { it.activityInfo.packageName }
            .sortedBy { it.loadLabel(packageManager).toString().lowercase() }

    private fun label(pkg: String): String =
        runCatching { packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString() }.getOrDefault("não instalado")

    private fun pickSingleApp() {
        val apps = launchableApps()
        val names = apps.map { "${it.loadLabel(packageManager)}\n${it.activityInfo.packageName}" }.toTypedArray()
        val current = apps.indexOfFirst { it.activityInfo.packageName == draft.kiosk.app }
        AlertDialog.Builder(this)
            .setTitle("App do kiosk")
            .setSingleChoiceItems(names, current) { d, which ->
                edit({ it.copy(kiosk = it.kiosk.copy(app = apps[which].activityInfo.packageName)) }, rerender = true)
                d.dismiss()
            }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    private fun pickApps() {
        val apps = launchableApps()
        val pkgs = apps.map { it.activityInfo.packageName }
        val names = apps.map { "${it.loadLabel(packageManager)}\n${it.activityInfo.packageName}" }.toTypedArray()
        val checked = pkgs.map { it in draft.kiosk.apps }.toBooleanArray()
        AlertDialog.Builder(this)
            .setTitle("Apps da grade")
            .setMultiChoiceItems(names, checked) { _, which, isChecked -> checked[which] = isChecked }
            .setPositiveButton("OK") { _, _ ->
                val selected = pkgs.filterIndexed { i, _ -> checked[i] }
                // mantém a ordem atual e acrescenta os novos no fim; preserva apps ainda não instalados
                val kept = draft.kiosk.apps.filter { it in selected || it !in pkgs }
                edit({ it.copy(kiosk = it.kiosk.copy(apps = kept + selected.filter { p -> p !in kept })) }, rerender = true)
            }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    // ---------------------------------------------------------------- Tela

    private fun display() {
        val d = draft.display
        val a = draft.appearance
        add(Ui.switchRow(this, "Manter a tela ligada", "Durante o kiosk", d.keepScreenOn) { on -> edit({ it.copy(display = it.display.copy(keepScreenOn = on)) }) })
        add(Ui.switchRow(this, "Brilho fixo", "Desligado, o brilho fica como está no aparelho", d.brightness != null) { on ->
            edit({ it.copy(display = it.display.copy(brightness = if (on) 80 else null)) }, rerender = true)
        })
        d.brightness?.let { b -> add(Ui.slider(this, "Brilho", b, 0..100, "%") { v -> edit({ it.copy(display = it.display.copy(brightness = v)) }) }) }
        add(Ui.switchRow(this, "Barra de status", "Hora, bateria e rede visíveis no kiosk", d.showStatusBar) { on -> edit({ it.copy(display = it.display.copy(showStatusBar = on)) }) })
        section("Orientação (grade e site)")
        add(Ui.pills(this, KioskConfig.Orientation.entries.map { it.label }, KioskConfig.Orientation.entries.indexOf(d.orientation)) { i ->
            edit({ it.copy(display = it.display.copy(orientation = KioskConfig.Orientation.entries[i])) }, rerender = true)
        })
        section("Aparência")
        add(Ui.labeled(this, "Título (aparece no topo da grade)", Ui.textField(this, "Ex.: Expedição", a.title) { v -> edit({ it.copy(appearance = it.appearance.copy(title = v.take(80))) }) }))
        add(Ui.labeled(this, "Cor de fundo (#RRGGBB)", Ui.textField(this, "#001425", a.backgroundColor) { v ->
            if (COLOR.matches(v.trim())) edit({ it.copy(appearance = it.appearance.copy(backgroundColor = v.trim().uppercase())) })
        }))
        add(Ui.labeled(this, "Cor do texto (#RRGGBB)", Ui.textField(this, "#FFFFFF", a.textColor) { v ->
            if (COLOR.matches(v.trim())) edit({ it.copy(appearance = it.appearance.copy(textColor = v.trim().uppercase())) })
        }))
        add(Ui.slider(this, "Colunas da grade", a.columns, 2..8, "") { v -> edit({ it.copy(appearance = it.appearance.copy(columns = v)) }) })
    }

    // ---------------------------------------------------------------- Segurança

    private fun security() {
        val s = draft.security
        section("Acesso às configurações")
        add(Ui.row(this, if (s.pinHash == null) "Definir PIN" else "Trocar PIN", if (s.pinHash == null) "⚠ Sem PIN: qualquer pessoa abre esta tela" else "PIN definido") { changePin() })
        if (s.pinHash != null) add(Ui.dangerRow(this, "Remover PIN", null) {
            AlertDialog.Builder(this).setTitle("Remover o PIN?").setMessage("Qualquer pessoa poderá abrir as configurações.")
                .setPositiveButton("Remover") { _, _ -> edit({ it.copy(security = it.security.copy(pinHash = null)) }, rerender = true) }
                .setNegativeButton("Cancelar", null).show()
        })
        add(Ui.row(this, "Canto do gesto", s.exitCorner.label) {
            val corners = KioskConfig.Corner.entries
            AlertDialog.Builder(this).setTitle("Canto do gesto")
                .setSingleChoiceItems(corners.map { it.label }.toTypedArray(), corners.indexOf(s.exitCorner)) { d, w ->
                    edit({ it.copy(security = it.security.copy(exitCorner = corners[w])) }, rerender = true)
                    d.dismiss()
                }.show()
        })
        add(Ui.slider(this, "Toques no canto", s.exitTaps, 3..10, "") { v -> edit({ it.copy(security = it.security.copy(exitTaps = v)) }) })
        add(Ui.note(this, "Toques rápidos (em até 2 s) no canto escolhido abrem o pedido de PIN. Sobre outros apps, depende da permissão \"Sobrepor a outros apps\" (aba Avançado)."))

        section("Durante o kiosk")
        add(Ui.switchRow(this, "Notificações", "Permite abrir a área de notificações", s.allowNotifications) { on -> edit({ it.copy(security = it.security.copy(allowNotifications = on)) }) })
        add(Ui.switchRow(this, "Menu do botão de energia", "Desligar/reiniciar pelo botão", s.allowPowerMenu) { on -> edit({ it.copy(security = it.security.copy(allowPowerMenu = on)) }) })
        add(Ui.switchRow(this, "Desativar tela de bloqueio", "Só funciona sem senha/padrão no aparelho", s.disableLockScreen) { on -> edit({ it.copy(security = it.security.copy(disableLockScreen = on)) }) })
        add(Ui.switchRow(this, "Atalhos do Android na administração", "Wi-Fi, Bluetooth e Configurações nesta tela", s.systemSettingsShortcuts) { on -> edit({ it.copy(security = it.security.copy(systemSettingsShortcuts = on)) }) })

        section("Restrições do aparelho (sempre)")
        add(Ui.switchRow(this, "Bloquear reset de fábrica", "Pelas configurações do Android", s.blockFactoryReset) { on -> edit({ it.copy(security = it.security.copy(blockFactoryReset = on)) }) })
        add(Ui.switchRow(this, "Bloquear modo de segurança", null, s.blockSafeBoot) { on -> edit({ it.copy(security = it.security.copy(blockSafeBoot = on)) }) })
        add(Ui.switchRow(this, "Bloquear transferência de arquivos por USB", null, s.blockUsbFileTransfer) { on -> edit({ it.copy(security = it.security.copy(blockUsbFileTransfer = on)) }) })
        add(Ui.switchRow(this, "Bloquear depuração USB", "Corta o acesso por ADB", s.blockDebugging) { on -> edit({ it.copy(security = it.security.copy(blockDebugging = on)) }) })
    }

    private fun changePin() {
        val ctx = this
        val p1 = Ui.input(ctx, "Novo PIN (mínimo 4)").apply { inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD }
        val p2 = Ui.input(ctx, "Repita o PIN").apply { inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD }
        val box = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(Ui.dp(ctx, 20), Ui.dp(ctx, 8), Ui.dp(ctx, 20), 0)
            addView(p1)
            addView(p2)
            addView(Ui.note(ctx, "Só números: teclado numérico na hora de digitar."))
        }
        val dialog = AlertDialog.Builder(ctx).setTitle("PIN de administrador").setView(box)
            .setPositiveButton("OK", null).setNegativeButton("Cancelar", null).create()
        dialog.setOnShowListener {
            val ok = dialog.getButton(AlertDialog.BUTTON_POSITIVE)
            ok.setOnClickListener {
                val pin = p1.text.toString()
                Pin.validate(pin)?.let { p1.error = it; return@setOnClickListener }
                if (pin != p2.text.toString()) { p2.error = "Os PINs não conferem"; return@setOnClickListener }
                ok.isEnabled = false
                thread {
                    val hash = Pin.hash(pin)
                    runOnUiThread {
                        edit({ it.copy(security = it.security.copy(pinHash = hash)) }, rerender = true)
                        dialog.dismiss()
                        toast("PIN alterado. Toque em Salvar para gravar.")
                    }
                }
            }
        }
        dialog.show()
    }

    // ---------------------------------------------------------------- Avançado

    private fun advanced() {
        val meta = kiosk.store.meta
        section("Sobre")
        add(Ui.note(this, "StarX Kiosk ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})\n" +
            "Device Owner: ${if (kiosk.isDeviceOwner) "sim" else "não"}\n" +
            "Configuração: rev ${meta.revision}, ${meta.updatedAt ?: "nunca salva"}${meta.source?.let { ", origem $it" } ?: ""}", Theme.INK).apply {
                typeface = Theme.typeface(this@SettingsActivity, Theme.Font.MONO, 400)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 11.5f)
            })
        add(Ui.row(this, "Informações do aparelho", "Serial, IMEI, bateria, rede, armazenamento") { deviceInfo() })

        panelSection()

        section("Gesto sobre outros apps")
        val overlay = CornerOverlay.canShow(this)
        add(Ui.row(this, "Permissão \"Sobrepor a outros apps\"", if (overlay) "Concedida" else "Não concedida: toque para abrir a tela do Android") {
            if (!overlay) startSafely(CornerOverlay.permissionIntent(this))
        })
        if (!overlay) add(Ui.note(this, "Ou por ADB: adb shell appops set $packageName SYSTEM_ALERT_WINDOW allow"))

        section("Arquivo de configuração")
        add(Ui.row(this, "Exportar", "Salva a configuração (com o hash do PIN) num arquivo .json") { exportConfig() })
        add(Ui.row(this, "Importar", "Carrega um .json exportado; confira e toque em Salvar") { importConfig() })
        add(Ui.row(this, "Ver JSON", "Configuração em edição (sem o hash do PIN)") { showJson() })
        add(Ui.row(this, "Configurar por ADB", "Comandos para aplicar a configuração pelo computador") { adbHelp() })

        if (draft.security.systemSettingsShortcuts) {
            section("Android")
            add(Ui.row(this, "Wi-Fi", null) { startSafely(Intent(Settings.ACTION_WIFI_SETTINGS)) })
            add(Ui.row(this, "Bluetooth", null) { startSafely(Intent(Settings.ACTION_BLUETOOTH_SETTINGS)) })
            add(Ui.row(this, "Todas as configurações", null) { startSafely(Intent(Settings.ACTION_SETTINGS)) })
        }

        section("Aparelho")
        add(Ui.row(this, "Reiniciar o aparelho", null) {
            confirm("Reiniciar o aparelho?", "Reiniciar") {
                runCatching { DeviceOwner.dpm(this).reboot(AdminReceiver.component(this)) }
                    .onFailure { toast("Não foi possível reiniciar: ${it.message}") }
            }
        })
        add(Ui.dangerRow(this, "Remover Device Owner", "Desfaz o kiosk e as restrições. Para voltar, só com ADB ou reset de fábrica.") {
            confirm("Remover o Device Owner?", "Remover") {
                val err = kiosk.removeDeviceOwner()
                if (err == null) { toast("Device Owner removido"); finish() } else toast("Falhou: $err")
            }
        })
    }

    // ---------------------------------------------------------------- painel

    private fun panelSection() {
        val s = PanelStore.get(this).state
        section("Painel")
        val status = when {
            s.enrolled -> buildString {
                append("Conectado como \"${s.name ?: "?"}\"\n${s.serverUrl}\n")
                append(if (s.lastOkAt > 0) "Último contato: ${ago(s.lastOkAt)}" else "Ainda sem contato")
                if (s.lastError != null && s.lastErrorAt > s.lastOkAt) append("\nÚltima falha (${ago(s.lastErrorAt)}): ${s.lastError}")
            }
            s.pendingCode != null -> "Cadastro pendente em ${s.pendingUrl} (tentando a cada 30 s)" + (s.lastError?.let { "\n$it" } ?: "")
            s.removed -> "⚠ Este aparelho foi removido do painel. Cadastre de novo para voltar a aparecer."
            else -> "Não conectado a um painel."
        }
        add(Ui.note(this, status, if (s.removed) Theme.BAD_DEEP else Theme.INK))
        add(Ui.row(this, if (s.enrolled) "Cadastrar de novo" else "Conectar ao painel", "Endereço do painel e código de cadastro") { enrollDialog(s.serverUrl ?: s.pendingUrl) })
        if (s.enrolled) {
            add(Ui.row(this, "Enviar dados agora", null) {
                thread {
                    val r = PanelClient(this).checkin()
                    runOnUiThread {
                        toast(if (r is PanelClient.Result.Ok) "Enviado" else (r as PanelClient.Result.Failed).message)
                        render()
                    }
                }
            })
            add(Ui.dangerRow(this, "Desconectar do painel", "O aparelho para de enviar dados (continua aparecendo no painel como offline)") {
                confirm("Desconectar do painel?", "Desconectar") {
                    PanelStore.get(this).clear()
                    PanelSync.schedule(this)
                    render()
                }
            })
        }
    }

    private fun enrollDialog(currentUrl: String?) {
        val ctx = this
        val url = Ui.input(ctx, "https://kiosk-api.empresa.com.br").apply { setText(currentUrl.orEmpty()); inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI }
        val code = Ui.input(ctx, "Código (10 letras/números)").apply { inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS }
        val box = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(Ui.dp(ctx, 20), Ui.dp(ctx, 8), Ui.dp(ctx, 20), 0)
            addView(url)
            addView(code)
            addView(Ui.note(ctx, "O código fica no painel, em Cadastro."))
        }
        val dialog = AlertDialog.Builder(ctx).setTitle("Conectar ao painel").setView(box)
            .setPositiveButton("Conectar", null).setNegativeButton("Cancelar", null).create()
        dialog.setOnShowListener {
            val ok = dialog.getButton(AlertDialog.BUTTON_POSITIVE)
            ok.setOnClickListener {
                if (PanelStore.normalizeUrl(url.text.toString()) == null) { url.error = "Endereço inválido"; return@setOnClickListener }
                if (code.text.isBlank()) { code.error = "Informe o código"; return@setOnClickListener }
                ok.isEnabled = false
                ok.text = "Conectando…"
                thread {
                    val r = PanelClient(ctx).enroll(url.text.toString(), code.text.toString())
                    PanelSync.schedule(ctx)
                    runOnUiThread {
                        ok.isEnabled = true
                        ok.text = "Conectar"
                        when (r) {
                            is PanelClient.Result.Ok -> { dialog.dismiss(); toast("Conectado: ${r.message}"); render() }
                            is PanelClient.Result.Failed -> code.error = r.message
                        }
                    }
                }
            }
        }
        dialog.show()
    }

    private fun ago(ms: Long): String {
        val s = (System.currentTimeMillis() - ms) / 1000
        return when {
            s < 60 -> "agora"
            s < 3600 -> "há ${s / 60} min"
            s < 172_800 -> "há ${s / 3600} h"
            else -> "há ${s / 86_400} d"
        }
    }

    private fun deviceInfo() {
        thread {
            val text = runCatching { DeviceInfo(this).summary() }.getOrElse { "Erro: ${it.message}" }
            runOnUiThread { AlertDialog.Builder(this).setTitle("Informações do aparelho").setMessage(text).setPositiveButton("OK", null).show() }
        }
    }

    private fun showJson() {
        val json = KioskConfig.pretty(KioskConfig.redacted(draft.toJson()))
        val tv = TextView(this).apply {
            text = json
            typeface = Theme.typeface(this@SettingsActivity, Theme.Font.MONO, 400)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 11.5f)
            setTextColor(Theme.INK)
            setTextIsSelectable(true)
            setPadding(Ui.dp(this@SettingsActivity, 16), Ui.dp(this@SettingsActivity, 8), Ui.dp(this@SettingsActivity, 16), 0)
        }
        AlertDialog.Builder(this).setTitle("Configuração").setView(ScrollView(this).apply { addView(tv) }).setPositiveButton("OK", null).show()
    }

    private fun adbHelp() {
        val text = """
            |Aplicar uma configuração (parcial ou completa):
            |
            |adb push kiosk.json /data/local/tmp/
            |adb shell 'am broadcast -n $packageName/.adb.AdbConfigReceiver -a $packageName.CONFIG --es pin 1234 --es config "${'$'}(cat /data/local/tmp/kiosk.json)"'
            |
            |Ler a configuração atual:
            |adb shell am broadcast -n $packageName/.adb.AdbConfigReceiver -a $packageName.CONFIG --es pin 1234 --ez dump true
            |
            |O resultado aparece na saída do comando (data=...). Sem PIN definido, o "pin" do comando vira o PIN do aparelho.
            |Detalhes: docs/configuracao.md no projeto.
        """.trimMargin()
        AlertDialog.Builder(this).setTitle("Configurar por ADB")
            .setView(ScrollView(this).apply { addView(Ui.note(this@SettingsActivity, text, Theme.INK).apply { typeface = Theme.typeface(this@SettingsActivity, Theme.Font.MONO, 400); setTextSize(TypedValue.COMPLEX_UNIT_SP, 11.5f) }) })
            .setPositiveButton("OK", null).show()
    }

    // ---------------------------------------------------------------- importar/exportar (seletor de arquivos do Android)

    private fun exportConfig() {
        val name = "kiosk-${Build.MODEL.replace(Regex("[^A-Za-z0-9]+"), "-").lowercase()}.json"
        val i = Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/json").putExtra(Intent.EXTRA_TITLE, name)
        startSafely(i, REQ_EXPORT)
    }

    private fun importConfig() {
        val i = Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*")
        startSafely(i, REQ_IMPORT)
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        val uri = data?.data
        if (resultCode != RESULT_OK || uri == null) return
        when (requestCode) {
            REQ_EXPORT -> try {
                contentResolver.openOutputStream(uri, "wt")!!.use { it.write(KioskConfig.pretty(draft.toJson()).toByteArray()) }
                toast("Configuração exportada")
            } catch (e: Exception) {
                toast("Falha ao exportar: ${e.message}")
            }
            REQ_IMPORT -> thread {
                val result = runCatching {
                    val text = contentResolver.openInputStream(uri)!!.use { it.readBytes().toString(Charsets.UTF_8) }
                    ConfigPatch.apply(draft.toJson(), JSONObject(text), replace = true)
                }
                runOnUiThread {
                    result.onSuccess { r ->
                        if (r.config == null) {
                            alert("Importação recusada", r.error ?: "erro")
                        } else {
                            draft = r.config
                            tab = Tab.GENERAL
                            render()
                            alert("Configuração carregada", (if (r.warnings.isEmpty()) "Sem avisos." else "Avisos:\n• " + r.warnings.joinToString("\n• ")) + "\n\nToque em Salvar para aplicar.")
                        }
                    }.onFailure { alert("Arquivo inválido", it.message ?: "não é um JSON") }
                }
            }
        }
    }

    // ---------------------------------------------------------------- salvar/fechar

    private fun save() {
        val warnings = KioskConfig.parse(draft.toJson()).warnings
        if (warnings.isNotEmpty() && draft.kiosk.enabled) {
            AlertDialog.Builder(this).setTitle("Conferir antes de salvar").setMessage("• " + warnings.joinToString("\n• "))
                .setPositiveButton("Salvar assim") { _, _ -> doSave() }.setNegativeButton("Voltar", null).show()
            return
        }
        doSave()
    }

    private fun doSave() {
        try {
            kiosk.store.save(draft, source = "local")
            saved = draft
            kiosk.endAdminSession()
            kiosk.apply("config")
            finish()
        } catch (e: Exception) {
            Log.e(TAG, "Falha ao salvar", e)
            alert("Não foi possível salvar", e.message ?: e.javaClass.simpleName)
        }
    }

    private fun close() {
        if (draft == saved) {
            finish()
            return
        }
        AlertDialog.Builder(this).setTitle("Descartar alterações?")
            .setPositiveButton("Descartar") { _, _ -> finish() }
            .setNegativeButton("Continuar editando", null).show()
    }

    // ---------------------------------------------------------------- utilidades

    private fun startSafely(intent: Intent, requestCode: Int? = null) {
        try {
            @Suppress("DEPRECATION")
            if (requestCode == null) startActivity(intent) else startActivityForResult(intent, requestCode)
        } catch (e: Exception) {
            toast("Não disponível neste aparelho")
        }
    }

    private fun confirm(title: String, action: String, block: () -> Unit) {
        AlertDialog.Builder(this).setTitle(title).setPositiveButton(action) { _, _ -> block() }.setNegativeButton("Cancelar", null).show()
    }

    private fun alert(title: String, msg: String) {
        AlertDialog.Builder(this).setTitle(title).setMessage(msg).setPositiveButton("OK", null).show()
    }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_LONG).show()

    private companion object {
        const val TAG = "Settings"
        const val REQ_EXPORT = 1
        const val REQ_IMPORT = 2
        val COLOR = Regex("^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$")
    }
}
