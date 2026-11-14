package com.pstarx.kiosk

import com.pstarx.kiosk.panel.PanelStore
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
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
}
