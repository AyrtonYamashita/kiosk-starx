package com.pstarx.kiosk.ui

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.util.TypedValue
import android.widget.TextView

/**
 * Tokens do design system (mesma base do Sentinel RMM: neutros, semânticas, escala tipográfica, raios e alturas).
 * Só a família de acento e a fonte são próprias do StarX Kiosk:
 *   acento = paleta #98CEFF · #6EA5D4 · #447EAA · #135882 · #003659 · #001425; texto = Outfit; dado de máquina = IBM Plex Mono.
 * Nada de cor literal fora daqui.
 */
object Theme {
    // ---------------------------------------------------------------- paleta (acento)
    val P1 = Color.parseColor("#98CEFF")
    val P2 = Color.parseColor("#6EA5D4")
    val P3 = Color.parseColor("#447EAA")
    val P4 = Color.parseColor("#135882")
    val P5 = Color.parseColor("#003659")
    val P6 = Color.parseColor("#001425")

    // ---------------------------------------------------------------- neutros
    val INK = Color.parseColor("#141414")
    val MID = Color.parseColor("#595959")
    val SOFT = Color.parseColor("#8C8C8C")
    val FAINT = Color.parseColor("#A6A6A6")
    val MUTED = Color.parseColor("#C4C4C4")
    val LINE = Color.parseColor("#DDDDDD")
    val RULE = Color.parseColor("#EEEEEE")
    val SUBTLE = Color.parseColor("#F5F5F5")
    val CANVAS = Color.parseColor("#FAFAFA")
    val SURFACE = Color.WHITE

    // ---------------------------------------------------------------- semânticas: base · deep · tint · edge
    /** Interação (o único acento). */
    val BLUE = P4
    val BLUE_DEEP = P5
    val BLUE_PRESS = P5
    val BLUE_TINT = Color.parseColor("#EEF7FF") // P1 a 16% sobre branco
    val BLUE_EDGE = P1

    val GOOD = Color.parseColor("#22C55E")
    val GOOD_DEEP = Color.parseColor("#15803D")
    val GOOD_TINT = Color.parseColor("#F0FDF4")
    val GOOD_EDGE = Color.parseColor("#BBF7D0")

    val WARN = Color.parseColor("#F59E0B")
    val WARN_DEEP = Color.parseColor("#B45309")
    val WARN_TINT = Color.parseColor("#FFFBEB")
    val WARN_EDGE = Color.parseColor("#FDE68A")

    val BAD = Color.parseColor("#EF4444")
    val BAD_DEEP = Color.parseColor("#B91C1C")
    val BAD_TINT = Color.parseColor("#FEF2F2")
    val BAD_EDGE = Color.parseColor("#FECACA")

    // ---------------------------------------------------------------- superfícies escuras (tela do kiosk, rodapé)
    val NIGHT = P6
    val NIGHT_SURFACE = P5
    val NIGHT_INK = Color.parseColor("#EDEDEF")
    val NIGHT_SOFT = P2

    // ---------------------------------------------------------------- medidas (dp)
    const val R_BAR = 2
    const val R_CHIP = 5
    const val R_NAV = 7
    const val R_FIELD = 8
    const val R_CARD = 10
    const val R_PILL = 20
    const val CONTROL = 40 // campo/botão: 34 no console; 40 no toque (alvo mínimo do PWA é 44 com a margem)
    const val HEADER = 48
    const val FOOTER = 28

    // ---------------------------------------------------------------- tipografia

    enum class Font { SANS, MONO }

    private val cache = HashMap<String, Typeface>()

    /** Outfit (variável, eixo wght) ou IBM Plex Mono 400/500 (dado de máquina: IP, SSID, %, hora). */
    fun typeface(ctx: Context, font: Font, weight: Int): Typeface {
        val key = "$font$weight"
        return synchronized(cache) {
            cache.getOrPut(key) {
                runCatching {
                    when (font) {
                        // res/font/outfit.xml: o mesmo arquivo variável com 400/500/600/700
                        Font.SANS -> Typeface.create(ctx.resources.getFont(com.pstarx.kiosk.R.font.outfit), weight, false)
                        Font.MONO -> Typeface.createFromAsset(ctx.assets, if (weight >= 500) "fonts/plexmono-medium.ttf" else "fonts/plexmono-regular.ttf")
                    }
                }.getOrElse { Typeface.create(if (font == Font.MONO) Typeface.MONOSPACE else Typeface.SANS_SERIF, if (weight >= 600) Typeface.BOLD else Typeface.NORMAL) }
            }
        }
    }

    /** Degrau da escala: tamanho (sp), peso, tracking (em) e fonte. */
    enum class Type(val sp: Float, val weight: Int, val tracking: Float = 0f, val font: Font = Font.SANS, val caps: Boolean = false) {
        PAGE_TITLE(24f, 600, -0.02f),
        SECTION_TITLE(18f, 600, -0.015f),
        NUMBER(28f, 600, -0.02f, Font.MONO),
        CARD_TITLE(13f, 600),
        BODY(12f, 400),
        BODY_STRONG(12f, 500),
        CONTROL(12.5f, 500),
        LABEL(11f, 500),
        ID(11.5f, 400, 0f, Font.MONO),
        ID_STRONG(11.5f, 500, 0f, Font.MONO),
        CAPTION(11f, 400),
        HELP(10f, 400),
        TABLE_HEAD(10f, 600, 0.06f, Font.SANS, caps = true),
        SECTION_LABEL(10f, 600, 0.08f, Font.SANS, caps = true),
    }

    fun style(tv: TextView, type: Type, color: Int = INK) {
        tv.typeface = typeface(tv.context, type.font, type.weight)
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, type.sp)
        tv.letterSpacing = type.tracking
        tv.isAllCaps = type.caps
        tv.setTextColor(color)
        tv.includeFontPadding = false
        tv.setLineSpacing(0f, 1.3f)
    }

    // ---------------------------------------------------------------- formas

    fun dp(ctx: Context, v: Int) = (v * ctx.resources.displayMetrics.density).toInt()
    fun dpf(ctx: Context, v: Float) = v * ctx.resources.displayMetrics.density

    /** Retângulo com raio, preenchimento e borda de 1dp (cartões usam borda, nunca sombra). */
    fun box(ctx: Context, fill: Int, radiusDp: Int, stroke: Int? = null): GradientDrawable = GradientDrawable().apply {
        cornerRadius = dpf(ctx, radiusDp.toFloat())
        setColor(fill)
        if (stroke != null) setStroke(dp(ctx, 1).coerceAtLeast(1), stroke)
    }

    fun withAlpha(color: Int, alpha: Float): Int = Color.argb((alpha * 255).toInt().coerceIn(0, 255), Color.red(color), Color.green(color), Color.blue(color))
}
