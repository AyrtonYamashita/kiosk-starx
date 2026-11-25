package com.pstarx.kiosk

import com.pstarx.kiosk.kiosk.ConnectionGate
import com.pstarx.kiosk.kiosk.ConnectionGate.Decision
import com.pstarx.kiosk.kiosk.ConnectionGate.Net
import com.pstarx.kiosk.kiosk.ConnectionGate.Stage
import com.pstarx.kiosk.kiosk.SessionReset
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ConnectionGateTest {
    private val off = Net(connected = false, validated = false, wifiEnabled = true, ssid = null)
    private val joining = Net(connected = true, validated = false, wifiEnabled = true, ssid = "Mafralda_5G")
    private val ok = joining.copy(validated = true)

    @Test
    fun `sem rede espera e com a internet confirmada abre na hora`() {
        assertEquals(Decision.Show(Stage.WAITING), ConnectionGate.decide(off, 0, null))
        assertEquals(Decision.Ready, ConnectionGate.decide(ok, 0, null))
    }

    @Test
    fun `rede conectada sem confirmacao espera um pouco e depois testa o site`() {
        assertEquals(Decision.Show(Stage.CONNECTING), ConnectionGate.decide(joining, 1_000, null))
        assertEquals(Decision.Probe, ConnectionGate.decide(joining, ConnectionGate.VALIDATION_WAIT_MS, null))
        assertEquals(Decision.Ready, ConnectionGate.decide(joining, 60_000, true))
        assertEquals(Decision.Show(Stage.UNREACHABLE), ConnectionGate.decide(joining, 60_000, false))
    }

    @Test
    fun `textos da tela de espera`() {
        assertEquals("Aguardando conexão com a internet" to "Procurando a rede Wi-Fi…", ConnectionGate.texts(Stage.WAITING, off, "sistema.ssw.inf.br"))
        assertEquals("O Wi-Fi do coletor está desligado.", ConnectionGate.texts(Stage.WAITING, off.copy(wifiEnabled = false), "h").second)
        assertEquals("Conectando…" to "Rede Mafralda_5G: obtendo acesso à internet", ConnectionGate.texts(Stage.CONNECTING, joining, "h"))
        assertEquals(
            "Sem acesso ao sistema" to "sistema.ssw.inf.br não respondeu pela rede Mafralda_5G. Nova tentativa em 5 s.",
            ConnectionGate.texts(Stage.UNREACHABLE, joining, "sistema.ssw.inf.br", 5),
        )
    }

    @Test
    fun `sessao limpa uma vez por ligacao do coletor`() {
        assertTrue(SessionReset.needsClean(null, "n:41"))
        assertFalse(SessionReset.needsClean("n:41", "n:41"))
        assertTrue(SessionReset.needsClean("n:41", "n:42"))
        // sem contador de boots: a hora do boot pode variar um pouco na mesma ligação
        assertFalse(SessionReset.needsClean("t:1000", "t:1001"))
        assertTrue(SessionReset.needsClean("t:1000", "t:1200"))
        assertTrue(SessionReset.needsClean("n:41", "t:1000"))
    }
}
