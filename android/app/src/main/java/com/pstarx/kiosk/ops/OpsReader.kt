package com.pstarx.kiosk.ops

import android.content.Context
import android.net.Uri
import android.util.Log
import android.webkit.JavascriptInterface
import com.pstarx.kiosk.BuildConfig
import com.pstarx.kiosk.panel.PanelStore
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Leitura do SSW (fase 2.4, piloto): liga o leitor da página (ssw_reader.js) ao rastreador de eventos, à fila no disco
 * e ao envio. Só funciona com o aparelho cadastrado e o piloto marcado no painel (`opsReader` do check-in).
 *
 * Threads: `logic` (rastreador e fila; tudo que mexe no OpsTracker) e `net` (envio, que pode demorar).
 */
object OpsReader {
    private const val TAG = "OpsReader"
    const val JS_NAME = "StarXOps"

    private val logic = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "ops-logic") }
    private val net = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "ops-net") }

    private lateinit var app: Context
    private lateinit var queue: OpsQueue
    private lateinit var clock: OpsClock
    private lateinit var sender: OpsSender
    private var tracker = OpsTracker()
    private var tickTask: ScheduledFuture<*>? = null
    private val flushScheduled = AtomicBoolean(false)
    @Volatile private var retryAt = 0L
    @Volatile var running = false
        private set

    @Synchronized
    private fun init(ctx: Context) {
        if (::app.isInitialized) return
        app = ctx.applicationContext
        val prefs = app.getSharedPreferences("ops", Context.MODE_PRIVATE)
        clock = OpsClock(prefs.getLong("offset_ms", 0), prefs.getLong("last_ts", 0)) { offset, last ->
            prefs.edit().putLong("offset_ms", offset).putLong("last_ts", last).apply()
        }
        queue = OpsQueue(File(app.filesDir, "ops/queue.jsonl"))
        sender = OpsSender(
            queue = queue,
            clock = clock,
            creds = ::creds,
            transport = ::post,
            onDisabled = { PanelStore.get(app).setOpsReader(false) },
            log = { Log.w(TAG, it) },
        )
    }

    fun enabled(ctx: Context): Boolean = PanelStore.get(ctx).state.let { it.enrolled && it.opsReader }

    /** Tela do site aberta com o piloto ligado: começa o relógio (prazos e sinal de vida) e manda o que ficou na fila. */
    fun start(ctx: Context) {
        init(ctx)
        if (running) return
        running = true
        // começa do zero: a página manda o retrato atual em seguida (a mesma carga continua no servidor)
        logic.execute { tracker = OpsTracker() }
        Log.i(TAG, "Leitura do SSW ligada (fila: ${queue.size})")
        tickTask = logic.scheduleWithFixedDelay({ safely { emit(tracker.tick(clock.now())) } }, 1, 1, TimeUnit.SECONDS)
        kick(0)
    }

    /** Tela fechada ou piloto desligado. A fila fica no disco (sai quando voltar), salvo se a API desligou a leitura. */
    fun stop() {
        if (!running) return
        running = false
        tickTask?.cancel(false)
        tickTask = null
        Log.i(TAG, "Leitura do SSW parada")
    }

    /** Página fora do SSW (erro, outro site): para o rastreador, é como sair da tela. */
    fun onLeftSsw() {
        if (!running) return
        val at = System.currentTimeMillis()
        logic.execute { safely { emit(tracker.onSnapshot(clock.now(at), Snapshot("outra"))) } }
    }

    /** Ponte com a página. Só aceita chamadas com o piloto ligado e com a página principal no SSW. */
    class Bridge(private val pageIsSsw: () -> Boolean) {
        @JavascriptInterface
        fun report(json: String) {
            val at = System.currentTimeMillis()
            if (!running || json.length > 16_000 || !pageIsSsw()) return
            logic.execute { safely { Snapshot.parse(json)?.let { emit(tracker.onSnapshot(clock.now(at), it)) } } }
        }

        @JavascriptInterface
        fun action(name: String) {
            val at = System.currentTimeMillis()
            if (!running || !pageIsSsw()) return
            logic.execute { safely { tracker.onAction(clock.now(at), name.take(20)) } }
        }
    }

    /** Endereços do SSW (https). Na versão de testes, também o servidor da máquina de desenvolvimento no emulador. */
    fun isSswUrl(url: String?): Boolean {
        val u = runCatching { Uri.parse(url ?: return false) }.getOrNull() ?: return false
        val host = u.host?.lowercase() ?: return false
        if (u.scheme == "https" && (host == "ssw.inf.br" || host.endsWith(".ssw.inf.br"))) return true
        return BuildConfig.DEBUG && u.scheme == "http" && host == "10.0.2.2"
    }

    /** O leitor da página (assets/ssw_reader.js). */
    fun script(ctx: Context): String = readerScript ?: ctx.assets.open("ssw_reader.js").bufferedReader().use { it.readText() }.also { readerScript = it }
    @Volatile private var readerScript: String? = null

    // ---------------------------------------------------------------- interno

    /** Na thread `logic`. Sinal de vida fica só na memória (o último); o resto vai para a fila no disco. */
    private fun emit(events: List<JSONObject>) {
        if (events.isEmpty()) return
        val (beats, rest) = events.partition { it.optString("type") == "heartbeat" }
        beats.lastOrNull()?.let { sender.heartbeat = it }
        queue.add(rest)
        kick(if (rest.isEmpty()) 0 else 300)
    }

    /** Agenda um envio (respeitando a espera depois de falha). Mudanças em sequência saem juntas. */
    private fun kick(delayMs: Long) {
        if (!flushScheduled.compareAndSet(false, true)) return
        val wait = maxOf(delayMs, retryAt - System.currentTimeMillis(), 0)
        net.schedule({
            flushScheduled.set(false)
            safely { flush() }
        }, wait, TimeUnit.MILLISECONDS)
    }

    private fun flush() {
        repeat(30) {
            when (val o = sender.flushOnce()) {
                OpsSender.Outcome.Idle, OpsSender.Outcome.Stop -> return
                is OpsSender.Outcome.Sent -> if (!o.more) return
                is OpsSender.Outcome.Retry -> if (o.delayMs > 0) {
                    retryAt = System.currentTimeMillis() + o.delayMs
                    kick(o.delayMs)
                    return
                }
            }
        }
        kick(0)
    }

    private fun creds(): OpsSender.Creds? {
        val s = PanelStore.get(app).state
        if (!s.opsReader) return null
        val url = s.serverUrl ?: return null
        val id = s.deviceId ?: return null
        val token = s.token ?: return null
        return OpsSender.Creds(url, id, OpsSign.sha256hex(token))
    }

    @Throws(IOException::class)
    private fun post(url: String, headers: Map<String, String>, body: String): Pair<Int, JSONObject> {
        val conn = URL(url).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.connectTimeout = 10_000
            conn.readTimeout = 15_000
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("User-Agent", "StarXKiosk/${BuildConfig.VERSION_NAME}")
            headers.forEach { (k, v) -> conn.setRequestProperty(k, v) }
            conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            val status = conn.responseCode
            val stream = if (status in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.use { it.readBytes().toString(Charsets.UTF_8) }.orEmpty()
            return status to (runCatching { JSONObject(text) }.getOrDefault(JSONObject()))
        } finally {
            conn.disconnect()
        }
    }

    private inline fun safely(block: () -> Unit) {
        try {
            block()
        } catch (e: Exception) {
            Log.e(TAG, "Falha na leitura do SSW", e)
        }
    }
}
