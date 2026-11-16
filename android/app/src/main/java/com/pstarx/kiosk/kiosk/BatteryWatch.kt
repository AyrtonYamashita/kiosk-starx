package com.pstarx.kiosk.kiosk

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.util.Log
import com.pstarx.kiosk.config.ConfigStore
import com.pstarx.kiosk.ui.LowBatteryActivity

/**
 * Aviso de bateria fraca (display.lowBatteryPercent / lowBatteryMessage): com o kiosk ligado e sem carregar, ao
 * chegar no limite abre o aviso por cima de qualquer tela; repete a cada 5% a menos; some ao começar a carregar.
 */
object BatteryWatch {
    private const val TAG = "BatteryWatch"
    /** Nível do último aviso neste ciclo de descarga (null = ainda não avisou). */
    private var lastWarned: Int? = null
    private var registered = false

    fun start(context: Context) {
        val ctx = context.applicationContext
        if (registered) return
        registered = true
        ctx.registerReceiver(object : BroadcastReceiver() {
            override fun onReceive(c: Context, intent: Intent) = onBattery(ctx, intent)
        }, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
    }

    /** Decide se avisa agora. Exposto para teste. */
    fun shouldWarn(level: Int, charging: Boolean, threshold: Int, lastWarned: Int?): Boolean =
        threshold > 0 && !charging && level <= threshold && (lastWarned == null || level <= lastWarned - 5)

    private fun onBattery(ctx: Context, intent: Intent) {
        val raw = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
        val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, 100)
        if (raw < 0 || scale <= 0) return
        val level = raw * 100 / scale
        val status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
        val charging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL
        val c = ConfigStore.get(ctx).config
        val threshold = c.display.lowBatteryPercent
        if (charging || level > threshold) {
            lastWarned = null
            return
        }
        if (!c.kiosk.enabled || !KioskController.get(ctx).enforced) return
        if (!shouldWarn(level, charging, threshold, lastWarned)) return
        lastWarned = level
        Log.i(TAG, "Bateria em $level% (limite $threshold%): aviso na tela")
        LowBatteryActivity.show(ctx, level, c.display.lowBatteryMessage)
    }
}
