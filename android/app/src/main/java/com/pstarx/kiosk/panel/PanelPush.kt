package com.pstarx.kiosk.panel

import android.content.Context
import android.util.Log
import com.pstarx.kiosk.BuildConfig
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import kotlin.concurrent.thread

/**
 * Aviso imediato do painel (long polling): uma conexão fica esperando em /v1/device/wait; quando o painel cria um
 * comando ou muda a configuração, a resposta chega na hora e o check-in roda já (em vez de esperar até 30 s).
 * Sem rede ou com erro, tenta de novo com espera crescente; o check-in periódico continua valendo como reserva.
 */
object PanelPush {
    private const val TAG = "PanelPush"
    private const val WAIT_SEC = 50
    @Volatile private var running = false

    /** Liga o laço (idempotente). Chamado na subida do app e depois do cadastro. */
    fun start(context: Context) {
        val ctx = context.applicationContext
        synchronized(this) {
            if (running) return
            running = true
        }
        thread(name = "panel-push", isDaemon = true) {
            var backoffMs = 5_000L
            try {
                while (true) {
                    val s = PanelStore.get(ctx).state
                    if (!s.enrolled) break
                    when (val r = waitOnce(s.serverUrl!!, s.token!!)) {
                        Result.WAKE -> {
                            backoffMs = 5_000L
                            Log.i(TAG, "Aviso do painel: check-in agora")
                            PanelSync.now(ctx, "push")
                        }
                        Result.IDLE -> backoffMs = 5_000L
                        Result.GONE -> break // token recusado: o check-in trata (removido do painel)
                        Result.ERROR -> {
                            Thread.sleep(backoffMs)
                            backoffMs = (backoffMs * 2).coerceAtMost(60_000L)
                        }
                    }
                }
            } catch (e: InterruptedException) {
                // encerrado
            } finally {
                running = false
            }
        }
    }

    private enum class Result { WAKE, IDLE, GONE, ERROR }

    private fun waitOnce(serverUrl: String, token: String): Result {
        val conn = URL("$serverUrl/v1/device/wait?timeoutSec=$WAIT_SEC").openConnection() as HttpURLConnection
        return try {
            conn.connectTimeout = 15_000
            conn.readTimeout = (WAIT_SEC + 20) * 1000
            conn.setRequestProperty("Authorization", "Bearer $token")
            conn.setRequestProperty("User-Agent", "StarXKiosk/${BuildConfig.VERSION_NAME}")
            when (conn.responseCode) {
                200 -> {
                    val body = conn.inputStream.use { it.readBytes().toString(Charsets.UTF_8) }
                    if (JSONObject(body).optBoolean("wake")) Result.WAKE else Result.IDLE
                }
                401 -> Result.GONE
                else -> Result.ERROR
            }
        } catch (e: SocketTimeoutException) {
            Result.IDLE
        } catch (e: Exception) {
            Log.d(TAG, "Espera falhou: ${e.message}")
            Result.ERROR
        } finally {
            conn.disconnect()
        }
    }
}
