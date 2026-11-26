package com.pstarx.kiosk.ops

import android.content.Context
import android.graphics.BitmapFactory
import android.util.Log
import com.pstarx.kiosk.BuildConfig
import com.pstarx.kiosk.commands.ScreenCapture
import com.pstarx.kiosk.panel.PanelStore
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Captura da tela com o alerta de erro grave na bipagem, guardada no registro daquele erro (o mesmo id da bipagem).
 * Fica no disco (files/ops/shots/<id>.jpg) até a API receber: sem rede, sai no próximo envio dos eventos.
 */
object ScanShots {
    private const val TAG = "ScanShots"
    /** Espera o alerta terminar de entrar (animação) antes de capturar. */
    private const val SETTLE_MS = 700L
    private const val MAX_FILES = 40
    private const val MAX_AGE_MS = 7L * 24 * 60 * 60 * 1000
    private val ID = Regex("^[a-z0-9]{6,40}$")

    private val worker = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "ops-shots") }
    private val uploading = AtomicBoolean(false)

    private fun dir(ctx: Context) = File(ctx.applicationContext.filesDir, "ops/shots").apply { mkdirs() }

    /** Captura (com o alerta na tela) e envia. Qualquer thread. */
    fun capture(ctx: Context, scanId: String) {
        if (!ID.matches(scanId)) return
        val app = ctx.applicationContext
        worker.schedule({
            try {
                val activity = ScreenCapture.foreground() ?: return@schedule
                val shot = ScreenCapture.jpeg(activity) ?: return@schedule
                val f = File(dir(app), "$scanId.jpg")
                val tmp = File(f.parentFile, "$scanId.tmp")
                tmp.writeBytes(shot.jpeg)
                tmp.renameTo(f)
                Log.i(TAG, "captura do erro $scanId (${shot.width}x${shot.height}, ${shot.jpeg.size / 1024} KB)")
                prune(app)
                uploadNow(app)
            } catch (e: Exception) {
                Log.w(TAG, "falha na captura do erro: ${e.message}")
            }
        }, SETTLE_MS, TimeUnit.MILLISECONDS)
    }

    /** Manda o que ficou no disco (chamado depois de um envio de eventos que deu certo). */
    fun uploadSoon(ctx: Context) {
        val app = ctx.applicationContext
        val files = dir(app).listFiles { f -> f.name.endsWith(".jpg") }
        if (files.isNullOrEmpty()) return
        worker.execute { uploadNow(app) }
    }

    private fun uploadNow(app: Context) {
        if (!uploading.compareAndSet(false, true)) return
        try {
            val files = dir(app).listFiles { f -> f.name.endsWith(".jpg") }?.sortedBy { it.lastModified() } ?: return
            for (f in files) if (!send(app, f)) return
        } finally {
            uploading.set(false)
        }
    }

    /** true: resolvido (enviado ou recusado de vez, o arquivo sai); false: tentar depois. */
    private fun send(app: Context, f: File): Boolean {
        val s = PanelStore.get(app).state
        val url = s.serverUrl ?: return false
        val token = s.token ?: return false
        val id = f.name.removeSuffix(".jpg")
        val body = f.readBytes()
        val dims = BitmapFactory.Options().apply { inJustDecodeBounds = true }.also { BitmapFactory.decodeFile(f.path, it) }
        val conn = URL("$url/v1/device/ops/shots?scan=$id&width=${dims.outWidth}&height=${dims.outHeight}").openConnection() as HttpURLConnection
        return try {
            conn.requestMethod = "POST"
            conn.connectTimeout = 15_000
            conn.readTimeout = 30_000
            conn.doOutput = true
            conn.setFixedLengthStreamingMode(body.size)
            conn.setRequestProperty("Content-Type", "image/jpeg")
            conn.setRequestProperty("User-Agent", "StarXKiosk/${BuildConfig.VERSION_NAME}")
            conn.setRequestProperty("Authorization", "Bearer $token")
            conn.outputStream.use { it.write(body) }
            val status = conn.responseCode
            when {
                status in 200..299 -> {
                    f.delete()
                    true
                }
                // recusa definitiva (pedido inválido, grande demais, aparelho removido): não adianta repetir
                status in 400..499 && status != 408 && status != 429 -> {
                    Log.w(TAG, "captura $id recusada: HTTP $status")
                    f.delete()
                    true
                }
                else -> false
            }
        } catch (e: Exception) {
            false
        } finally {
            conn.disconnect()
        }
    }

    /** No máximo [MAX_FILES] arquivos e nada com mais de 7 dias. */
    private fun prune(app: Context) {
        val now = System.currentTimeMillis()
        val files = dir(app).listFiles()?.sortedByDescending { it.lastModified() } ?: return
        files.forEachIndexed { i, f -> if (i >= MAX_FILES || now - f.lastModified() > MAX_AGE_MS || f.name.endsWith(".tmp")) f.delete() }
    }
}
