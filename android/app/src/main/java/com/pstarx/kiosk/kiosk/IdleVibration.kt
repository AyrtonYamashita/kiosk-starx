package com.pstarx.kiosk.kiosk

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log

/**
 * Vibração do aviso de inatividade ("Usuário Inativo!"): pulsos fortes (1 s vibrando, 0,5 s parado) repetindo até
 * parar: qualquer toque na tela, confirmar, sair do SSW ou o aviso sumir. Sem motor de vibração, não faz nada.
 */
object IdleVibration {
    private const val TAG = "IdleVibration"
    private val PATTERN = longArrayOf(0, 1_000, 500)

    @Volatile var active = false
        private set

    fun start(context: Context) {
        val v = vibrator(context) ?: return
        if (!v.hasVibrator()) {
            Log.i(TAG, "Sem motor de vibração: aviso sem vibrar")
            return
        }
        runCatching {
            v.cancel()
            v.vibrate(VibrationEffect.createWaveform(PATTERN, 0))
            active = true
            Log.i(TAG, "Vibração ligada")
        }.onFailure { Log.w(TAG, "Não foi possível vibrar: ${it.message}") }
    }

    fun stop(context: Context) {
        if (!active) return
        active = false
        runCatching { vibrator(context)?.cancel() }
        Log.i(TAG, "Vibração desligada")
    }

    private fun vibrator(context: Context): Vibrator? {
        val ctx = context.applicationContext
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ctx.getSystemService(VibratorManager::class.java)?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            ctx.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        }
    }
}
