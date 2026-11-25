package com.pstarx.kiosk.kiosk

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.Uri
import android.net.wifi.WifiManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import com.pstarx.kiosk.BuildConfig
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * Só abre o site com a internet funcionando. Ao ligar, o coletor abria a página antes de o Wi-Fi conectar e ficava
 * numa tela de erro (o DS5AX 0117 ficou assim por horas). Enquanto espera, a tela mostra em que passo está.
 *
 * Passos:
 *  - sem rede → "Aguardando conexão com a internet" (Wi-Fi desligado ou procurando a rede);
 *  - rede conectada, Android ainda conferindo a internet → "Conectando…";
 *  - o Android confirmou a internet → abre;
 *  - passados alguns segundos sem a confirmação (redes que bloqueiam a conferência do Android): testa o próprio
 *    endereço do site; respondeu (qualquer resposta HTTP) → abre; não respondeu → "Sem acesso ao sistema" e tenta
 *    de novo a cada poucos segundos.
 */
class ConnectionGate(
    private val context: Context,
    private val url: String,
    private val onStage: (stage: Stage, title: String, detail: String) -> Unit,
    private val onReady: () -> Unit,
) {
    enum class Stage { WAITING, CONNECTING, CHECKING, UNREACHABLE }

    /** O que o aparelho sabe da rede agora. */
    data class Net(val connected: Boolean, val validated: Boolean, val wifiEnabled: Boolean, val ssid: String?)

    sealed class Decision {
        object Ready : Decision()
        data class Show(val stage: Stage) : Decision()
        /** Rede conectada sem a confirmação do Android: testar o endereço do site. */
        object Probe : Decision()
    }

    companion object {
        private const val TAG = "ConnectionGate"
        /** Espera pela confirmação do Android antes de testar o site direto. */
        const val VALIDATION_WAIT_MS = 6_000L
        const val RETRY_MS = 5_000L
        private const val PROBE_TIMEOUT_MS = 6_000

        /**
         * Regra (testável). `connectedForMs`: há quanto tempo a rede atual está conectada sem a confirmação;
         * `probe`: resultado do último teste do site nesta rede (null = ainda não testou).
         */
        fun decide(net: Net, connectedForMs: Long, probe: Boolean?): Decision = when {
            !net.connected -> Decision.Show(Stage.WAITING)
            net.validated -> Decision.Ready
            probe == true -> Decision.Ready
            probe == false -> Decision.Show(Stage.UNREACHABLE)
            connectedForMs >= VALIDATION_WAIT_MS -> Decision.Probe
            else -> Decision.Show(Stage.CONNECTING)
        }

        /** Textos da tela de espera: título e detalhe. */
        fun texts(stage: Stage, net: Net, host: String, retryInSec: Int? = null): Pair<String, String> = when (stage) {
            Stage.WAITING -> "Aguardando conexão com a internet" to
                if (!net.wifiEnabled) "O Wi-Fi do coletor está desligado." else "Procurando a rede Wi-Fi…"
            Stage.CONNECTING -> "Conectando…" to (net.ssid?.let { "Rede $it: obtendo acesso à internet" } ?: "Obtendo acesso à internet")
            Stage.CHECKING -> "Conectando ao sistema…" to host
            Stage.UNREACHABLE -> "Sem acesso ao sistema" to
                "$host não respondeu${net.ssid?.let { " pela rede $it" } ?: ""}." + (retryInSec?.let { " Nova tentativa em $it s." } ?: "")
        }
    }

    private val main = Handler(Looper.getMainLooper())
    private val cm = context.getSystemService(ConnectivityManager::class.java)
    private val host = runCatching { Uri.parse(url).host }.getOrNull() ?: url
    private var running = false
    private var network: Network? = null
    private var connectedSince = 0L
    private var probe: Boolean? = null
    private var probing = false
    private var retryAt = 0L
    private var lastShown: Pair<Stage, String>? = null

    private val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(n: Network) { main.post { evaluate() } }
        override fun onLost(n: Network) { main.post { evaluate() } }
        override fun onCapabilitiesChanged(n: Network, caps: NetworkCapabilities) { main.post { evaluate() } }
    }
    private val tick = object : Runnable {
        override fun run() {
            evaluate()
            if (running) main.postDelayed(this, 1_000)
        }
    }

    /** Começa a esperar (na thread principal). Com a internet já funcionando, chama onReady na hora. */
    fun start() {
        if (running) return
        running = true
        runCatching { cm.registerDefaultNetworkCallback(callback) }
        evaluate()
        if (running) main.postDelayed(tick, 1_000)
    }

    fun stop() {
        if (!running) return
        running = false
        main.removeCallbacks(tick)
        runCatching { cm.unregisterNetworkCallback(callback) }
    }

    private fun current(): Net {
        val n = cm.activeNetwork
        val caps = n?.let { cm.getNetworkCapabilities(it) }
        val connected = caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
        val validated = connected && caps!!.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
        val wifi = context.applicationContext.getSystemService(WifiManager::class.java)
        val ssid = runCatching {
            @Suppress("DEPRECATION")
            wifi?.connectionInfo?.ssid?.removeSurrounding("\"")?.takeIf { it.isNotBlank() && it != "<unknown ssid>" }
        }.getOrNull()
        if (n != network) {
            // outra rede (ou caiu): recomeça a contagem e esquece o teste anterior
            network = n
            connectedSince = SystemClock.elapsedRealtime()
            probe = null
            retryAt = 0L
        }
        return Net(connected, validated, wifi?.isWifiEnabled != false, if (caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true) ssid else null)
    }

    private fun evaluate() {
        if (!running) return
        val net = current()
        val now = SystemClock.elapsedRealtime()
        // sem resposta do site: depois da espera, testa de novo
        if (probe == false && now >= retryAt) probe = null
        when (val d = decide(net, if (net.connected) now - connectedSince else 0L, probe)) {
            Decision.Ready -> {
                Log.i(TAG, "Internet ok (${if (net.validated) "confirmada pelo Android" else "site respondeu"}): abrindo $host")
                stop()
                onReady()
            }
            Decision.Probe -> {
                show(Stage.CHECKING, net)
                runProbe()
            }
            is Decision.Show -> show(d.stage, net, if (d.stage == Stage.UNREACHABLE) ((retryAt - now + 999) / 1000).toInt().coerceAtLeast(1) else null)
        }
    }

    private fun show(stage: Stage, net: Net, retrySec: Int? = null) {
        val (title, detail) = texts(stage, net, host, retrySec)
        val key = stage to detail
        if (key == lastShown) return
        lastShown = key
        onStage(stage, title, detail)
    }

    /** Testa o endereço do site fora da thread principal: qualquer resposta HTTP serve (até erro 4xx/5xx). */
    private fun runProbe() {
        if (probing) return
        probing = true
        val target = network
        thread(name = "kiosk-probe") {
            val ok = try {
                val conn = URL(url).openConnection() as HttpURLConnection
                try {
                    conn.requestMethod = "HEAD"
                    conn.instanceFollowRedirects = false
                    conn.connectTimeout = PROBE_TIMEOUT_MS
                    conn.readTimeout = PROBE_TIMEOUT_MS
                    conn.setRequestProperty("User-Agent", "StarXKiosk/${BuildConfig.VERSION_NAME}")
                    conn.responseCode > 0
                } finally {
                    conn.disconnect()
                }
            } catch (e: Exception) {
                Log.w(TAG, "Sem resposta de $host: ${e.message}")
                false
            }
            main.post {
                probing = false
                if (!running || network != target) return@post
                probe = ok
                if (!ok) retryAt = SystemClock.elapsedRealtime() + RETRY_MS
                evaluate()
            }
        }
    }
}
