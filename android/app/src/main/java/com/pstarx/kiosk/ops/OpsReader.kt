package com.pstarx.kiosk.ops

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
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
    /** Alguém bipando agora (ver OpsTracker.busy): o app adia a própria atualização. */
    @Volatile private var busyNow = false
    /** Muda a cada mudança na tela de bipagem (uma leitura): a tela trata como uso, como um toque. */
    @Volatile var scanActivity = 0L
        private set
    fun isBusy() = running && busyNow

    /** Chamado (na thread principal) quando a carga aberta termina: o que esperou por ela (recarregar, atualizar) sai. */
    @Volatile var onBusyEnd: (() -> Unit)? = null

    /** Chamado (na thread principal) quando chega um leitor novo da API: a tela injeta de novo na página aberta. */
    @Volatile var onScriptChanged: (() -> Unit)? = null

    @Synchronized
    private fun init(ctx: Context) {
        if (::app.isInitialized) return
        app = ctx.applicationContext
        val prefs = app.getSharedPreferences("ops", Context.MODE_PRIVATE)
        clock = OpsClock(prefs.getLong("offset_ms", 0), prefs.getLong("last_ts", 0)) { offset, last ->
            prefs.edit().putLong("offset_ms", offset).putLong("last_ts", last).apply()
        }
        queue = OpsQueue(File(app.filesDir, "ops/queue.jsonl"))
        // coletor desligando: avisa o servidor ("desligado") antes de cair, para o card mostrar o motivo
        runCatching { app.registerReceiver(shutdown, IntentFilter(Intent.ACTION_SHUTDOWN)) }
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
        busyNow = false
        kick(0)
    }

    /** Tela fechada ou piloto desligado. A fila fica no disco (sai quando voltar), salvo se a API desligou a leitura. */
    fun stop() {
        if (!running) return
        running = false
        busyNow = false
        tickTask?.cancel(false)
        tickTask = null
        ErrorAlarm.stop()
        Log.i(TAG, "Leitura do SSW parada")
    }

    /** Tela apagada ou acesa de novo (thread principal): sinal de vida na hora com o estado da tela. */
    fun onScreen(on: Boolean) {
        if (!running) return
        val at = System.currentTimeMillis()
        logic.execute { safely { emit(tracker.onPower(clock.now(at), if (on) null else "apagada")) } }
    }

    /** Desligando: o aviso vai antes de o Android encerrar o app (o sistema espera alguns segundos pelo receiver). */
    private val shutdown = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action != Intent.ACTION_SHUTDOWN || !running) return
            val pending = goAsync()
            val at = System.currentTimeMillis()
            logic.execute {
                safely { emit(tracker.onPower(clock.now(at), "desligado")) }
                net.execute {
                    safely { flush() }
                    pending.finish()
                }
            }
        }
    }

    /** Página fora do SSW (erro, outro site): para o rastreador, é como sair da tela. */
    fun onLeftSsw() {
        ErrorAlarm.stop()
        if (!running) return
        val at = System.currentTimeMillis()
        logic.execute { safely { emit(tracker.onSnapshot(clock.now(at), Snapshot("outra"))) } }
    }

    /** Ponte com a página. Só aceita chamadas com o piloto ligado e com a página principal no SSW. */
    class Bridge(private val pageIsSsw: () -> Boolean) {
        @JavascriptInterface
        fun report(json: String) {
            val at = System.currentTimeMillis()
            if (!running || json.length > 48_000 || !pageIsSsw()) return
            logic.execute {
                safely {
                    Snapshot.parse(json)?.let {
                        if (it.screen == "bipagem") scanActivity++
                        emit(tracker.onSnapshot(clock.now(at), it))
                    }
                }
            }
        }

        @JavascriptInterface
        fun action(name: String) {
            val at = System.currentTimeMillis()
            if (!running || !pageIsSsw()) return
            logic.execute { safely { tracker.onAction(clock.now(at), name.take(20)) } }
        }

        /** Alerta de erro grave aberto na página (ssw_reader.js): alarme, vibração e captura da tela para o registro. */
        @JavascriptInterface
        fun alert(scanId: String, kind: String) {
            if (!running || !pageIsSsw()) return
            Log.i(TAG, "alerta de erro na bipagem: ${kind.take(30)}")
            ErrorAlarm.start(app)
            ScanShots.capture(app, scanId.take(40))
        }

        /** Alerta fechado ("Entendi" ou a página saiu). */
        @JavascriptInterface
        fun alertEnd() {
            ErrorAlarm.stop()
        }
    }

    /** Endereços do SSW (https). Na versão de testes, também o servidor da máquina de desenvolvimento no emulador. */
    fun isSswUrl(url: String?): Boolean {
        val u = runCatching { Uri.parse(url ?: return false) }.getOrNull() ?: return false
        val host = u.host?.lowercase() ?: return false
        if (u.scheme == "https" && (host == "ssw.inf.br" || host.endsWith(".ssw.inf.br"))) return true
        return BuildConfig.DEBUG && u.scheme == "http" && host == "10.0.2.2"
    }

    /**
     * O leitor da página: o último entregue pela API (conferido pelo sha256) ou, sem ele, o embutido no APK
     * (assets/ssw_reader.js, a mesma fonte: server/reader).
     */
    fun script(ctx: Context): String {
        readerScript?.let { return it }
        val prefs = ctx.getSharedPreferences("ops", Context.MODE_PRIVATE)
        val sha = prefs.getString("reader_sha", null)
        val file = readerFile(ctx)
        val fromApi = if (sha != null && file.exists()) file.readText().takeIf { OpsSign.sha256hex(it) == sha } else null
        return (fromApi ?: ctx.assets.open("ssw_reader.js").bufferedReader().use { it.readText() }).also { readerScript = it }
    }
    @Volatile private var readerScript: String? = null

    private fun readerFile(ctx: Context) = File(ctx.applicationContext.filesDir, "ops/reader.js")

    /** sha256 do leitor que a API entrega (check-in). Diferente do guardado: baixa, confere e passa a usar. */
    fun onReaderInfo(ctx: Context, sha256: String?) {
        if (sha256 == null || !Regex("^[0-9a-f]{64}$").matches(sha256)) return
        init(ctx)
        val prefs = app.getSharedPreferences("ops", Context.MODE_PRIVATE)
        if (prefs.getString("reader_sha", null) == sha256 && readerFile(app).exists()) return
        if (!readerFetching.compareAndSet(false, true)) return
        net.execute {
            try {
                val s = PanelStore.get(app).state
                val url = s.serverUrl ?: return@execute
                val token = s.token ?: return@execute
                val conn = URL("$url/v1/device/reader").openConnection() as HttpURLConnection
                val body = try {
                    conn.connectTimeout = 10_000
                    conn.readTimeout = 15_000
                    conn.setRequestProperty("Authorization", "Bearer $token")
                    conn.setRequestProperty("User-Agent", "StarXKiosk/${BuildConfig.VERSION_NAME}")
                    if (conn.responseCode != 200) return@execute
                    conn.inputStream.use { it.readBytes().toString(Charsets.UTF_8) }
                } finally {
                    conn.disconnect()
                }
                if (OpsSign.sha256hex(body) != sha256) {
                    Log.w(TAG, "leitor da API recusado: sha256 não confere")
                    return@execute
                }
                val f = readerFile(app)
                f.parentFile?.mkdirs()
                val tmp = File(f.parentFile, "reader.js.tmp")
                tmp.writeText(body)
                if (!tmp.renameTo(f)) {
                    f.delete()
                    tmp.renameTo(f)
                }
                prefs.edit().putString("reader_sha", sha256).apply()
                readerScript = body
                Log.i(TAG, "leitor do SSW atualizado pela API (${sha256.take(12)})")
                onScriptChanged?.let { cb -> android.os.Handler(android.os.Looper.getMainLooper()).post(cb) }
            } catch (e: Exception) {
                Log.w(TAG, "falha ao baixar o leitor da API: ${e.message}")
            } finally {
                readerFetching.set(false)
            }
        }
    }
    private val readerFetching = AtomicBoolean(false)

    // ---------------------------------------------------------------- interno

    /** Na thread `logic`. Sinal de vida fica só na memória (o último); o resto vai para a fila no disco. */
    private fun emit(events: List<JSONObject>) {
        val was = busyNow
        busyNow = tracker.busy(clock.now())
        if (was && !busyNow) {
            android.os.Handler(android.os.Looper.getMainLooper()).post { onBusyEnd?.invoke() }
            // a atualização do app adiada sai no próximo check-in: antecipa
            com.pstarx.kiosk.panel.PanelSync.now(app, "busy-end")
        }
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
                is OpsSender.Outcome.Sent -> if (!o.more) {
                    // rede de volta: capturas de erro que ficaram no disco
                    ScanShots.uploadSoon(app)
                    return
                }
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
