package com.pstarx.kiosk.ops

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class OpsTrackerTest {
    private var n = 0
    private val t = OpsTracker { "id-${++n}" }
    private val T0 = 1_795_000_000_000L
    private fun at(sec: Double) = T0 + (sec * 1000).toLong()

    private fun tot(qty: Int) = Totals(qty.toDouble(), qty * 3.5, qty * 100.0)
    private fun bip(read: Int, plate: String = "ABC1D23", fn: String = "coleta", total: Int = 10, user: String? = "maria") =
        Snapshot("bipagem", user = user, domain = "ALT", branch = "OTI", fn = fn, plate = plate, realPlate = "ABC1D23", units = listOf("ALT", "OTI"), total = tot(total), read = tot(read))

    /** Só os eventos que não são sinal de vida, como "tipo:detalhe". */
    private fun List<JSONObject>.kinds() = filter { it.getString("type") != "heartbeat" }.map {
        when (it.getString("type")) {
            "session" -> "session:${it.opt("user")}"
            "op_start" -> "op_start:${it.getString("plate")}"
            "progress" -> "progress:${it.getJSONObject("read").getDouble("qty").toInt()}"
            "op_end" -> "op_end:${it.getString("reason")}"
            else -> it.getString("type")
        }
    }

    @Test
    fun `antes do login nada é lido, ao logar manda a sessão`() {
        assertEquals(emptyList<String>(), t.onSnapshot(at(0.0), Snapshot("login", user = "digitando")).kinds())
        val menu = t.onSnapshot(at(5.0), Snapshot("menu", user = "maria", domain = "ALT", branch = "OTI"))
        assertEquals(listOf("session:maria"), menu.kinds())
        val s = menu.first { it.getString("type") == "session" }
        assertEquals("ALT", s.getString("domain"))
        assertEquals("OTI", s.getString("branch"))
        // tela sem o nome (ou sem a filial) mantém o que já se sabia
        assertEquals(emptyList<String>(), t.onSnapshot(at(6.0), Snapshot("outra")).kinds())
        assertEquals("maria", t.currentUser)
    }

    @Test
    fun `bipagem completa - início, cada bipagem, Concluir confirmado ao sair da tela`() {
        val ev = mutableListOf<JSONObject>()
        ev += t.onSnapshot(at(0.0), bip(0))
        ev += t.onSnapshot(at(4.0), bip(1))
        ev += t.onSnapshot(at(4.5), bip(1)) // retrato igual: nada
        ev += t.onSnapshot(at(9.0), bip(3)) // bipagem dupla
        t.onAction(at(10.0), "concluir")
        ev += t.onSnapshot(at(11.0), Snapshot("placa", user = "maria", fn = "coleta"))
        assertEquals(listOf("session:maria", "op_start:ABC1D23", "progress:1", "progress:3", "op_end:concluded"), ev.kinds())
        val start = ev.first { it.getString("type") == "op_start" }
        assertEquals("coleta", start.getString("fn"))
        assertEquals(10.0, start.getJSONObject("total").getDouble("qty"), 0.0)
        assertEquals(1000.0, start.getJSONObject("total").getDouble("value"), 0.0)
        assertEquals("ALT", start.getJSONArray("units").getString(0))
        assertEquals(at(4.0), ev.first { it.getString("type") == "progress" }.getLong("at"))
        assertFalse(t.hasOpenOperation)
    }

    @Test
    fun `confirmação cancelada - continua na bipagem e a carga não fecha`() {
        t.onSnapshot(at(0.0), bip(0))
        t.onAction(at(5.0), "concluir")
        t.tick(at(16.0)) // passou o prazo de 10 s ainda na bipagem
        val ev = t.onSnapshot(at(20.0), Snapshot("menu", user = "maria"))
        assertEquals(emptyList<String>(), ev.kinds())
        assertTrue(t.hasOpenOperation)
    }

    @Test
    fun `Interromper e logo outra placa - fim confirmado antes do novo início`() {
        t.onSnapshot(at(0.0), bip(2))
        t.onAction(at(3.0), "interromper")
        val ev = t.onSnapshot(at(5.0), bip(0, plate = "XYZ9K88", total = 4))
        assertEquals(listOf("op_end:interrupted", "op_start:XYZ9K88"), ev.kinds())
    }

    @Test
    fun `trocar de placa sem Concluir - só o novo início (o servidor encerra a anterior como trocada)`() {
        t.onSnapshot(at(0.0), bip(2))
        val ev = t.onSnapshot(at(30.0), bip(0, plate = "XYZ9K88"))
        assertEquals(listOf("op_start:XYZ9K88"), ev.kinds())
    }

    @Test
    fun `sair sem Concluir - volta em menos de 2 min segue a mesma carga, depois disso fecha como saiu`() {
        t.onSnapshot(at(0.0), bip(2))
        assertEquals(emptyList<String>(), t.onSnapshot(at(10.0), Snapshot("menu", user = "maria")).kinds())
        assertEquals(emptyList<String>(), t.tick(at(100.0)).kinds())
        // voltou à mesma placa: sem novo início; a bipagem feita enquanto isso aparece
        assertEquals(listOf("progress:3"), t.onSnapshot(at(110.0), bip(3)).kinds())
        assertEquals(emptyList<String>(), t.tick(at(500.0)).kinds())

        t.onSnapshot(at(600.0), Snapshot("menu", user = "maria"))
        assertEquals(emptyList<String>(), t.tick(at(719.0)).kinds())
        assertEquals(listOf("op_end:left"), t.tick(at(720.0)).kinds())
        assertFalse(t.hasOpenOperation)
        // abrir de novo a mesma placa é outra carga
        assertEquals(listOf("op_start:ABC1D23"), t.onSnapshot(at(800.0), bip(3)).kinds())
    }

    @Test
    fun `recarregar a página da bipagem não abre outra carga`() {
        t.onSnapshot(at(0.0), bip(2))
        t.onSnapshot(at(5.0), Snapshot("outra")) // página carregando / fora do SSW
        assertEquals(emptyList<String>(), t.onSnapshot(at(7.0), bip(2)).kinds())
        assertEquals(emptyList<String>(), t.tick(at(500.0)).kinds())
        assertTrue(t.hasOpenOperation)
    }

    @Test
    fun `tela de login - saiu do SSW (o servidor encerra a carga aberta)`() {
        t.onSnapshot(at(0.0), bip(2))
        val ev = t.onSnapshot(at(10.0), Snapshot("login", user = "joao"))
        assertEquals(listOf("session:null"), ev.kinds())
        assertTrue(ev.first { it.getString("type") == "session" }.isNull("user"))
        assertNull(t.currentUser)
        assertFalse(t.hasOpenOperation)
        // outro colaborador entra
        assertEquals(listOf("session:joao"), t.onSnapshot(at(20.0), Snapshot("menu", user = "joao")).kinds())
    }

    @Test
    fun `Concluir e direto para o login - fim confirmado antes da saída`() {
        t.onSnapshot(at(0.0), bip(10))
        t.onAction(at(1.0), "concluir")
        assertEquals(listOf("op_end:concluded", "session:null"), t.onSnapshot(at(3.0), Snapshot("login")).kinds())
    }

    @Test
    fun `sinal de vida a cada 15 s e quando a tela muda, com a carga aberta`() {
        val first = t.onSnapshot(at(0.0), bip(1))
        val hb = first.last { it.getString("type") == "heartbeat" }
        assertEquals("bipagem", hb.getString("screen"))
        assertEquals("maria", hb.getString("user"))
        assertEquals("ABC1D23", hb.getString("plate"))
        assertTrue(t.tick(at(10.0)).isEmpty())
        assertEquals(1, t.tick(at(15.0)).count { it.getString("type") == "heartbeat" })
        assertTrue(t.tick(at(16.0)).isEmpty())
    }

    @Test
    fun `total muda durante a carga - vai junto da bipagem`() {
        t.onSnapshot(at(0.0), bip(1, total = 10))
        val ev = t.onSnapshot(at(5.0), bip(2, total = 12)).first { it.getString("type") == "progress" }
        assertEquals(12.0, ev.getJSONObject("total").getDouble("qty"), 0.0)
        val ev2 = t.onSnapshot(at(9.0), bip(3, total = 12)).first { it.getString("type") == "progress" }
        assertFalse(ev2.has("total"))
    }

    @Test
    fun `retrato da página - campos inválidos ou grandes demais`() {
        val s = Snapshot.parse(
            """{"screen":"bipagem","user":"${"x".repeat(80)}","domain":"ALT","branch":"OTI","fn":"Coleta","plate":"ABC1D23",
               "realPlate":null,"units":["ALT","OTI",""],"total":{"qty":10,"kg":null,"value":1234.5},"read":{"qty":null}}"""
        )!!
        assertEquals("bipagem", s.screen)
        assertEquals(64, s.user!!.length)
        assertEquals("coleta", s.fn)
        assertNull(s.realPlate)
        assertEquals(listOf("ALT", "OTI"), s.units)
        assertEquals(Totals(10.0, 0.0, 1234.5), s.total)
        assertNull(s.read)
        assertEquals("outra", Snapshot.parse("""{"screen":"hack"}""")!!.screen)
        assertNull(Snapshot.parse("não é json"))
        assertNull(Snapshot.parse("""{"screen":"bipagem","fn":"Carga de Manifesto!"}""")!!.fn)
        assertEquals("carga_manifesto", Snapshot.parse("""{"screen":"bipagem","fn":"carga_manifesto"}""")!!.fn)
    }

    @Test
    fun `carga de manifesto - abre a carga como as descargas`() {
        val ev = t.onSnapshot(at(0.0), bip(200, plate = "ARMAZEM", fn = "carga_manifesto", total = 263)) +
            t.onSnapshot(at(3.0), bip(201, plate = "ARMAZEM", fn = "carga_manifesto", total = 263))
        assertEquals(listOf("session:maria", "op_start:ARMAZEM", "progress:201"), ev.kinds())
        assertEquals("carga_manifesto", ev.first { it.getString("type") == "op_start" }.getString("fn"))
    }

    @Test
    fun `tela não entendida - manda a estrutura uma vez por tela a cada 10 min`() {
        val d = JSONObject().put("reason", "bipagem sem funcao").put("path", "/bin/sswbar/carga/manifesto/x")
            .put("ids", org.json.JSONArray(listOf("td#total_qtde"))).put("reader", "v2").put("lixo", "não vai")
        val s = Snapshot("bipagem", user = "maria", total = tot(1), diag = d)
        val first = t.onSnapshot(at(0.0), s).filter { it.getString("type") == "diag" }
        assertEquals(1, first.size)
        assertEquals("bipagem", first[0].getString("screen"))
        assertEquals("v2", first[0].getString("reader"))
        assertFalse(first[0].has("lixo"))
        assertTrue(t.onSnapshot(at(60.0), s).none { it.getString("type") == "diag" })
        assertTrue(t.onSnapshot(at(601.0), s).any { it.getString("type") == "diag" })
        val other = JSONObject(d.toString()).put("path", "/bin/sswbar/outra")
        assertTrue(t.onSnapshot(at(602.0), s.copy(diag = other)).any { it.getString("type") == "diag" })
    }

    @Test
    fun `código de barras - vai junto da bipagem e também sozinho quando não contou`() {
        fun code(c: String, kind: String) = JSONObject().put("scan", JSONObject().put("id", "s-$c").put("code", c).put("kind", kind).put("ageMs", 0))
        t.onSnapshot(at(0.0), bip(1))
        val ev1 = t.onSnapshot(at(3.0), bip(2).copy(extra = code("111", "lido"))).filter { it.getString("type") == "progress" }
        assertEquals("111", ev1.single().getJSONObject("extra").getJSONObject("scan").getString("code"))
        // código que não contou: "Lidos" igual, mas sai um progresso com o código
        val ev2 = t.onSnapshot(at(6.0), bip(2).copy(extra = code("999", "nao_contou"))).filter { it.getString("type") == "progress" }
        assertEquals("nao_contou", ev2.single().getJSONObject("extra").getJSONObject("scan").getString("kind"))
        assertEquals(2.0, ev2.single().getJSONObject("read").getDouble("qty"), 0.0)
        // o mesmo retrato de novo não repete; bipagem sem código novo não leva o extra
        assertTrue(t.onSnapshot(at(7.0), bip(2).copy(extra = code("999", "nao_contou"))).none { it.getString("type") == "progress" })
        val ev3 = t.onSnapshot(at(9.0), bip(3).copy(extra = code("999", "nao_contou"))).single { it.getString("type") == "progress" }
        assertFalse(ev3.has("extra"))
        // extra grande demais é ignorado
        assertNull(Snapshot.parse("""{"screen":"bipagem","extra":{"x":"${"y".repeat(5000)}"}}""")!!.extra)
    }

    @Test
    fun `ocupado - na bipagem ou com carga aberta, até 15 min sem mudar a tela`() {
        assertFalse(t.busy(at(0.0)))
        t.onSnapshot(at(0.0), Snapshot("menu", user = "maria"))
        assertFalse(t.busy(at(1.0)))
        t.onSnapshot(at(10.0), bip(1))
        assertTrue(t.busy(at(11.0)))
        assertTrue(t.busy(at(10.0 + 14 * 60)))
        assertFalse(t.busy(at(10.0 + 15 * 60))) // parado na bipagem: a atualização pode entrar
        t.onSnapshot(at(1000.0), bip(2))
        t.onAction(at(1001.0), "concluir")
        t.onSnapshot(at(1002.0), Snapshot("placa", user = "maria", fn = "coleta"))
        assertFalse(t.busy(at(1003.0))) // concluiu e saiu da bipagem
    }
}
