package com.pstarx.kiosk.kiosk

import android.animation.ValueAnimator
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.net.ConnectivityManager
import android.net.Network
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.animation.AccelerateDecelerateInterpolator
import android.widget.ImageView
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
 * (sem "Barra de status" e sem "Notificações").
 *
 *   [↻]  ((·)) Rede-Wi-Fi…  -58 dBm                [▮▮▮ ] 87%   14:32
 *
 * O nome da rede ocupa o espaço que sobra e ganha "…" quando não cabe; bateria e hora nunca encolhem.
 * Cor só como estado: bateria verde → âmbar → vermelha; carregando, um brilho percorre a barra (o "shimmer" das
 * barras de uso do console); fraca, a bateria pulsa em vermelho.
 */
class StatusFooter(context: Context, onReload: (() -> Unit)? = null, private val lowPercent: Int = 15) : LinearLayout(context) {
    private val main = Handler(Looper.getMainLooper())
    private val info = DeviceInfo(context)
    private val wifi = WifiGlyph(context)
    private val bars = SignalBars(context)
    private val network = Ui.text(context, "", Type.LABEL, Theme.NIGHT_INK).apply {
        isSingleLine = true
        ellipsize = android.text.TextUtils.TruncateAt.END
    }
    private val signal = Ui.text(context, "", Type.CAPTION, Theme.NIGHT_SOFT).apply {
        typeface = Theme.typeface(context, Theme.Font.MONO, 400)
        isSingleLine = true
    }
    private val battery = BatteryGlyph(context)
    private val batteryText = Ui.text(context, "", Type.ID, Theme.NIGHT_INK).apply { isSingleLine = true }
    private val clock = Ui.text(context, "", Type.ID_STRONG, Theme.NIGHT_INK).apply { isSingleLine = true }
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
        override fun onAvailable(n: Network) { post { updateNetwork() } }
        override fun onLost(n: Network) { post { updateNetwork() } }
        override fun onCapabilitiesChanged(n: Network, caps: android.net.NetworkCapabilities) { post { updateNetwork() } }
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
        val d = { v: Int -> Theme.dp(context, v) }
        setPadding(d(if (onReload != null) 6 else 12), 0, d(12), 0)
        background = android.graphics.drawable.LayerDrawable(
            arrayOf(
                android.graphics.drawable.ColorDrawable(Theme.NIGHT_SURFACE),
                android.graphics.drawable.ColorDrawable(Theme.NIGHT),
            ),
        ).apply { setLayerInset(1, 0, d(1).coerceAtLeast(1), 0, 0) } // contorno de 1dp no topo
        contentDescription = "Barra de status"

        // atalho de recarregar a página (modo site, quando ligado no perfil): só o ícone, alvo de toque de 28dp
        if (onReload != null) {
            addView(ImageView(context).apply {
                setImageResource(com.pstarx.kiosk.R.drawable.ic_reload)
                imageTintList = android.content.res.ColorStateList.valueOf(Theme.NIGHT_INK)
                scaleType = ImageView.ScaleType.CENTER_INSIDE
                setPadding(d(7), d(5), d(7), d(5))
                background = android.graphics.drawable.RippleDrawable(
                    android.content.res.ColorStateList.valueOf(Theme.withAlpha(Theme.BLUE_SOFT, 0.3f)),
                    Theme.box(context, Theme.NIGHT_SURFACE, Theme.R_NAV),
                    null,
                )
                contentDescription = "Recarregar página"
                setOnClickListener { onReload() }
            }, LayoutParams(d(28), d(22)).apply { marginEnd = d(10) })
        }
        // esquerda: ícone da rede, nome (encolhe com "…") e dBm
        addView(wifi, LayoutParams(d(14), d(12)).apply { marginEnd = d(7) })
        addView(bars.apply { visibility = GONE }, LayoutParams(d(14), d(11)).apply { marginEnd = d(7) })
        addView(network, LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = d(6) })
        addView(signal, LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginEnd = d(12) })
        // direita: tamanho fixo (bateria e hora nunca cortam)
        addView(battery, LayoutParams(d(20), d(10)).apply { marginEnd = d(5) })
        addView(batteryText, LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginEnd = d(10) })
        addView(clock, LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))
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
        battery.stop()
        super.onDetachedFromWindow()
    }

    private fun updateClock() {
        clock.text = timeFormat.format(Date())
    }

    private fun updateBattery() {
        val b = info.battery()
        val level = if (b.isNull("level")) null else b.optInt("level")
        val charging = b.optBoolean("charging")
        val low = !charging && level != null && lowPercent > 0 && level <= lowPercent
        battery.set(level, charging, low, lowPercent)
        batteryText.text = level?.let { "$it%" } ?: "—"
        batteryText.setTextColor(if (low) Theme.BAD else Theme.NIGHT_INK)
    }

    private fun updateNetwork() {
        thread {
            val n = runCatching { info.network() }.getOrNull()
            main.post {
                val type = n?.optString("type") ?: "none"
                val w = n?.optJSONObject("wifi")
                wifi.visibility = if (type == "cellular") GONE else VISIBLE
                bars.visibility = if (type == "cellular") VISIBLE else GONE
                network.setTextColor(Theme.NIGHT_INK)
                when (type) {
                    "wifi" -> {
                        val rssi = w?.optInt("rssi", -127) ?: -127
                        val ssid = w?.optString("ssid")?.takeIf { w.has("ssid") && !w.isNull("ssid") && it.isNotBlank() }
                        wifi.set(levelOf(rssi), Theme.BLUE_SOFT)
                        network.text = ssid ?: "Wi-Fi"
                        signal.text = if (rssi > -127) "$rssi dBm" else ""
                    }
                    "ethernet" -> { wifi.set(4, Theme.BLUE_SOFT); network.text = "Cabo"; signal.text = "" }
                    "cellular" -> { bars.set(3, Theme.BLUE_SOFT); network.text = "Dados móveis"; signal.text = "" }
                    "none" -> {
                        wifi.set(0, Theme.BAD)
                        network.text = "Sem rede"
                        network.setTextColor(Theme.BAD)
                        signal.text = ""
                    }
                    else -> { wifi.set(2, Theme.BLUE_SOFT); network.text = "Conectado"; signal.text = "" }
                }
            }
        }
    }

    /** dBm → 0..4 (mesmos limites que o Android usa para Wi-Fi). */
    private fun levelOf(rssi: Int) = when {
        rssi >= -55 -> 4
        rssi >= -66 -> 3
        rssi >= -77 -> 2
        rssi >= -88 -> 1
        else -> 0
    }

    /** Ícone de Wi-Fi: ponto e três arcos em leque; acesos conforme o nível (1 = só o ponto, 4 = tudo). */
    private class WifiGlyph(context: Context) : View(context) {
        private var level = 0
        private var color = Theme.BLUE_SOFT
        private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND }
        private val dot = Paint(Paint.ANTI_ALIAS_FLAG)
        private val arc = RectF()

        fun set(level: Int, color: Int) {
            this.level = level
            this.color = color
            invalidate()
        }

        override fun onDraw(canvas: Canvas) {
            val cx = width / 2f
            val sw = width / 9f
            val bottom = height - sw / 2
            stroke.strokeWidth = sw
            val off = Theme.NIGHT_LINE
            // ponto
            dot.color = if (level >= 1) color else off
            canvas.drawCircle(cx, bottom - sw * 0.6f, sw * 0.85f, dot)
            // arcos (pequeno → grande)
            val maxR = (width / 2f).coerceAtMost(height - sw).coerceAtLeast(1f)
            for (i in 1..3) {
                val r = maxR * i / 3f
                arc.set(cx - r, bottom - sw * 0.6f - r, cx + r, bottom - sw * 0.6f + r)
                stroke.color = if (level >= i + 1) color else off
                canvas.drawArc(arc, 225f, 90f, false, stroke)
            }
        }
    }

    /** Dados móveis: quatro barras de raio 2dp (as barras de uso do console, em pé). */
    private class SignalBars(context: Context) : View(context) {
        private var level = 0
        private var color = Theme.BLUE_SOFT
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
                paint.color = if (i < level) color else Theme.NIGHT_LINE
                canvas.drawRoundRect(rect, r, r, paint)
            }
        }
    }

    /**
     * Bateria: contorno de 1dp, ponta, preenchimento proporcional. Cor é estado (verde; âmbar até o dobro do limite;
     * vermelho no limite). Carregando: um brilho atravessa o preenchimento (2,8 s, como o shimmer do console).
     * Fraca: a bateria inteira pulsa em vermelho (1,2 s).
     */
    private class BatteryGlyph(context: Context) : View(context) {
        private var level: Int? = null
        private var charging = false
        private var low = false
        private var lowPercent = 15
        private var phase = 0f
        private var animator: ValueAnimator? = null
        private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = Theme.dpf(context, 1f) }
        private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
        private val shine = Paint(Paint.ANTI_ALIAS_FLAG)
        private val r = Theme.dpf(context, Theme.R_BAR.toFloat())
        private val rect = RectF()

        fun set(level: Int?, charging: Boolean, low: Boolean, lowPercent: Int) {
            val modeChanged = charging != this.charging || low != this.low
            this.level = level
            this.charging = charging
            this.low = low
            this.lowPercent = lowPercent
            if (modeChanged || (animator == null && (charging || low))) restartAnimation()
            invalidate()
        }

        private fun restartAnimation() {
            stop()
            if (!charging && !low) return
            animator = ValueAnimator.ofFloat(0f, 1f).apply {
                duration = if (charging) 2_800L else 1_200L
                repeatCount = ValueAnimator.INFINITE
                repeatMode = if (charging) ValueAnimator.RESTART else ValueAnimator.REVERSE
                interpolator = AccelerateDecelerateInterpolator()
                addUpdateListener {
                    phase = it.animatedValue as Float
                    invalidate()
                }
                start()
            }
        }

        fun stop() {
            animator?.cancel()
            animator = null
            phase = 0f
        }

        override fun onDetachedFromWindow() {
            stop()
            super.onDetachedFromWindow()
        }

        override fun onDraw(canvas: Canvas) {
            val tip = Theme.dpf(context, 2f)
            val half = stroke.strokeWidth / 2
            // fraca: pulsa entre 35% e 100% de opacidade
            val pulse = if (low) (0.35f + 0.65f * (1f - phase)) else 1f
            val outline = if (low) Theme.BAD else Theme.NIGHT_SOFT
            stroke.color = Theme.withAlpha(outline, pulse)
            rect.set(half, half, width - tip - half, height - half)
            canvas.drawRoundRect(rect, r, r, stroke)
            fill.color = Theme.withAlpha(outline, pulse)
            canvas.drawRect(width - tip, height * 0.3f, width.toFloat(), height * 0.7f, fill)
            val l = level ?: return
            val color = when {
                charging -> Theme.GOOD
                low -> Theme.BAD
                l <= lowPercent * 2 -> Theme.WARN
                else -> Theme.GOOD
            }
            fill.color = Theme.withAlpha(color, pulse)
            val pad = stroke.strokeWidth * 1.5f
            val innerW = rect.width() - pad * 2
            val fillW = innerW * (l.coerceIn(3, 100) / 100f)
            val left = rect.left + pad
            rect.set(left, rect.top + pad, left + fillW, rect.bottom - pad)
            canvas.drawRoundRect(rect, r / 2, r / 2, fill)
            if (charging) {
                // brilho: faixa clara de 40% da largura atravessando o preenchimento
                val band = innerW * 0.4f
                val x = left - band + (innerW + band) * phase
                shine.shader = LinearGradient(x, 0f, x + band, 0f, intArrayOf(0x00FFFFFF, 0x99FFFFFF.toInt(), 0x00FFFFFF), null, Shader.TileMode.CLAMP)
                canvas.save()
                canvas.clipRect(rect)
                canvas.drawRect(x, rect.top, x + band, rect.bottom, shine)
                canvas.restore()
            }
        }
    }
}
