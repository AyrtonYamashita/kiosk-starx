package com.pstarx.kiosk.ops

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.io.IOException
import kotlin.random.Random

class OpsSenderTest {
    @get:Rule val tmp = TemporaryFolder()

    @Test
    fun `assinatura igual à da API`() {
        // valores calculados com server/src/ops.ts (sha256hex + signBatch)
        val tokenHash = OpsSign.sha256hex("token-de-teste-do-coletor")
        assertEquals("7a952497b9ab54c36f7a6ba97d723e2131ff1bc22cb160e37ed73127ab906d78", tokenHash)
        val body = """{"schema":1,"events":[{"id":"00000000-0000-4000-8000-000000000001","at":1795000000000,"type":"heartbeat","screen":"menu","user":"maria"}]}"""
        assertEquals("070c64d22b17b5c3bca110ad5e1fbac2dc069c0566eaac9aa51362ab42a1afdd", OpsSign.sign(tokenHash, 1795000000123, body))
    }

    @Test
    fun `fila no disco - sobrevive ao reinício, remove só o aceito, descarta os mais antigos no limite`() {
        val f = File(tmp.root, "ops/queue.jsonl")
        val q = OpsQueue(f, max = 5)
        q.add((1..3).map { ev(it) })
        q.remove(listOf("e2"))
        assertEquals(listOf("e1", "e3"), OpsQueue(f, max = 5).peek(10).map { it.getString("id") })
        q.add((4..8).map { ev(it) })
        assertEquals(listOf("e4", "e5", "e6", "e7", "e8"), OpsQueue(f, max = 5).peek(10).map { it.getString("id") })
        assertEquals(2, q.droppedCount)
        q.clear()
        assertEquals(0, OpsQueue(f).size)
    }

    // ---------------------------------------------------------------- envio

    private val T = 1_795_000_000_000L
    private var deviceNow = T
    private val saved = mutableListOf<Pair<Long, Long>>()
    private val clock = OpsClock(0, 0, { deviceNow }) { o, l -> saved += o to l }
    private val sent = mutableListOf<Triple<Map<String, String>, JSONObject, Long>>()
    private val replies = ArrayDeque<(JSONObject) -> Pair<Int, JSONObject>>()
    private var disabled = false
    private val creds = OpsSender.Creds("https://api.exemplo", "dev-1", OpsSign.sha256hex("tok"))

    private fun ev(i: Int) = JSONObject().put("id", "e$i").put("at", T + i).put("type", "progress")
    private fun ok() = { _: JSONObject -> 200 to JSONObject().put("accepted", 1).put("serverTime", deviceNow) }
    private fun reply(status: Int, error: String? = null, serverTime: Long? = null) = { _: JSONObject ->
        status to JSONObject().apply {
            error?.let { put("error", it) }
            serverTime?.let { put("serverTime", it) }
        }
    }

    private fun sender(q: OpsQueue) = OpsSender(
        queue = q,
        clock = clock,
        creds = { creds },
        transport = { url, headers, body ->
            assertEquals("https://api.exemplo/v1/device/events", url)
            val json = JSONObject(body)
            sent += Triple(headers, json, headers.getValue("x-ts").toLong())
            val r = replies.removeFirstOrNull() ?: throw IOException("sem rede")
            r(json)
        },
        onDisabled = { disabled = true },
        random = Random(1),
    )

    private fun queue() = OpsQueue(File(tmp.root, "q-${System.nanoTime()}.jsonl"))

    @Test
    fun `lote aceito sai da fila, com assinatura e hora crescente, sinal de vida vai junto`() {
        val q = queue()
        q.add((1..3).map { ev(it) })
        val s = sender(q)
        s.heartbeat = JSONObject().put("id", "hb").put("at", T).put("type", "heartbeat")
        replies += ok()
        assertEquals(OpsSender.Outcome.Sent(more = false), s.flushOnce())
        val (headers, body, ts) = sent.single()
        assertEquals("dev-1", headers["x-device-id"])
        assertEquals(OpsSign.sign(creds.tokenHash, ts, body.toString()), headers["x-signature"])
        assertEquals(listOf("e1", "e2", "e3", "hb"), (0 until body.getJSONArray("events").length()).map { body.getJSONArray("events").getJSONObject(it).getString("id") })
        assertEquals(0, q.size)
        assertNull(s.heartbeat)
        assertEquals(OpsSender.Outcome.Idle, s.flushOnce())

        // mesmo com o relógio parado, o próximo lote sai com hora maior
        q.add(listOf(ev(4)))
        replies += ok()
        s.flushOnce()
        assertTrue(sent[1].third > sent[0].third)
    }

    @Test
    fun `sem rede - fila fica e a espera cresce (com variação)`() {
        val q = queue()
        q.add(listOf(ev(1)))
        val s = sender(q)
        val delays = (1..7).map { (s.flushOnce() as OpsSender.Outcome.Retry).delayMs }
        assertEquals(1, q.size)
        assertTrue(delays[0] in 750..1250)
        assertTrue(delays[3] in 7_500..12_500)
        assertTrue(delays[6] in 45_000..75_000)
        replies += ok()
        assertEquals(OpsSender.Outcome.Sent(more = false), s.flushOnce())
    }

    @Test
    fun `relógio fora - acerta pela hora do servidor e reenvia`() {
        val q = queue()
        q.add(listOf(ev(1)))
        val s = sender(q)
        val server = T + 20 * 60_000
        replies += reply(401, "clock_skew", server)
        assertEquals(OpsSender.Outcome.Retry(0), s.flushOnce())
        assertEquals(20 * 60_000L, clock.offsetMs)
        replies += ok()
        s.flushOnce()
        assertTrue(sent[1].third >= server)
        assertEquals(0, q.size)
    }

    @Test
    fun `lote antigo (409) - próximo sai depois da hora do servidor`() {
        val q = queue()
        q.add(listOf(ev(1)))
        val s = sender(q)
        replies += reply(409, "stale", T + 5_000)
        assertEquals(OpsSender.Outcome.Retry(0), s.flushOnce())
        replies += ok()
        s.flushOnce()
        assertTrue(sent[1].third > T + 5_000)
    }

    @Test
    fun `evento inválido (400) - divide o lote e descarta só o culpado`() {
        val q = queue()
        q.add((1..4).map { ev(it) })
        val s = sender(q)
        val bad = { b: JSONObject ->
            val ids = (0 until b.getJSONArray("events").length()).map { b.getJSONArray("events").getJSONObject(it).getString("id") }
            if ("e3" in ids) 400 to JSONObject().put("error", "invalid_body") else 200 to JSONObject()
        }
        repeat(10) { replies += bad }
        var guard = 0
        while (q.size > 0 && guard++ < 10) s.flushOnce()
        assertEquals(0, q.size)
        val accepted = sent.filter { b -> (0 until b.second.getJSONArray("events").length()).none { b.second.getJSONArray("events").getJSONObject(it).getString("id") == "e3" } }
        assertEquals(setOf("e1", "e2", "e4"), accepted.flatMap { b -> (0 until b.second.getJSONArray("events").length()).map { b.second.getJSONArray("events").getJSONObject(it).getString("id") } }.toSet())
    }

    @Test
    fun `lote grande demais (413) - divide`() {
        val q = queue()
        q.add((1..300).map { ev(it) })
        val s = sender(q)
        replies += reply(413)
        assertEquals(OpsSender.Outcome.Retry(0), s.flushOnce())
        replies += ok()
        s.flushOnce()
        assertEquals(100, sent[1].second.getJSONArray("events").length())
        assertEquals(200, q.size)
    }

    @Test
    fun `leitura desligada no painel (403) - descarta a fila e avisa`() {
        val q = queue()
        q.add(listOf(ev(1)))
        val s = sender(q)
        replies += reply(403, "ops_disabled", T)
        assertEquals(OpsSender.Outcome.Stop, s.flushOnce())
        assertEquals(0, q.size)
        assertTrue(disabled)
    }

    @Test
    fun `aparelho removido (401) - para e guarda a fila`() {
        val q = queue()
        q.add(listOf(ev(1)))
        val s = sender(q)
        replies += reply(401, "unauthorized", T)
        assertEquals(OpsSender.Outcome.Stop, s.flushOnce())
        assertEquals(1, q.size)
    }

    @Test
    fun `sinal de vida velho não é enviado`() {
        val q = queue()
        val s = sender(q)
        s.heartbeat = JSONObject().put("id", "hb").put("at", T).put("type", "heartbeat")
        deviceNow = T + 2 * 60_000
        assertEquals(OpsSender.Outcome.Idle, s.flushOnce())
        assertTrue(sent.isEmpty())
    }
}
