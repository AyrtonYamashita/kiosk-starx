package com.pstarx.kiosk.config

import org.json.JSONArray
import org.json.JSONObject

/**
 * Toda a configuração do aparelho num documento só (JSON). O mesmo documento é editado na tela de
 * configurações, importado/exportado em arquivo, aplicado por ADB e, nas próximas fases, enviado pelo painel.
 *
 * Regras do formato:
 *  - Campo ausente = valor padrão. Valor inválido = padrão + aviso (nunca derruba a configuração inteira).
 *  - `KioskConfig.parse(json).toJson()` é a forma normalizada: é o que fica gravado e o que é exportado.
 *  - Alterações parciais usam [merge]: objetos são mesclados, os demais valores (inclusive listas) substituem.
 */
data class KioskConfig(
    val kiosk: Kiosk = Kiosk(),
    val display: Display = Display(),
    val appearance: Appearance = Appearance(),
    val security: Security = Security(),
) {
    enum class Mode(val wire: String, val label: String) {
        APP("app", "App único"),
        APPS("apps", "Grade de apps"),
        WEB("web", "Site");

        companion object {
            fun of(wire: String?) = entries.firstOrNull { it.wire == wire }
        }
    }

    /**
     * Orientação das telas do app. Retrato e paisagem são FIXOS: as variantes "sensor" deixariam o Android girar
     * 180° (tela de cabeça para baixo ao virar o coletor).
     */
    enum class Orientation(val wire: String, val label: String, val activityInfo: Int) {
        AUTO("auto", "Automática", android.content.pm.ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED),
        PORTRAIT("portrait", "Retrato", android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT),
        LANDSCAPE("landscape", "Paisagem", android.content.pm.ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);

        companion object {
            fun of(wire: String?) = entries.firstOrNull { it.wire == wire }
        }
    }

    enum class Corner(val wire: String, val label: String) {
        TOP_LEFT("top_left", "Superior esquerdo"),
        TOP_RIGHT("top_right", "Superior direito"),
        BOTTOM_LEFT("bottom_left", "Inferior esquerdo"),
        BOTTOM_RIGHT("bottom_right", "Inferior direito");

        companion object {
            fun of(wire: String?) = entries.firstOrNull { it.wire == wire }
        }
    }

    data class Kiosk(
        /** Kiosk ligado. Desligado, o aparelho funciona normalmente (as restrições de segurança continuam). */
        val enabled: Boolean = false,
        val mode: Mode = Mode.APPS,
        /** Modo app único: pacote do app. */
        val app: String? = null,
        /** Modo grade: pacotes, na ordem da grade. */
        val apps: List<String> = emptyList(),
        /** Modo app único: espera antes de reabrir o app quando ele fecha ou trava. */
        val relaunchDelaySec: Int = 3,
        val web: Web = Web(),
    )

    data class Web(
        val url: String = "",
        /** Recarrega a página depois de um erro de carregamento (0 = não recarrega). */
        val reloadOnErrorSec: Int = 15,
        /** Volta para a URL inicial depois de um tempo sem toque (0 = nunca). */
        val inactivityReturnSec: Int = 0,
        val allowZoom: Boolean = true,
        /** Botão de recarregar a página na tela do kiosk (para o operador sair de um erro sem chamar ninguém). */
        val reloadButton: Boolean = false,
        /** Operador logado no SSW parado esse tempo (min): aviso de 30 s e depois sai do SSW (0 = nunca). Nunca durante a bipagem. */
        val idleLogoutMin: Int = 2,
    )

    data class Display(
        /** Tela sempre ligada enquanto o kiosk estiver ativo. */
        val keepScreenOn: Boolean = true,
        /** Brilho fixo em % (null = não mexe no brilho). */
        val brightness: Int? = null,
        /**
         * Sem toque por esse tempo (s), o brilho cai para 1% — a tela nunca apaga (a conexão com o painel continua
         * ativa); o primeiro toque devolve o brilho. 0 = desligado. Ligado, a tela fica sempre ligada.
         */
        val dimAfterSec: Int = 0,
        /** Aviso de bateria fraca na tela, sem carregar, a partir deste nível (%). 0 = sem aviso. */
        val lowBatteryPercent: Int = 15,
        /** Texto do aviso de bateria fraca (para o colaborador trocar a bateria). */
        val lowBatteryMessage: String = "Troque a bateria antes de continuar a operação.",
        /** Orientação das telas do kiosk (grade e site). Não vale para apps de terceiros. */
        val orientation: Orientation = Orientation.AUTO,
        /** Barra de status com hora/bateria/rede durante o kiosk. */
        val showStatusBar: Boolean = false,
    )

    data class Appearance(
        val title: String = "",
        val backgroundColor: String = "#070E1A",
        val textColor: String = "#FFFFFF",
        val columns: Int = 4,
    )

    data class Security(
        /** Hash do PIN de administrador (nunca o PIN em texto). Sem PIN, as configurações abrem direto. */
        val pinHash: PinHash? = null,
        /** Gesto para abrir as configurações: N toques rápidos num canto da tela. */
        val exitCorner: Corner = Corner.BOTTOM_RIGHT,
        val exitTaps: Int = 5,
        val allowNotifications: Boolean = false,
        /** Menu de desligar/reiniciar no botão de energia. */
        val allowPowerMenu: Boolean = true,
        val disableLockScreen: Boolean = true,
        val blockFactoryReset: Boolean = true,
        val blockSafeBoot: Boolean = true,
        val blockUsbFileTransfer: Boolean = false,
        /** Bloqueia opções do desenvolvedor e depuração USB. Cuidado: corta o acesso por ADB. */
        val blockDebugging: Boolean = false,
        /** Atalhos de Wi-Fi/Bluetooth/configurações do Android no menu de administração. */
        val systemSettingsShortcuts: Boolean = true,
        /** Envia a localização do aparelho ao painel (GPS/rede do Android). */
        val reportLocation: Boolean = true,
    )

    data class PinHash(val algo: String, val iterations: Int, val salt: String, val hash: String, val numeric: Boolean) {
        fun toJson(): JSONObject = JSONObject()
            .put("algo", algo).put("iterations", iterations).put("salt", salt).put("hash", hash).put("numeric", numeric)

        companion object {
            fun parse(o: JSONObject?): PinHash? {
                if (o == null) return null
                val algo = o.optString("algo")
                val salt = o.optString("salt")
                val hash = o.optString("hash")
                val iterations = o.optInt("iterations", 0)
                if (algo.isBlank() || salt.isBlank() || hash.isBlank() || iterations <= 0) return null
                return PinHash(algo, iterations, salt, hash, o.optBoolean("numeric", true))
            }
        }
    }

    /** Pacotes que o kiosk usa (para lock task e conferência de instalação). */
    fun kioskPackages(): List<String> = when (kiosk.mode) {
        Mode.APP -> listOfNotNull(kiosk.app)
        Mode.APPS -> kiosk.apps
        Mode.WEB -> emptyList()
    }

    fun toJson(): JSONObject = JSONObject()
        .put("schema", SCHEMA)
        .put(
            "kiosk",
            JSONObject()
                .put("enabled", kiosk.enabled)
                .put("mode", kiosk.mode.wire)
                .put("app", kiosk.app ?: JSONObject.NULL)
                .put("apps", JSONArray(kiosk.apps))
                .put("relaunchDelaySec", kiosk.relaunchDelaySec)
                .put(
                    "web",
                    JSONObject()
                        .put("url", kiosk.web.url)
                        .put("reloadOnErrorSec", kiosk.web.reloadOnErrorSec)
                        .put("inactivityReturnSec", kiosk.web.inactivityReturnSec)
                        .put("allowZoom", kiosk.web.allowZoom)
                        .put("reloadButton", kiosk.web.reloadButton)
                        .put("idleLogoutMin", kiosk.web.idleLogoutMin),
                ),
        )
        .put(
            "display",
            JSONObject()
                .put("keepScreenOn", display.keepScreenOn)
                .put("brightness", display.brightness ?: JSONObject.NULL)
                .put("dimAfterSec", display.dimAfterSec)
                .put("lowBatteryPercent", display.lowBatteryPercent)
                .put("lowBatteryMessage", display.lowBatteryMessage)
                .put("orientation", display.orientation.wire)
                .put("showStatusBar", display.showStatusBar),
        )
        .put(
            "appearance",
            JSONObject()
                .put("title", appearance.title)
                .put("backgroundColor", appearance.backgroundColor)
                .put("textColor", appearance.textColor)
                .put("columns", appearance.columns),
        )
        .put(
            "security",
            JSONObject()
                .put("pinHash", security.pinHash?.toJson() ?: JSONObject.NULL)
                .put("exitCorner", security.exitCorner.wire)
                .put("exitTaps", security.exitTaps)
                .put("allowNotifications", security.allowNotifications)
                .put("allowPowerMenu", security.allowPowerMenu)
                .put("disableLockScreen", security.disableLockScreen)
                .put("blockFactoryReset", security.blockFactoryReset)
                .put("blockSafeBoot", security.blockSafeBoot)
                .put("blockUsbFileTransfer", security.blockUsbFileTransfer)
                .put("blockDebugging", security.blockDebugging)
                .put("systemSettingsShortcuts", security.systemSettingsShortcuts)
                .put("reportLocation", security.reportLocation),
        )

    /** Resultado da leitura: a configuração (sempre válida) e o que foi corrigido. */
    data class Parsed(val config: KioskConfig, val warnings: List<String>)

    companion object {
        const val SCHEMA = 1

        private val PACKAGE = Regex("^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z0-9_]+)+$")
        private val COLOR = Regex("^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$")

        fun parse(json: JSONObject): Parsed {
            val r = Reader()
            val d = KioskConfig()
            val k = r.obj(json, "kiosk")
            val w = r.obj(k, "web", "kiosk.")
            val disp = r.obj(json, "display")
            val look = r.obj(json, "appearance")
            val sec = r.obj(json, "security")

            val pinHash = if (sec == null || !sec.has("pinHash") || sec.isNull("pinHash")) {
                null
            } else {
                PinHash.parse(sec.optJSONObject("pinHash")) ?: null.also { r.warn("security.pinHash inválido: ignorado (sem PIN)") }
            }

            val config = KioskConfig(
                kiosk = Kiosk(
                    enabled = r.bool(k, "kiosk.enabled", d.kiosk.enabled),
                    mode = r.enum(k, "kiosk.mode", d.kiosk.mode, Mode::of),
                    app = r.pkg(k, "kiosk.app"),
                    apps = r.pkgList(k, "kiosk.apps"),
                    relaunchDelaySec = r.int(k, "kiosk.relaunchDelaySec", d.kiosk.relaunchDelaySec, 0..300),
                    web = Web(
                        url = r.url(w, "kiosk.web.url"),
                        reloadOnErrorSec = r.int(w, "kiosk.web.reloadOnErrorSec", d.kiosk.web.reloadOnErrorSec, 0..3600),
                        inactivityReturnSec = r.int(w, "kiosk.web.inactivityReturnSec", d.kiosk.web.inactivityReturnSec, 0..86_400),
                        allowZoom = r.bool(w, "kiosk.web.allowZoom", d.kiosk.web.allowZoom),
                        reloadButton = r.bool(w, "kiosk.web.reloadButton", d.kiosk.web.reloadButton),
                        idleLogoutMin = r.int(w, "kiosk.web.idleLogoutMin", d.kiosk.web.idleLogoutMin, 0..240),
                    ),
                ),
                display = Display(
                    keepScreenOn = r.bool(disp, "display.keepScreenOn", d.display.keepScreenOn),
                    brightness = r.intOrNull(disp, "display.brightness", 0..100),
                    dimAfterSec = r.int(disp, "display.dimAfterSec", d.display.dimAfterSec, 0..86_400),
                    lowBatteryPercent = r.int(disp, "display.lowBatteryPercent", d.display.lowBatteryPercent, 0..50),
                    lowBatteryMessage = r.str(disp, "display.lowBatteryMessage", d.display.lowBatteryMessage).take(200).ifBlank { d.display.lowBatteryMessage },
                    orientation = r.enum(disp, "display.orientation", d.display.orientation, Orientation::of),
                    showStatusBar = r.bool(disp, "display.showStatusBar", d.display.showStatusBar),
                ),
                appearance = Appearance(
                    title = r.str(look, "appearance.title", d.appearance.title).take(80),
                    backgroundColor = r.color(look, "appearance.backgroundColor", d.appearance.backgroundColor),
                    textColor = r.color(look, "appearance.textColor", d.appearance.textColor),
                    columns = r.int(look, "appearance.columns", d.appearance.columns, 2..8),
                ),
                security = Security(
                    pinHash = pinHash,
                    exitCorner = r.enum(sec, "security.exitCorner", d.security.exitCorner, Corner::of),
                    exitTaps = r.int(sec, "security.exitTaps", d.security.exitTaps, 3..10),
                    allowNotifications = r.bool(sec, "security.allowNotifications", d.security.allowNotifications),
                    allowPowerMenu = r.bool(sec, "security.allowPowerMenu", d.security.allowPowerMenu),
                    disableLockScreen = r.bool(sec, "security.disableLockScreen", d.security.disableLockScreen),
                    blockFactoryReset = r.bool(sec, "security.blockFactoryReset", d.security.blockFactoryReset),
                    blockSafeBoot = r.bool(sec, "security.blockSafeBoot", d.security.blockSafeBoot),
                    blockUsbFileTransfer = r.bool(sec, "security.blockUsbFileTransfer", d.security.blockUsbFileTransfer),
                    blockDebugging = r.bool(sec, "security.blockDebugging", d.security.blockDebugging),
                    systemSettingsShortcuts = r.bool(sec, "security.systemSettingsShortcuts", d.security.systemSettingsShortcuts),
                    reportLocation = r.bool(sec, "security.reportLocation", d.security.reportLocation),
                ),
            )
            return Parsed(config, r.warnings + semanticWarnings(config))
        }

        /** Combinações válidas no formato, mas que deixariam o kiosk sem efeito. */
        private fun semanticWarnings(c: KioskConfig): List<String> {
            if (!c.kiosk.enabled) return emptyList()
            return listOfNotNull(
                "modo app único sem app definido".takeIf { c.kiosk.mode == Mode.APP && c.kiosk.app == null },
                "grade de apps vazia".takeIf { c.kiosk.mode == Mode.APPS && c.kiosk.apps.isEmpty() },
                "modo site sem URL".takeIf { c.kiosk.mode == Mode.WEB && c.kiosk.web.url.isBlank() },
            )
        }

        /** Mescla `patch` sobre `base` (cópia; nenhum dos dois é alterado). `null` no patch apaga o valor. */
        fun merge(base: JSONObject, patch: JSONObject): JSONObject {
            val out = JSONObject(base.toString())
            for (key in patch.keys()) {
                val pv = patch.get(key)
                val bv = out.opt(key)
                if (pv is JSONObject && bv is JSONObject) out.put(key, merge(bv, pv)) else out.put(key, pv)
            }
            return out
        }

        /** JSON indentado para gente ler (o org.json escreve "https:\/\/"; "\/" e "/" são equivalentes em JSON). */
        fun pretty(json: JSONObject): String = json.toString(2).replace(Regex("(?<!\\\\)\\\\/"), "/")

        /** Remove o hash do PIN (para mostrar/registrar a configuração sem material do PIN). */
        fun redacted(json: JSONObject): JSONObject {
            val copy = JSONObject(json.toString())
            copy.optJSONObject("security")?.let { if (it.has("pinHash") && !it.isNull("pinHash")) it.put("pinHash", "<definido>") }
            return copy
        }
    }

    /** Leitura tolerante: cada campo inválido vira padrão + aviso. */
    private class Reader {
        val warnings = mutableListOf<String>()

        fun warn(msg: String) {
            warnings += msg
        }

        fun obj(parent: JSONObject?, key: String, prefix: String = ""): JSONObject? {
            if (parent == null || !parent.has(key) || parent.isNull(key)) return null
            return parent.optJSONObject(key) ?: null.also { warn("$prefix$key deveria ser um objeto: ignorado") }
        }

        fun bool(o: JSONObject?, path: String, def: Boolean): Boolean {
            val key = path.substringAfterLast('.')
            if (o == null || !o.has(key) || o.isNull(key)) return def
            return when (val v = o.get(key)) {
                is Boolean -> v
                is String -> when (v.lowercase()) {
                    "true", "1", "sim", "yes" -> true
                    "false", "0", "nao", "não", "no" -> false
                    else -> def.also { warn("$path: \"$v\" não é verdadeiro/falso") }
                }
                is Number -> v.toInt() != 0
                else -> def.also { warn("$path: valor inválido") }
            }
        }

        private fun number(o: JSONObject, key: String): Int? = when (val v = o.get(key)) {
            is Number -> v.toDouble().takeIf { it == Math.floor(it) }?.toInt()
            is String -> v.trim().toIntOrNull()
            else -> null
        }

        fun int(o: JSONObject?, path: String, def: Int, range: IntRange): Int {
            val key = path.substringAfterLast('.')
            if (o == null || !o.has(key) || o.isNull(key)) return def
            val n = number(o, key) ?: return def.also { warn("$path: não é um número inteiro") }
            if (n !in range) {
                val c = n.coerceIn(range)
                warn("$path: $n fora de ${range.first}..${range.last}, usando $c")
                return c
            }
            return n
        }

        fun intOrNull(o: JSONObject?, path: String, range: IntRange): Int? {
            val key = path.substringAfterLast('.')
            if (o == null || !o.has(key) || o.isNull(key)) return null
            if (o.opt(key) == "") return null
            val n = number(o, key) ?: return null.also { warn("$path: não é um número inteiro") }
            return n.coerceIn(range).also { if (it != n) warn("$path: $n fora de ${range.first}..${range.last}, usando $it") }
        }

        fun str(o: JSONObject?, path: String, def: String): String {
            val key = path.substringAfterLast('.')
            if (o == null || !o.has(key) || o.isNull(key)) return def
            val v = o.get(key)
            return if (v is String) v.trim() else v.toString()
        }

        fun <E> enum(o: JSONObject?, path: String, def: E, of: (String?) -> E?): E {
            val key = path.substringAfterLast('.')
            if (o == null || !o.has(key) || o.isNull(key)) return def
            val raw = o.optString(key)
            return of(raw) ?: def.also { warn("$path: \"$raw\" não é uma opção válida") }
        }

        fun pkg(o: JSONObject?, path: String): String? {
            val key = path.substringAfterLast('.')
            if (o == null || !o.has(key) || o.isNull(key)) return null
            val v = o.optString(key).trim()
            if (v.isEmpty()) return null
            return v.takeIf { PACKAGE.matches(it) } ?: null.also { warn("$path: \"$v\" não é um nome de pacote") }
        }

        fun pkgList(o: JSONObject?, path: String): List<String> {
            val key = path.substringAfterLast('.')
            if (o == null || !o.has(key) || o.isNull(key)) return emptyList()
            val arr = o.optJSONArray(key) ?: return emptyList<String>().also { warn("$path deveria ser uma lista") }
            val out = mutableListOf<String>()
            for (i in 0 until arr.length()) {
                // aceita "pacote" ou {"package": "pacote"}
                val v = (arr.optJSONObject(i)?.optString("package") ?: arr.optString(i)).trim()
                if (PACKAGE.matches(v)) {
                    if (v !in out) out += v
                } else {
                    warn("$path[$i]: \"$v\" não é um nome de pacote")
                }
            }
            return out
        }

        fun url(o: JSONObject?, path: String): String {
            val v = str(o, path, "")
            if (v.isEmpty()) return ""
            val ok = v.startsWith("http://", ignoreCase = true) || v.startsWith("https://", ignoreCase = true)
            return if (ok) v else "".also { warn("$path: \"$v\" precisa começar com http:// ou https://") }
        }

        fun color(o: JSONObject?, path: String, def: String): String {
            val v = str(o, path, def)
            return if (COLOR.matches(v)) v.uppercase() else def.also { warn("$path: \"$v\" não é uma cor #RRGGBB") }
        }
    }
}
