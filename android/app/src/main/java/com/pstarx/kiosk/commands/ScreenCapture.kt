package com.pstarx.kiosk.commands

import android.app.Activity
import android.app.Application
import android.content.Context
import android.graphics.Bitmap
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.PixelCopy
import com.pstarx.kiosk.BuildConfig
import com.pstarx.kiosk.panel.PanelStore
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.lang.ref.WeakReference
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Captura de tela das janelas deste app (tela do kiosk: grade ou site; configurações; mensagem), com PixelCopy.
 * Sem permissão especial e sem pedir nada na tela. Um app de terceiros em primeiro plano (modo app único) não pode
 * ser capturado assim: o Android exige confirmação na tela para gravar a tela de outro app.
 */
object ScreenCapture {
    private const val MAX_SIDE = 1280
    private const val JPEG_QUALITY = 70

    @Volatile private var resumed: WeakReference<Activity>? = null

    /** Lembra a activity deste app que está na frente (registrado no Application). */
    val tracker = object : Application.ActivityLifecycleCallbacks {
        override fun onActivityResumed(activity: Activity) {
            resumed = WeakReference(activity)
        }
        override fun onActivityPaused(activity: Activity) {
            if (resumed?.get() === activity) resumed = null
        }
        override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
        override fun onActivityStarted(activity: Activity) = Unit
        override fun onActivityStopped(activity: Activity) = Unit
        override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
        override fun onActivityDestroyed(activity: Activity) = Unit
    }

    /** Bloqueante (fila de comandos). */
    fun captureAndUpload(ctx: Context, commandId: String): Commands.Outcome {
        val activity = resumed?.get()
            ?: return Commands.Outcome(false, "a tela atual não é do StarX Kiosk (app de terceiros na frente ou tela desligada): só dá para capturar a tela do kiosk")
        val bitmap = capture(activity) ?: return Commands.Outcome(false, "o Android não entregou a imagem da tela")
        val jpeg = ByteArrayOutputStream().use { out ->
            bitmap.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, out)
            out.toByteArray()
        }
        val (w, h) = bitmap.width to bitmap.height
        bitmap.recycle()
        val s = PanelStore.get(ctx).state
        val url = s.serverUrl ?: return Commands.Outcome(false, "sem painel")
        val conn = URL("$url/v1/device/screenshots?commandId=$commandId&width=$w&height=$h").openConnection() as HttpURLConnection
        return try {
            conn.requestMethod = "POST"
            conn.connectTimeout = 15_000
            conn.readTimeout = 30_000
            conn.doOutput = true
            conn.setFixedLengthStreamingMode(jpeg.size)
            conn.setRequestProperty("Content-Type", "image/jpeg")
            conn.setRequestProperty("User-Agent", "StarXKiosk/${BuildConfig.VERSION_NAME}")
            conn.setRequestProperty("Authorization", "Bearer ${s.token}")
            conn.outputStream.use { it.write(jpeg) }
            val status = conn.responseCode
            if (status != 200) return Commands.Outcome(false, "envio da imagem falhou: HTTP $status")
            val id = JSONObject(conn.inputStream.use { it.readBytes().toString(Charsets.UTF_8) }).getString("id")
            Commands.Outcome(true, "capturada (${w}x$h, ${jpeg.size / 1024} KB)", JSONObject().put("screenshotId", id).put("width", w).put("height", h))
        } finally {
            conn.disconnect()
        }
    }

    private fun capture(activity: Activity): Bitmap? {
        val main = Handler(Looper.getMainLooper())
        val done = CountDownLatch(1)
        var result: Bitmap? = null
        main.post {
            try {
                val window = activity.window
                val view = window.decorView
                if (view.width == 0 || view.height == 0) {
                    done.countDown()
                    return@post
                }
                val scale = minOf(1f, MAX_SIDE.toFloat() / maxOf(view.width, view.height))
                val full = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
                PixelCopy.request(window, full, { code ->
                    if (code == PixelCopy.SUCCESS) {
                        result = if (scale < 1f) {
                            Bitmap.createScaledBitmap(full, (full.width * scale).toInt(), (full.height * scale).toInt(), true).also { full.recycle() }
                        } else full
                    } else {
                        full.recycle()
                    }
                    done.countDown()
                }, main)
            } catch (e: Exception) {
                done.countDown()
            }
        }
        done.await(10, TimeUnit.SECONDS)
        return result
    }
}
