package com.pstarx.kiosk

import com.pstarx.kiosk.config.ConfigPatch
import com.pstarx.kiosk.config.KioskConfig
import com.pstarx.kiosk.security.Pin
import com.pstarx.kiosk.security.PinLockout
import com.pstarx.kiosk.security.TapCounter
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ConfigTest {
    private val fastHash: (String) -> KioskConfig.PinHash = { Pin.hash(it, iterations = 1_000) }

    @Test
    fun `json vazio vira configuração padrão sem avisos`() {
        val p = KioskConfig.parse(JSONObject())
        assertEquals(KioskConfig(), p.config)
        assertTrue(p.warnings.isEmpty())
    }

    @Test
    fun `ida e volta pelo json preserva tudo`() {
        val c = KioskConfig(
            kiosk = KioskConfig.Kiosk(
                enabled = true,
                mode = KioskConfig.Mode.WEB,
                app = "com.exemplo.app",
                apps = listOf("com.a.b", "com.c.d"),
                relaunchDelaySec = 7,
                web = KioskConfig.Web("https://intranet.local/painel", 30, 120, false),
            ),
            display = KioskConfig.Display(false, 55, KioskConfig.Orientation.LANDSCAPE, true),
            appearance = KioskConfig.Appearance("Expedição", "#000000", "#FFEEDD", 5),
            security = KioskConfig.Security(
                pinHash = fastHash("4321"),
                exitCorner = KioskConfig.Corner.TOP_LEFT,
                exitTaps = 7,
                allowNotifications = true,
                allowPowerMenu = false,
                disableLockScreen = false,
                blockFactoryReset = false,
                blockSafeBoot = false,
                blockUsbFileTransfer = true,
                blockDebugging = true,
                systemSettingsShortcuts = false,
            ),
        )
        val back = KioskConfig.parse(JSONObject(c.toJson().toString()))
        assertEquals(c, back.config)
        assertTrue(back.warnings.toString(), back.warnings.isEmpty())
    }

    @Test
    fun `valores inválidos voltam ao padrão com aviso`() {
        val json = JSONObject(
            """
            {"kiosk": {"mode": "tv", "app": "não é pacote", "apps": ["com.ok.app", "x", {"package": "com.obj.app"}],
                       "relaunchDelaySec": 999, "web": {"url": "ftp://x"}},
             "display": {"brightness": 150, "orientation": "diagonal"},
             "appearance": {"backgroundColor": "azul", "columns": 1},
             "security": {"exitTaps": "abc", "blockFactoryReset": "talvez"}}
            """,
        )
        val p = KioskConfig.parse(json)
        val c = p.config
        assertEquals(KioskConfig.Mode.APPS, c.kiosk.mode)
        assertNull(c.kiosk.app)
        assertEquals(listOf("com.ok.app", "com.obj.app"), c.kiosk.apps)
        assertEquals(300, c.kiosk.relaunchDelaySec)
        assertEquals("", c.kiosk.web.url)
        assertEquals(100, c.display.brightness)
        assertEquals(KioskConfig.Orientation.AUTO, c.display.orientation)
        assertEquals("#101828", c.appearance.backgroundColor)
        assertEquals(2, c.appearance.columns)
        assertEquals(5, c.security.exitTaps)
        assertTrue(c.security.blockFactoryReset)
        assertEquals(p.warnings.toString(), 11, p.warnings.size)
    }

    @Test
    fun `tipos tolerantes - texto e número`() {
        val c = KioskConfig.parse(JSONObject("""{"kiosk": {"enabled": "true", "relaunchDelaySec": "10"}, "display": {"keepScreenOn": 0}}""")).config
        assertTrue(c.kiosk.enabled)
        assertEquals(10, c.kiosk.relaunchDelaySec)
        assertFalse(c.display.keepScreenOn)
    }

    @Test
    fun `aviso quando o kiosk ligado não tem o que mostrar`() {
        val p = KioskConfig.parse(JSONObject("""{"kiosk": {"enabled": true, "mode": "app"}}"""))
        assertEquals(listOf("modo app único sem app definido"), p.warnings)
    }

    @Test
    fun `merge mescla objetos e substitui listas`() {
        val base = JSONObject("""{"kiosk": {"enabled": false, "apps": ["a.b", "c.d"], "web": {"url": "http://x"}}, "display": {"brightness": 40}}""")
        val patch = JSONObject("""{"kiosk": {"enabled": true, "apps": ["e.f"]}, "display": {"brightness": null}}""")
        val m = KioskConfig.merge(base, patch)
        assertTrue(m.getJSONObject("kiosk").getBoolean("enabled"))
        assertEquals(1, m.getJSONObject("kiosk").getJSONArray("apps").length())
        assertEquals("http://x", m.getJSONObject("kiosk").getJSONObject("web").getString("url"))
        assertTrue(m.getJSONObject("display").isNull("brightness"))
        // a base não é alterada
        assertFalse(base.getJSONObject("kiosk").getBoolean("enabled"))
    }

    @Test
    fun `patch parcial com pin em texto grava só o hash`() {
        val current = KioskConfig().toJson()
        val r = ConfigPatch.apply(current, JSONObject("""{"kiosk": {"enabled": true, "mode": "app", "app": "com.x.y"}, "security": {"pin": "2468"}}"""), false, fastHash)
        val c = r.config!!
        assertTrue(c.kiosk.enabled)
        assertEquals("com.x.y", c.kiosk.app)
        assertTrue(Pin.verify("2468", c.security.pinHash))
        assertFalse(Pin.verify("1111", c.security.pinHash))
        assertFalse(c.toJson().toString().contains("2468"))
    }

    @Test
    fun `pin inválido recusa a alteração inteira`() {
        val r = ConfigPatch.apply(KioskConfig().toJson(), JSONObject("""{"kiosk": {"enabled": true}, "security": {"pin": "12"}}"""), false, fastHash)
        assertNull(r.config)
        assertNotNull(r.error)
    }

    @Test
    fun `importação completa mantém o PIN atual se o arquivo não trouxer PIN`() {
        val current = KioskConfig(
            kiosk = KioskConfig.Kiosk(enabled = true, apps = listOf("a.b")),
            security = KioskConfig.Security(pinHash = fastHash("9999")),
        ).toJson()
        val r = ConfigPatch.apply(current, JSONObject("""{"display": {"brightness": 30}}"""), replace = true, hasher = fastHash)
        val c = r.config!!
        assertFalse("replace volta o resto ao padrão", c.kiosk.enabled)
        assertEquals(emptyList<String>(), c.kiosk.apps)
        assertEquals(30, c.display.brightness)
        assertTrue(Pin.verify("9999", c.security.pinHash))
    }

    @Test
    fun `importação com pinHash null remove o PIN`() {
        val current = KioskConfig(security = KioskConfig.Security(pinHash = fastHash("9999"))).toJson()
        val r = ConfigPatch.apply(current, JSONObject("""{"security": {"pinHash": null}}"""), replace = true, hasher = fastHash)
        assertNull(r.config!!.security.pinHash)
    }

    @Test
    fun `schema mais novo gera aviso mas aplica`() {
        val r = ConfigPatch.apply(KioskConfig().toJson(), JSONObject("""{"schema": 99, "novidade": {"x": 1}, "kiosk": {"enabled": true, "apps": ["a.b"]}}"""), false, fastHash)
        assertTrue(r.config!!.kiosk.enabled)
        assertTrue(r.warnings.any { it.contains("schema 99") })
    }

    @Test
    fun `pretty escreve barras sem escape e continua JSON equivalente`() {
        val c = KioskConfig(kiosk = KioskConfig.Kiosk(web = KioskConfig.Web(url = "https://a.b/c/d")))
        val text = KioskConfig.pretty(c.toJson())
        assertTrue(text.contains("\"https://a.b/c/d\""))
        assertEquals(c, KioskConfig.parse(JSONObject(text)).config)
    }

    @Test
    fun `redacted esconde o hash do pin`() {
        val json = KioskConfig(security = KioskConfig.Security(pinHash = fastHash("1234"))).toJson()
        val red = KioskConfig.redacted(json)
        assertEquals("<definido>", red.getJSONObject("security").getString("pinHash"))
        assertTrue(json.getJSONObject("security").get("pinHash") is JSONObject)
    }
}

class PinTest {
    @Test
    fun `pbkdf2 confere com o vetor da RFC 7914`() {
        // RFC 7914 §11: PBKDF2-HMAC-SHA256(P="passwd", S="salt", c=1, dkLen=64), primeiros 32 bytes
        val out = Pin.pbkdf2Sha256("passwd".toByteArray(), "salt".toByteArray(), 1)
        val hex = out.joinToString("") { "%02x".format(it) }
        assertEquals("55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc", hex)
    }

    @Test
    fun `hash e verificação`() {
        val h = Pin.hash("ab12cd", iterations = 1_000)
        assertFalse(h.numeric)
        assertTrue(Pin.verify("ab12cd", h))
        assertFalse(Pin.verify("ab12ce", h))
        assertTrue(Pin.hash("1234", iterations = 1_000).numeric)
    }

    @Test
    fun `validação do pin`() {
        assertNotNull(Pin.validate("123"))
        assertNotNull(Pin.validate("12 34"))
        assertNull(Pin.validate("1234"))
    }

    @Test
    fun `bloqueio progressivo`() {
        var l = PinLockout()
        repeat(4) { l = l.onFailure(0) }
        assertFalse(l.isLocked(0))
        l = l.onFailure(0)
        assertEquals(30_000, l.remainingMs(0))
        l = l.onFailure(0)
        assertEquals(60_000, l.remainingMs(0))
        assertEquals(PinLockout(), l.onSuccess())
    }

    @Test
    fun `contador de toques no canto`() {
        val t = TapCounter(5, windowMs = 2_000)
        repeat(4) { assertFalse(t.onTap(it * 100L)) }
        assertTrue(t.onTap(500))
        // devagar demais: recomeça
        repeat(4) { assertFalse(t.onTap(10_000L + it * 100)) }
        assertFalse(t.onTap(13_000))
        repeat(3) { assertFalse(t.onTap(13_100L + it * 100)) }
        assertTrue(t.onTap(13_500))
    }
}
