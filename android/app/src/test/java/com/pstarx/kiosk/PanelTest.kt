package com.pstarx.kiosk

import com.pstarx.kiosk.config.ConfigPatch
import com.pstarx.kiosk.config.KioskConfig
import com.pstarx.kiosk.panel.PanelStore
import com.pstarx.kiosk.security.Pin
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PanelTest {
    @Test
    fun `endereço do painel normalizado`() {
        assertEquals("https://kiosk.exemplo.com", PanelStore.normalizeUrl(" kiosk.exemplo.com/ "))
        assertEquals("http://localhost:3100", PanelStore.normalizeUrl("http://localhost:3100"))
        assertEquals("https://a.b/api", PanelStore.normalizeUrl("https://a.b/api//"))
        assertNull(PanelStore.normalizeUrl(""))
        assertNull(PanelStore.normalizeUrl("https://"))
    }

    /** Configuração como o painel envia: perfil com PIN "5791" gerado pelo servidor em Node (server/src/kioskConfig.ts). */
    private val desiredFromServer = """
        {"schema":1,"kiosk":{"enabled":true,"mode":"apps","apps":["com.android.chrome"]},
         "security":{"pinHash":{"algo":"pbkdf2-sha256","iterations":100000,"salt":"+ZX8h5hSubCkt5bwTpanAw==",
                                "hash":"hjLqMTItdhM7qypd8UmAr9r+EZ+Itm5sBbig1W2gyQ4=","numeric":true}}}
    """.trimIndent()

    @Test
    fun `configuração do painel substitui a local e o PIN gerado no servidor confere no app`() {
        val local = KioskConfig(
            kiosk = KioskConfig.Kiosk(enabled = false, mode = KioskConfig.Mode.WEB),
            display = KioskConfig.Display(brightness = 30),
        ).toJson()
        val c = ConfigPatch.apply(local, JSONObject(desiredFromServer), replace = true).config!!
        assertTrue(c.kiosk.enabled)
        assertEquals(KioskConfig.Mode.APPS, c.kiosk.mode)
        assertEquals(listOf("com.android.chrome"), c.kiosk.apps)
        assertNull("replace: o que não veio volta ao padrão", c.display.brightness)
        assertTrue(Pin.verify("5791", c.security.pinHash))
        assertFalse(Pin.verify("5792", c.security.pinHash))
        assertTrue(c.security.pinHash!!.numeric)
    }

    @Test
    fun `configuração do painel sem pinHash mantém o PIN do aparelho`() {
        val local = KioskConfig(security = KioskConfig.Security(pinHash = Pin.hash("1234", iterations = 1_000))).toJson()
        val c = ConfigPatch.apply(local, JSONObject("""{"schema":1,"kiosk":{"enabled":true}}"""), replace = true).config!!
        assertTrue(Pin.verify("1234", c.security.pinHash))
    }

    @Test
    fun `configuração do painel com pinHash null remove o PIN`() {
        val local = KioskConfig(security = KioskConfig.Security(pinHash = Pin.hash("1234", iterations = 1_000))).toJson()
        val c = ConfigPatch.apply(local, JSONObject("""{"security":{"pinHash":null}}"""), replace = true).config!!
        assertNull(c.security.pinHash)
    }
}
