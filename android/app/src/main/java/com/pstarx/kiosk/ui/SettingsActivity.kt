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

    private enum class Tab(val label: String) { GENERAL("Geral"), DISPLAY("Tela"), SECURITY("Segurança"), ADVANCED("Avançado") }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        kiosk = KioskController.get(this)
        saved = kiosk.config
        draft = saved
        window.decorView.setBackgroundColor(Color.WHITE)

        status = Ui.note(this, "").apply { setTextIsSelectable(false); setPadding(Ui.dp(this@SettingsActivity, 16), 0, Ui.dp(this@SettingsActivity, 16), Ui.dp(this@SettingsActivity, 8)) }
        tabs = LinearLayout(this).apply { setPadding(Ui.dp(this@SettingsActivity, 12), 0, Ui.dp(this@SettingsActivity, 12), Ui.dp(this@SettingsActivity, 8)) }
        content = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }

        val title = TextView(this).apply {
            text = "Configurações do kiosk"
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.rgb(20, 20, 30))
            setPadding(Ui.dp(this@SettingsActivity, 16), Ui.dp(this@SettingsActivity, 16), Ui.dp(this@SettingsActivity, 16), Ui.dp(this@SettingsActivity, 2))
        }
        val bottom = LinearLayout(this).apply {
            gravity = Gravity.END
            setPadding(Ui.dp(this@SettingsActivity, 8), Ui.dp(this@SettingsActivity, 4), Ui.dp(this@SettingsActivity, 8), Ui.dp(this@SettingsActivity, 4))
            setBackgroundColor(Ui.SURFACE)
            addView(Button(this@SettingsActivity).apply { text = "Fechar"; setOnClickListener { close() } })
            addView(Button(this@SettingsActivity).apply { text = "Salvar"; setOnClickListener { save() } })
        }
        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(title)
            addView(status)
            addView(HorizontalScrollView(this@SettingsActivity).apply { isHorizontalScrollBarEnabled = false; addView(tabs) })
            addView(Ui.divider(this@SettingsActivity))
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
        val state = when {
            !kiosk.isDeviceOwner -> "⚠ não é Device Owner"
            kiosk.enforced -> "kiosk ativo"
            else -> "kiosk desligado"
        }
        status.text = "$state · configuração rev ${meta.revision}${meta.source?.let { " ($it)" } ?: ""}" +
            if (draft != saved) " · alterações não salvas" else ""
    }

    private fun render() {
        updateStatus()
        tabs.removeAllViews()
        for (t in Tab.entries) {
            tabs.addView(Ui.pill(this, t.label, t == tab) { tab = t; render() }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginEnd = Ui.dp(this@SettingsActivity, 8) })
        }
        content.removeAllViews()
        if (!kiosk.isDeviceOwner) {
            content.addView(Ui.note(
                this,
                "O app não é Device Owner: o kiosk e as restrições não funcionam. Num aparelho sem contas, rode:\n" +
                    "adb shell dpm set-device-owner $packageName/.admin.AdminReceiver",
                Ui.DANGER,
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

    private fun add(v: View) = content.addView(v)

    // ---------------------------------------------------------------- Geral

    private fun general() {
        val k = draft.kiosk
        add(Ui.switchRow(this, "Kiosk ligado", "Desligado, o aparelho funciona normalmente", k.enabled) { on -> edit({ it.copy(kiosk = it.kiosk.copy(enabled = on)) }) })
        add(Ui.section(this, "Modo"))
        add(Ui.pills(this, KioskConfig.Mode.entries.map { it.label }, KioskConfig.Mode.entries.indexOf(k.mode)) { i ->
            edit({ it.copy(kiosk = it.kiosk.copy(mode = KioskConfig.Mode.entries[i])) }, rerender = true)
        })
        when (k.mode) {
            KioskConfig.Mode.APP -> {
                add(Ui.section(this, "App único"))
                add(Ui.row(this, "App", k.app?.let { "${label(it)} ($it)" } ?: "Nenhum: toque para escolher") { pickSingleApp() })
                add(Ui.slider(this, "Reabrir o app depois de fechar", k.relaunchDelaySec, 0..30, " s") { v -> edit({ it.copy(kiosk = it.kiosk.copy(relaunchDelaySec = v)) }) })
                add(Ui.note(this, "Se o app cair 5 vezes em 2 minutos, o kiosk espera 30 s antes de abrir de novo."))
            }
            KioskConfig.Mode.APPS -> {
                add(Ui.section(this, "Apps da grade"))
                add(Ui.row(this, "Escolher apps", if (k.apps.isEmpty()) "Nenhum" else k.apps.joinToString("\n") { "${label(it)} ($it)" }) { pickApps() })
                add(Ui.note(this, "O botão Home volta para a grade."))
            }
            KioskConfig.Mode.WEB -> {
                add(Ui.section(this, "Site"))
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
        add(Ui.section(this, "Orientação (grade e site)"))
        add(Ui.pills(this, KioskConfig.Orientation.entries.map { it.label }, KioskConfig.Orientation.entries.indexOf(d.orientation)) { i ->
            edit({ it.copy(display = it.display.copy(orientation = KioskConfig.Orientation.entries[i])) }, rerender = true)
        })
        add(Ui.section(this, "Aparência"))
        add(Ui.labeled(this, "Título (aparece no topo da grade)", Ui.textField(this, "Ex.: Expedição", a.title) { v -> edit({ it.copy(appearance = it.appearance.copy(title = v.take(80))) }) }))
        add(Ui.labeled(this, "Cor de fundo (#RRGGBB)", Ui.textField(this, "#101828", a.backgroundColor) { v ->
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
        add(Ui.section(this, "Acesso às configurações"))
        add(Ui.row(this, if (s.pinHash == null) "Definir PIN" else "Trocar PIN", if (s.pinHash == null) "⚠ Sem PIN: qualquer pessoa abre esta tela" else "PIN definido") { changePin() })
        if (s.pinHash != null) add(Ui.row(this, "Remover PIN", null) {
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

        add(Ui.section(this, "Durante o kiosk"))
        add(Ui.switchRow(this, "Notificações", "Permite abrir a área de notificações", s.allowNotifications) { on -> edit({ it.copy(security = it.security.copy(allowNotifications = on)) }) })
        add(Ui.switchRow(this, "Menu do botão de energia", "Desligar/reiniciar pelo botão", s.allowPowerMenu) { on -> edit({ it.copy(security = it.security.copy(allowPowerMenu = on)) }) })
        add(Ui.switchRow(this, "Desativar tela de bloqueio", "Só funciona sem senha/padrão no aparelho", s.disableLockScreen) { on -> edit({ it.copy(security = it.security.copy(disableLockScreen = on)) }) })
        add(Ui.switchRow(this, "Atalhos do Android na administração", "Wi-Fi, Bluetooth e Configurações nesta tela", s.systemSettingsShortcuts) { on -> edit({ it.copy(security = it.security.copy(systemSettingsShortcuts = on)) }) })

        add(Ui.section(this, "Restrições do aparelho (sempre)"))
        add(Ui.switchRow(this, "Bloquear reset de fábrica", "Pelas configurações do Android", s.blockFactoryReset) { on -> edit({ it.copy(security = it.security.copy(blockFactoryReset = on)) }) })
        add(Ui.switchRow(this, "Bloquear modo de segurança", null, s.blockSafeBoot) { on -> edit({ it.copy(security = it.security.copy(blockSafeBoot = on)) }) })
        add(Ui.switchRow(this, "Bloquear transferência de arquivos por USB", null, s.blockUsbFileTransfer) { on -> edit({ it.copy(security = it.security.copy(blockUsbFileTransfer = on)) }) })
        add(Ui.switchRow(this, "Bloquear depuração USB", "Corta o acesso por ADB", s.blockDebugging) { on -> edit({ it.copy(security = it.security.copy(blockDebugging = on)) }) })
    }

    private fun changePin() {
        val ctx = this
        val p1 = EditText(ctx).apply { hint = "Novo PIN (mínimo 4)"; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD }
        val p2 = EditText(ctx).apply { hint = "Repita o PIN"; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD }
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
        add(Ui.section(this, "Sobre"))
        add(Ui.note(this, "StarX Kiosk ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})\n" +
            "Device Owner: ${if (kiosk.isDeviceOwner) "sim" else "não"}\n" +
            "Configuração: rev ${meta.revision}, ${meta.updatedAt ?: "nunca salva"}${meta.source?.let { ", origem $it" } ?: ""}", Color.rgb(20, 20, 30)))
        add(Ui.row(this, "Informações do aparelho", "Serial, IMEI, bateria, rede, armazenamento") { deviceInfo() })

        add(Ui.section(this, "Gesto sobre outros apps"))
        val overlay = CornerOverlay.canShow(this)
        add(Ui.row(this, "Permissão \"Sobrepor a outros apps\"", if (overlay) "Concedida" else "Não concedida: toque para abrir a tela do Android") {
            if (!overlay) startSafely(CornerOverlay.permissionIntent(this))
        })
        if (!overlay) add(Ui.note(this, "Ou por ADB: adb shell appops set $packageName SYSTEM_ALERT_WINDOW allow"))

        add(Ui.section(this, "Arquivo de configuração"))
        add(Ui.row(this, "Exportar", "Salva a configuração (com o hash do PIN) num arquivo .json") { exportConfig() })
        add(Ui.row(this, "Importar", "Carrega um .json exportado; confira e toque em Salvar") { importConfig() })
        add(Ui.row(this, "Ver JSON", "Configuração em edição (sem o hash do PIN)") { showJson() })
        add(Ui.row(this, "Configurar por ADB", "Comandos para aplicar a configuração pelo computador") { adbHelp() })

        if (draft.security.systemSettingsShortcuts) {
            add(Ui.section(this, "Android"))
            add(Ui.row(this, "Wi-Fi", null) { startSafely(Intent(Settings.ACTION_WIFI_SETTINGS)) })
            add(Ui.row(this, "Bluetooth", null) { startSafely(Intent(Settings.ACTION_BLUETOOTH_SETTINGS)) })
            add(Ui.row(this, "Todas as configurações", null) { startSafely(Intent(Settings.ACTION_SETTINGS)) })
        }

        add(Ui.section(this, "Aparelho"))
        add(Ui.row(this, "Reiniciar o aparelho", null) {
            confirm("Reiniciar o aparelho?", "Reiniciar") {
                runCatching { DeviceOwner.dpm(this).reboot(AdminReceiver.component(this)) }
                    .onFailure { toast("Não foi possível reiniciar: ${it.message}") }
            }
        })
        add(Ui.row(this, "Remover Device Owner", "Desfaz o kiosk e as restrições. Para voltar, só com ADB ou reset de fábrica.") {
            confirm("Remover o Device Owner?", "Remover") {
                val err = kiosk.removeDeviceOwner()
                if (err == null) { toast("Device Owner removido"); finish() } else toast("Falhou: $err")
            }
        })
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
            typeface = Typeface.MONOSPACE
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
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
            .setView(ScrollView(this).apply { addView(Ui.note(this@SettingsActivity, text, Color.rgb(20, 20, 30)).apply { typeface = Typeface.MONOSPACE }) })
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
