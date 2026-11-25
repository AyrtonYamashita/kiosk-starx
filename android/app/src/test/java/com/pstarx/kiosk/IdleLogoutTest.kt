package com.pstarx.kiosk

import com.pstarx.kiosk.kiosk.IdleLogout
import com.pstarx.kiosk.kiosk.IdleLogout.Action
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class IdleLogoutTest {
    private val limit = 120_000L

    @Test
    fun avisaNoLimiteEDesconectaSemConfirmacao() {
        val idle = IdleLogout()
        assertEquals(Action.NONE, idle.tick(0, limit, eligible = true))
        assertEquals(Action.NONE, idle.tick(119_000, limit, eligible = true))
        assertEquals(Action.SHOW, idle.tick(120_000, limit, eligible = true))
        assertEquals(30, idle.secondsLeft(120_000))
        assertEquals(Action.UPDATE, idle.tick(140_000, limit, eligible = true))
        assertEquals(10, idle.secondsLeft(140_000))
        assertEquals(Action.LOGOUT, idle.tick(150_000, limit, eligible = true))
        assertFalse(idle.warning)
    }

    @Test
    fun confirmarFechaORecomecaAContar() {
        val idle = IdleLogout()
        idle.tick(0, limit, true)
        assertEquals(Action.SHOW, idle.tick(120_000, limit, true))
        idle.confirm(130_000)
        assertFalse(idle.warning)
        assertEquals(Action.NONE, idle.tick(200_000, limit, true))
        assertEquals(Action.SHOW, idle.tick(250_000, limit, true))
    }

    @Test
    fun toqueZeraOTempoMasNaoFechaOAviso() {
        val idle = IdleLogout()
        idle.tick(0, limit, true)
        idle.activity(100_000)
        assertEquals(Action.NONE, idle.tick(200_000, limit, true))
        assertEquals(Action.SHOW, idle.tick(220_000, limit, true))
        idle.activity(225_000) // toque fora do botão: o aviso continua
        assertTrue(idle.warning)
        assertEquals(Action.LOGOUT, idle.tick(250_000, limit, true))
    }

    @Test
    fun bipagemOuSemLoginNaoContaEFechaOAviso() {
        val idle = IdleLogout()
        idle.tick(0, limit, true)
        assertEquals(Action.NONE, idle.tick(500_000, limit, eligible = false))
        assertEquals(Action.NONE, idle.tick(600_000, limit, eligible = true))
        assertEquals(Action.SHOW, idle.tick(620_000, limit, true))
        assertEquals(Action.HIDE, idle.tick(621_000, limit, eligible = false))
        assertFalse(idle.warning)
    }

    @Test
    fun telaApagadaContaComoParado() {
        val idle = IdleLogout()
        idle.tick(0, limit, true)
        idle.activity(10_000)
        // tela apagada: sem ticks; o alarme fica para o último uso + limite + 30 s
        assertEquals(160_000L, idle.logoutAt(limit))
        // acendeu dentro do limite + aviso: aviso com o tempo que sobrou
        assertEquals(Action.SHOW, idle.tick(140_000, limit, true))
        assertEquals(20, idle.secondsLeft(140_000))
        assertEquals(160_000L, idle.logoutAt(limit))
        assertEquals(Action.LOGOUT, idle.tick(160_000, limit, true))
    }

    @Test
    fun voltouDepoisDoPrazoSaiNaHora() {
        val idle = IdleLogout()
        idle.tick(0, limit, true)
        assertEquals(Action.LOGOUT, idle.tick(500_000, limit, true))
        assertFalse(idle.warning)
        // recomeça a contar depois de desconectar
        assertEquals(Action.NONE, idle.tick(501_000, limit, true))
        assertEquals(null, IdleLogout().logoutAt(limit))
        assertEquals(null, idle.logoutAt(0))
    }

    @Test
    fun zeroDesliga() {
        val idle = IdleLogout()
        assertEquals(Action.NONE, idle.tick(0, 0, true))
        assertEquals(Action.NONE, idle.tick(10_000_000, 0, true))
    }

    @Test
    fun reconheceLoginEBipagemPeloEndereco() {
        assertFalse(IdleLogout.loggedIn("https://sistema.ssw.inf.br/bin/sswbar/login", isSsw = true))
        assertTrue(IdleLogout.loggedIn("https://sistema.ssw.inf.br/bin/sswbar/menu", isSsw = true))
        assertFalse(IdleLogout.loggedIn("https://intranet.local/", isSsw = false))
        assertTrue(IdleLogout.scanningUrl("https://sistema.ssw.inf.br/bin/sswbar/descarga/manifesto/RTA4F21@123"))
        assertTrue(IdleLogout.scanningUrl("https://sistema.ssw.inf.br/bin/sswbar/carga/manifesto/ABC1D23"))
        assertFalse(IdleLogout.scanningUrl("https://sistema.ssw.inf.br/bin/sswbar/descarga/manifesto"))
        assertFalse(IdleLogout.scanningUrl("https://sistema.ssw.inf.br/bin/sswbar/menu"))
    }
}
