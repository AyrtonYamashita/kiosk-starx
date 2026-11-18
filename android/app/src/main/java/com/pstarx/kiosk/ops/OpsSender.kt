package com.pstarx.kiosk.ops

import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.security.MessageDigest
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import kotlin.random.Random

/** Assinatura dos lotes, igual à da API (server/src/ops.ts). */
object OpsSign {
    fun sha256hex(s: String): String =
        MessageDigest.getInstance("SHA-256").digest(s.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

    /** hex(HMAC-SHA256(chave = SHA-256 hex do token, "<ts>.<sha256 hex do corpo>")). */
    fun sign(tokenHash: String, ts: Long, body: String): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(tokenHash.toByteArray(Charsets.UTF_8), "HmacSHA256"))
        return mac.doFinal("$ts.${sha256hex(body)}".toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
    }
}

/**
 * Hora corrigida pela do servidor (`offsetMs`) e hora do último lote (`lastTs`, sempre crescente: a API recusa lote
 * que não for mais novo que o último aceito). `save` grava os dois no aparelho.
 */
class OpsClock(offsetMs: Long, lastTs: Long, private val deviceNow: () -> Long = System::currentTimeMillis, private val save: (Long, Long) -> Unit = { _, _ -> }) {
    @Volatile var offsetMs = offsetMs
        private set
    @Volatile var lastTs = lastTs
        private set

    fun now(device: Long = deviceNow()) = device + offsetMs

    @Synchronized
    fun nextTs(): Long {
        lastTs = maxOf(lastTs + 1, now())
        save(offsetMs, lastTs)
        return lastTs
    }

    /** Acerta pela hora do servidor (recebida em `deviceAtResponse`). */
    @Synchronized
    fun sync(serverTime: Long, deviceAtResponse: Long = deviceNow()) {
        offsetMs = serverTime - deviceAtResponse
        save(offsetMs, lastTs)
    }

    /** O servidor já aceitou um lote mais novo (409): o próximo sai depois da hora dele. */
    @Synchronized
    fun bumpTo(serverTime: Long) {
        lastTs = maxOf(lastTs, serverTime)
        save(offsetMs, lastTs)
    }
}

/**
 * Envia a fila em lotes assinados para `POST /v1/device/events` e trata cada resposta como em docs/operacoes.md.
 * Sem Android (o transporte HTTP é injetado): testável na JVM. Usar de uma thread só.
 */
class OpsSender(
    private val queue: OpsQueue,
    private val clock: OpsClock,
    private val creds: () -> Creds?,
    private val transport: Transport,
    private val onDisabled: () -> Unit = {},
    private val log: (String) -> Unit = {},
    private val random: Random = Random.Default,
) {
    data class Creds(val serverUrl: String, val deviceId: String, val tokenHash: String)

    fun interface Transport {
        /** Status HTTP e o JSON da resposta ({} se não for JSON). IOException = sem conexão. */
        @Throws(IOException::class)
        fun post(url: String, headers: Map<String, String>, body: String): Pair<Int, JSONObject>
    }

    sealed interface Outcome {
        /** Nada para mandar. */
        data object Idle : Outcome
        /** Lote aceito (ou descartado por ser inválido); `more` = ainda há fila. */
        data class Sent(val more: Boolean) : Outcome
        /** Tentar de novo depois de `delayMs` (0 = já). */
        data class Retry(val delayMs: Long) : Outcome
        /** Parar até o próximo check-in (aparelho removido, sem cadastro ou leitura desligada). */
        data object Stop : Outcome
    }

    /** Sinal de vida mais recente ainda não enviado (só o último importa; não vai para o disco). */
    @Volatile var heartbeat: JSONObject? = null

    private var batchSize = MAX_BATCH
    private var failures = 0
    private var quickRetries = 0

    fun flushOnce(): Outcome {
        val c = creds() ?: return Outcome.Stop
        val hb = heartbeat?.takeIf { clock.now() - it.optLong("at") < HEARTBEAT_MAX_AGE_MS }
        if (hb == null) heartbeat = null
        val batch = queue.peek(if (hb != null) batchSize - 1 else batchSize)
        if (batch.isEmpty() && hb == null) return Outcome.Idle
        val events = if (hb != null && batch.size < MAX_BATCH) batch + hb else batch
        val body = JSONObject().put("schema", 1).put("events", JSONArray(events)).toString()
        val ts = clock.nextTs()
        val headers = mapOf(
            "x-device-id" to c.deviceId,
            "x-ts" to ts.toString(),
            "x-signature" to OpsSign.sign(c.tokenHash, ts, body),
        )
        val (status, json) = try {
            transport.post("${c.serverUrl}/v1/device/events", headers, body)
        } catch (e: IOException) {
            return backoff("sem conexão: ${e.message}")
        }
        val serverTime = json.optLong("serverTime", 0L).takeIf { it > 0 }
        val error = json.optString("error")
        return when {
            status == 200 -> {
                queue.remove(batch.map { it.getString("id") })
                if (hb != null && hb in events && heartbeat === hb) heartbeat = null
                failures = 0
                quickRetries = 0
                batchSize = MAX_BATCH
                // relógio do aparelho andando: corrige antes de chegar aos 5 min que a API tolera
                if (serverTime != null && kotlin.math.abs(serverTime - clock.now()) > RESYNC_MS) clock.sync(serverTime)
                Outcome.Sent(more = queue.size > 0)
            }
            status == 401 && error == "clock_skew" && serverTime != null -> {
                log("relógio fora (${(serverTime - clock.now()) / 1000} s): acertando pela hora do servidor")
                clock.sync(serverTime)
                quick()
            }
            status == 409 && serverTime != null -> {
                clock.bumpTo(serverTime)
                quick()
            }
            status == 400 -> {
                // um evento inválido não pode travar a fila: divide o lote até achar o culpado e só ele é descartado
                if (batch.size > 1) {
                    batchSize = maxOf(1, batch.size / 2)
                    Outcome.Retry(0)
                } else {
                    log("evento recusado pela API e descartado: ${json.optString("message")} ${batch.firstOrNull()?.toString()?.take(300)}")
                    queue.remove(batch.map { it.getString("id") })
                    if (batch.isEmpty() && heartbeat === hb) heartbeat = null
                    Outcome.Sent(more = queue.size > 0)
                }
            }
            status == 413 -> {
                batchSize = maxOf(1, batchSize / 2)
                Outcome.Retry(0)
            }
            status == 403 && error == "ops_disabled" -> {
                log("leitura desligada no painel: fila descartada")
                queue.clear()
                heartbeat = null
                onDisabled()
                Outcome.Stop
            }
            status == 401 -> {
                log("a API não reconhece este aparelho (removido ou assinatura errada): parado até o próximo check-in")
                Outcome.Stop
            }
            else -> backoff("HTTP $status")
        }
    }

    /** Respostas que pedem reenvio imediato (relógio, lote antigo): no máximo algumas seguidas. */
    private fun quick(): Outcome = if (++quickRetries <= 3) Outcome.Retry(0) else backoff("reenvios seguidos sem sucesso")

    private fun backoff(reason: String): Outcome {
        val base = BACKOFF_MS[minOf(failures, BACKOFF_MS.size - 1)]
        failures++
        quickRetries = 0
        // espalha os coletores (todos voltando juntos depois de uma queda da rede)
        val delay = (base * (0.75 + random.nextDouble() * 0.5)).toLong()
        log("envio falhou ($reason): nova tentativa em ${delay / 1000} s")
        return Outcome.Retry(delay)
    }

    companion object {
        const val MAX_BATCH = 200
        const val HEARTBEAT_MAX_AGE_MS = 60_000L
        const val RESYNC_MS = 30_000L
        val BACKOFF_MS = longArrayOf(1_000, 2_000, 5_000, 10_000, 30_000, 60_000)
    }
}
