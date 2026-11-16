package com.pstarx.kiosk.kiosk

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.net.ConnectivityManager
import android.net.Network
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import com.pstarx.kiosk.device.DeviceInfo
import com.pstarx.kiosk.ui.Theme
import com.pstarx.kiosk.ui.Theme.Type
import com.pstarx.kiosk.ui.Ui
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.concurrent.thread

/**
 * Barra de status própria, no rodapé da tela do kiosk, para quando a barra do Android está escondida
 * (sem "Barra de status" e sem "Notificações"). Esquerda: força do sinal, rede e dBm. Direita: bateria e hora.
 *
 * Mesmo vocabulário do console: fundo da paleta mais escura com contorno de 1dp (sem sombra), rótulo em Outfit,
 * dado de máquina (SSID, dBm, %, hora) em IBM Plex Mono, cor só como estado (bateria verde → âmbar → vermelho).
 */
class StatusFooter(context: Context, onReload: (() -> Unit)? = null) : LinearLayout(context) {
    private val main = Handler(Looper.getMainLooper())
    private val info = DeviceInfo(context)
    private val bars = SignalBars(context)
    private val network = Ui.text(context, "", Type.LABEL, Theme.NIGHT_INK)
    private val signal = Ui.text(context, "", Type.CAPTION, Theme.NIGHT_SOFT).apply { typeface = Theme.typeface(context, Theme.Font.MONO, 400) }
    private val battery = BatteryGlyph(context)
    private val batteryText = Ui.text(context, "", Type.ID, Theme.NIGHT_INK)
    private val clock = Ui.text(context, "", Type.ID_STRONG, Theme.NIGHT_INK)
    private val timeFormat = SimpleDateFormat("HH:mm", Locale.getDefault())

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context, intent: Intent) {
            when (intent.action) {
                Intent.ACTION_TIME_TICK, Intent.ACTION_TIME_CHANGED, Intent.ACTION_TIMEZONE_CHANGED -> updateClock()
                Intent.ACTION_BATTERY_CHANGED -> updateBattery()
                else -> updateNetwork()
            }
        }
    }
    private val netCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(n: Network) = post { updateNetwork() }.let { }
        override fun onLost(n: Network) = post { updateNetwork() }.let { }
        override fun onCapabilitiesChanged(n: Network, caps: android.net.NetworkCapabilities) = post { updateNetwork() }.let { }
    }
    private val tick = object : Runnable {
        override fun run() {
            updateNetwork() // RSSI não tem broadcast confiável em todos os aparelhos
            main.postDelayed(this, 10_000)
        }
    }

    init {
        orientation = HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        val h = Theme.dp(context, 12)
        setPadding(h, 0, h, 0)
        background = android.graphics.drawable.LayerDrawable(
            arrayOf(
                android.graphics.drawable.ColorDrawable(Theme.NIGHT_SURFACE),
                android.graphics.drawable.ColorDrawable(Theme.NIGHT),
            ),
        ).apply { setLayerInset(1, 0, Theme.dp(context, 1).coerceAtLeast(1), 0, 0) } // contorno de 1dp no topo
        contentDescription = "Barra de status"

        // atalho de recarregar a página (modo site, quando ligado no perfil): botão compacto à esquerda
        if (onReload != null) {
            addView(LinearLayout(context).apply {
                orientation = HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(Theme.dp(context, 8), 0, Theme.dp(context, 10), 0)
                background = android.graphics.drawable.RippleDrawable(
                    android.content.res.ColorStateList.valueOf(Theme.withAlpha(Theme.P1, 0.3f)),
                    Theme.box(context, Theme.NIGHT_SURFACE, Theme.R_NAV),
                    null,
                )
                contentDescription = "Recarregar página"
                isClickable = true
                setOnClickListener { onReload() }
                addView(android.widget.ImageView(context).apply {
                    setImageResource(com.pstarx.kiosk.R.drawable.ic_reload)
                    imageTintList = android.content.res.ColorStateList.valueOf(Theme.NIGHT_INK)
                }, LayoutParams(Theme.dp(context, 13), Theme.dp(context, 13)).apply { marginEnd = Theme.dp(context, 6) })
                addView(Ui.text(context, "Recarregar", Type.LABEL, Theme.NIGHT_INK))
            }, LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, Theme.dp(context, 22)).apply { marginEnd = Theme.dp(context, 12) })
        }
        addView(bars, LayoutParams(Theme.dp(context, 14), Theme.dp(context, 11)).apply { marginEnd = Theme.dp(context, 8) })
        addView(network.apply { isSingleLine = true; ellipsize = android.text.TextUtils.TruncateAt.END }, LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginEnd = Theme.dp(context, 6) })
        addView(signal)
        addView(View(context), LayoutParams(0, 1, 1f))
        addView(battery, LayoutParams(Theme.dp(context, 20), Theme.dp(context, 10)).apply { marginEnd = Theme.dp(context, 6) })
        addView(batteryText, LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginEnd = Theme.dp(context, 12) })
        addView(clock)
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_TIME_TICK)
            addAction(Intent.ACTION_TIME_CHANGED)
            addAction(Intent.ACTION_TIMEZONE_CHANGED)
            addAction(Intent.ACTION_BATTERY_CHANGED)
            addAction(android.net.wifi.WifiManager.RSSI_CHANGED_ACTION)
            addAction(android.net.wifi.WifiManager.NETWORK_STATE_CHANGED_ACTION)
        }
        context.registerReceiver(receiver, filter)
        runCatching { context.getSystemService(ConnectivityManager::class.java).registerDefaultNetworkCallback(netCallback) }
        updateClock()
        updateBattery()
        main.post(tick)
    }

    override fun onDetachedFromWindow() {
        runCatching { context.unregisterReceiver(receiver) }
        runCatching { context.getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(netCallback) }
        main.removeCallbacks(tick)
        super.onDetachedFromWindow()
    }

    private fun updateClock() {
        clock.text = timeFormat.format(Date())
    }

    private fun updateBattery() {
        val b = info.battery()
        val level = if (b.isNull("level")) null else b.optInt("level")
        val charging = b.optBoolean("charging")
        battery.set(level, charging)
        batteryText.text = level?.let { "$it%" } ?: "—"
    }

    private fun updateNetwork() {
        thread {
            val n = runCatching { info.network() }.getOrNull()
            main.post {
                val type = n?.optString("type") ?: "none"
                val wifi = n?.optJSONObject("wifi")
                when (type) {
                    "wifi" -> {
                        val rssi = wifi?.optInt("rssi", -127) ?: -127
                        val ssid = wifi?.optString("ssid")?.takeIf { wifi.has("ssid") && !wifi.isNull("ssid") && it.isNotBlank() }
                        bars.set(levelOf(rssi), Theme.P1)
                        network.text = ssid ?: "Wi-Fi"
                        signal.text = if (rssi > -127) "$rssi dBm" else ""
                    }
                    "ethernet" -> { bars.set(4, Theme.P1); network.text = "Cabo"; signal.text = "" }
                    "cellular" -> { bars.set(3, Theme.P1); network.text = "Dados móveis"; signal.text = "" }
                    "none" -> { bars.set(0, Theme.BAD); network.text = "Sem rede"; signal.text = "" }
                    else -> { bars.set(2, Theme.P1); network.text = "Conectado"; signal.text = "" }
                }
            }
        }
    }

    /** dBm → 0..4 barras (mesmos limites que o Android usa para Wi-Fi). */
    private fun levelOf(rssi: Int) = when {
        rssi >= -55 -> 4
        rssi >= -66 -> 3
        rssi >= -77 -> 2
        rssi >= -88 -> 1
        else -> 0
    }

    /** Quatro barras de 2dp de raio (as barras de uso do console, em pé). */
    private class SignalBars(context: Context) : View(context) {
        private var level = 0
        private var color = Theme.P1
        private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        private val r = Theme.dpf(context, Theme.R_BAR.toFloat()) / 2f
        private val rect = RectF()

        fun set(level: Int, color: Int) {
            this.level = level
            this.color = color
            invalidate()
        }

        override fun onDraw(canvas: Canvas) {
            val gap = width / 10f
            val bw = (width - gap * 3) / 4f
            for (i in 0 until 4) {
                val h = height * (i + 1) / 4f
                val left = i * (bw + gap)
                rect.set(left, height - h, left + bw, height.toFloat())
                paint.color = if (i < level) color else Theme.P4
                canvas.drawRoundRect(rect, r, r, paint)
            }
        }
    }

    /** Bateria: contorno de 1dp, ponta, preenchimento proporcional; cor é estado (>30 verde, ≤30 âmbar, ≤15 vermelho). */
    private class BatteryGlyph(context: Context) : View(context) {
        private var level: Int? = null
        private var charging = false
        private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = Theme.dpf(context, 1f); color = Theme.NIGHT_SOFT }
        private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
        private val r = Theme.dpf(context, Theme.R_BAR.toFloat())
        private val rect = RectF()

        fun set(level: Int?, charging: Boolean) {
            this.level = level
            this.charging = charging
            invalidate()
        }

        override fun onDraw(canvas: Canvas) {
            val tip = Theme.dpf(context, 2f)
            val half = stroke.strokeWidth / 2
            rect.set(half, half, width - tip - half, height - half)
            canvas.drawRoundRect(rect, r, r, stroke)
            fill.color = Theme.NIGHT_SOFT
            canvas.drawRect(width - tip, height * 0.3f, width.toFloat(), height * 0.7f, fill)
            val l = level ?: return
            fill.color = when {
                charging -> Theme.GOOD
                l <= 15 -> Theme.BAD
                l <= 30 -> Theme.WARN
                else -> Theme.GOOD
            }
            val pad = stroke.strokeWidth * 1.5f
            val inner = (rect.width() - pad * 2) * (l.coerceIn(0, 100) / 100f)
            rect.set(rect.left + pad, rect.top + pad, rect.left + pad + inner, rect.bottom - pad)
            canvas.drawRoundRect(rect, r / 2, r / 2, fill)
        }
    }
}
