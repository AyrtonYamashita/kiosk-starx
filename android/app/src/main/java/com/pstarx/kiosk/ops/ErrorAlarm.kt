package com.pstarx.kiosk.ops

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import kotlin.math.PI
import kotlin.math.sin

/**
 * Alarme do alerta de erro grave na bipagem (ex.: volume de outra carga): sirene alta (volume de alarme no máximo
 * enquanto toca) e vibração na força máxima, até o "Entendi" (StarXOps.alertEnd) ou no máximo [MAX_MS].
 * Thread principal.
 */
object ErrorAlarm {
    private const val TAG = "ErrorAlarm"
    private const val RATE = 22_050
    private const val MAX_MS = 20_000L
    /** Dois tons de 250 ms (agudo/grave), em onda quase quadrada: o som mais alto que o alto-falante do coletor dá. */
    private val TONES = intArrayOf(2_400, 1_500)
    private const val TONE_MS = 250

    private val main = Handler(Looper.getMainLooper())
    private var track: AudioTrack? = null
    private var savedVolume = -1
    private var vibrating = false
    private var ctx: Context? = null
    private val timeout = Runnable { stop() }

    fun start(context: Context) = main.post { startNow(context.applicationContext) }

    fun stop() = main.post { stopNow() }

    private fun startNow(app: Context) {
        stopNow()
        ctx = app
        runCatching { playSiren(app) }.onFailure { Log.w(TAG, "Sem som do alarme: ${it.message}") }
        runCatching { vibrate(app) }.onFailure { Log.w(TAG, "Sem vibração do alarme: ${it.message}") }
        main.postDelayed(timeout, MAX_MS)
        Log.i(TAG, "Alarme ligado")
    }

    private fun stopNow() {
        main.removeCallbacks(timeout)
        track?.let { t -> runCatching { t.stop() }; runCatching { t.release() } }
        track = null
        val app = ctx ?: return
        if (vibrating) runCatching { vibrator(app)?.cancel() }
        vibrating = false
        if (savedVolume >= 0) {
            runCatching { (app.getSystemService(Context.AUDIO_SERVICE) as AudioManager).setStreamVolume(AudioManager.STREAM_ALARM, savedVolume, 0) }
            savedVolume = -1
        }
        ctx = null
        Log.i(TAG, "Alarme desligado")
    }

    private fun playSiren(app: Context) {
        val am = app.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        // volume do alarme no máximo enquanto toca (volta ao do aparelho no fim); em "não perturbe" o Android pode recusar
        runCatching {
            savedVolume = am.getStreamVolume(AudioManager.STREAM_ALARM)
            am.setStreamVolume(AudioManager.STREAM_ALARM, am.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0)
        }.onFailure { savedVolume = -1 }
        val pcm = siren()
        val t = AudioTrack.Builder()
            .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
            .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(RATE).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
            .setTransferMode(AudioTrack.MODE_STATIC)
            .setBufferSizeInBytes(pcm.size * 2)
            .build()
        t.write(pcm, 0, pcm.size)
        t.setLoopPoints(0, pcm.size, -1)
        t.setVolume(AudioTrack.getMaxVolume())
        t.play()
        track = t
    }

    /** Um ciclo da sirene (os dois tons), repetido em laço pelo AudioTrack. */
    internal fun siren(): ShortArray {
        val per = RATE * TONE_MS / 1000
        val out = ShortArray(per * TONES.size)
        var i = 0
        for (f in TONES) {
            for (n in 0 until per) {
                // senoide saturada (quase quadrada): alta sem estalar; bordas suaves de 5 ms entre os tons
                val s = (sin(2 * PI * f * n / RATE) * 3.0).coerceIn(-1.0, 1.0)
                val edge = minOf(n, per - 1 - n).coerceAtMost(RATE / 200) / (RATE / 200.0)
                out[i++] = (s * edge * Short.MAX_VALUE * 0.95).toInt().toShort()
            }
        }
        return out
    }

    private fun vibrate(app: Context) {
        val v = vibrator(app) ?: return
        if (!v.hasVibrator()) return
        val timings = longArrayOf(0, 700, 150)
        val effect = if (v.hasAmplitudeControl()) VibrationEffect.createWaveform(timings, intArrayOf(0, 255, 0), 0) else VibrationEffect.createWaveform(timings, 0)
        v.cancel()
        @Suppress("DEPRECATION")
        v.vibrate(effect, AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build())
        vibrating = true
    }

    private fun vibrator(app: Context): Vibrator? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            app.getSystemService(VibratorManager::class.java)?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            app.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        }
}
