package com.pstarx.kiosk.ui

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import com.pstarx.kiosk.kiosk.ScreenDimmer

/**
 * Aviso de bateria fraca, por cima do kiosk: faixa crítica do design system (fundo e borda vermelhos claros), o
 * nível em número de destaque e a mensagem configurada no perfil. Fecha no "Entendi" ou sozinho ao carregar.
 */
class LowBatteryActivity : Activity() {
    private lateinit var number: TextView

    private val battery = object : BroadcastReceiver() {
        override fun onReceive(c: Context, intent: Intent) {
            val status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
            if (status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL) {
                finishAndRemoveTask()
                return
            }
            val raw = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
            val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, 100)
            if (raw >= 0 && scale > 0) number.text = "${raw * 100 / scale}%"
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setShowWhenLocked(true)
        setTurnScreenOn(true)
        setFinishOnTouchOutside(false)
        ScreenDimmer.onUserActivity()
        val d = { v: Int -> Ui.dp(this, v) }
        val level = intent.getIntExtra(EXTRA_LEVEL, -1)
        val message = intent.getStringExtra(EXTRA_MESSAGE).orEmpty().ifBlank { DEFAULT_MESSAGE }

        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(d(20), d(20), d(20), d(20))
        }
        // cabeçalho: pílula crítica + nível em destaque
        column.addView(LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            addView(Ui.text(this@LowBatteryActivity, "Bateria fraca", Theme.Type.SECTION_TITLE), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            addView(Ui.statusPill(this@LowBatteryActivity, "trocar bateria", Ui.Tone.BAD))
        })
        number = Ui.text(this, if (level >= 0) "$level%" else "—", Theme.Type.NUMBER, Theme.BAD_DEEP).apply {
            setPadding(0, d(14), 0, d(10))
        }
        column.addView(number)
        column.addView(Ui.banner(this, message, critical = true))
        column.addView(Ui.text(this, "Ligue o carregador ou troque a bateria. Este aviso fecha sozinho quando o aparelho começar a carregar.", Theme.Type.CAPTION, Theme.SOFT).apply {
            setPadding(0, d(10), 0, d(16))
        })
        column.addView(Ui.button(this, "Entendi", Ui.Variant.PRIMARY) { finishAndRemoveTask() }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        setContentView(column)
        window.setLayout((resources.displayMetrics.widthPixels * 0.9).toInt(), ViewGroup.LayoutParams.WRAP_CONTENT)
        registerReceiver(battery, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
    }

    override fun onDestroy() {
        runCatching { unregisterReceiver(battery) }
        super.onDestroy()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        // só sai pelo "Entendi" (ou ao carregar)
    }

    companion object {
        const val DEFAULT_MESSAGE = "Troque a bateria antes de continuar a operação."
        private const val EXTRA_LEVEL = "level"
        private const val EXTRA_MESSAGE = "message"

        fun show(context: Context, level: Int, message: String) {
            context.startActivity(
                Intent(context, LowBatteryActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                    .putExtra(EXTRA_LEVEL, level)
                    .putExtra(EXTRA_MESSAGE, message),
            )
        }
    }
}
