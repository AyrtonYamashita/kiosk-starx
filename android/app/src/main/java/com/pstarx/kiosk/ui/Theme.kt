package com.pstarx.kiosk.ui

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.util.TypedValue
import android.widget.TextView

/**
 * Tokens do design system: identidade visual Starx (starx-kiosk-brand/BRAND.md; mesmos valores do painel em
 * web/src/app/tokens.css, modo claro). Neutros em azul-ardósia, um só azul de ação, escuro azul-marinho (nunca preto).
 * Títulos e marca = Space Grotesk; texto = Inter; dado de máquina = IBM Plex Mono.
 * Nada de cor literal fora daqui (res/values/colors.xml espelha estes valores para o tema XML).
 */
object Theme {
    // ---------------------------------------------------------------- neutros (claro)
    val INK = Color.parseColor("#0A1A2F")
    val MID = Color.parseColor("#334155")
    val SOFT = Color.parseColor("#5B6B80")
    val FAINT = Color.parseColor("#94A3B8") // só decorativo, nunca texto
    val MUTED = Color.parseColor("#CBD5E1") // só decorativo
    val LINE = Color.parseColor("#E2E8F0")
    val RULE = Color.parseColor("#EDF1F6")
    val SUBTLE = Color.parseColor("#F1F5F9")
    val CANVAS = Color.parseColor("#F8FAFC")
    val SURFACE = Color.WHITE

    // ---------------------------------------------------------------- semânticas: base · deep · tint · edge
    /** Interação e marca (o único acento). */
    val BLUE = Color.parseColor("#1560D4")
    val BLUE_DEEP = Color.parseColor("#0F4DB0")
    val BLUE_PRESS = BLUE_DEEP
    val BLUE_TINT = Color.parseColor("#EEF4FD")
    val BLUE_EDGE = Color.parseColor("#DCE9FC")
    /** O azul de ação sobre fundo escuro (clareia no escuro). */
    val BLUE_SOFT = Color.parseColor("#5B9BF5")

    // base = ponto de estado (sempre com texto ao lado); deep = texto
    val GOOD = Color.parseColor("#22C55E")
    val GOOD_DEEP = Color.parseColor("#15803D")
    val GOOD_TINT = Color.parseColor("#ECFDF3")
    val GOOD_EDGE = Color.parseColor("#BBF7D0")

    val WARN = Color.parseColor("#F59E0B")
    val WARN_DEEP = Color.parseColor("#B45309")
    val WARN_TINT = Color.parseColor("#FFF7E6")
    val WARN_EDGE = Color.parseColor("#FDE68A")

    val BAD = Color.parseColor("#EF4444")
    val BAD_DEEP = Color.parseColor("#B91C1C")
    val BAD_TINT = Color.parseColor("#FEF1F1")
    val BAD_EDGE = Color.parseColor("#FECACA")

    // ---------------------------------------------------------------- superfícies escuras (tela do kiosk, rodapé)
    val NIGHT = Color.parseColor("#070E1A")
    val NIGHT_SURFACE = Color.parseColor("#0E1A2B")
    val NIGHT_LINE = Color.parseColor("#1E3350")
    val NIGHT_INK = Color.parseColor("#E8EEF7")
    val NIGHT_SOFT = Color.parseColor("#93A4BA")

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

    enum class Font { SANS, DISPLAY, MONO }

    private val cache = HashMap<String, Typeface>()

    /** Inter (texto) ou Space Grotesk (títulos), variáveis no eixo wght, ou IBM Plex Mono 400/500 (dado de máquina: IP, SSID, %, hora). */
    fun typeface(ctx: Context, font: Font, weight: Int): Typeface {
        val key = "$font$weight"
        return synchronized(cache) {
            cache.getOrPut(key) {
                runCatching {
                    when (font) {
                        // res/font/inter.xml e space_grotesk.xml: um arquivo variável cada, com os pesos usados
                        Font.SANS -> Typeface.create(ctx.resources.getFont(com.pstarx.kiosk.R.font.inter), weight, false)
                        Font.DISPLAY -> Typeface.create(ctx.resources.getFont(com.pstarx.kiosk.R.font.space_grotesk), weight, false)
                        Font.MONO -> Typeface.createFromAsset(ctx.assets, if (weight >= 500) "fonts/plexmono-medium.ttf" else "fonts/plexmono-regular.ttf")
                    }
                }.getOrElse { Typeface.create(if (font == Font.MONO) Typeface.MONOSPACE else Typeface.SANS_SERIF, if (weight >= 600) Typeface.BOLD else Typeface.NORMAL) }
            }
        }
    }

    /** Degrau da escala: tamanho (sp), peso, tracking (em) e fonte. */
    enum class Type(val sp: Float, val weight: Int, val tracking: Float = 0f, val font: Font = Font.SANS, val caps: Boolean = false) {
        PAGE_TITLE(24f, 700, -0.03f, Font.DISPLAY),
        SECTION_TITLE(18f, 500, -0.02f, Font.DISPLAY),
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
