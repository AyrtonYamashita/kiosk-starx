package com.pstarx.kiosk.ui

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.graphics.drawable.StateListDrawable
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.SeekBar
import android.widget.Switch
import android.widget.TextView
import com.pstarx.kiosk.ui.Theme.Type

/**
 * Componentes do design system (sem AndroidX): tradução das receitas do console para Views.
 * Cartão com borda 1dp e raio 10 · botão raio 8 · campo raio 8 · pílula raio 20 · seletor segmentado.
 */
object Ui {
    // nomes antigos, usados nas telas
    val PRIMARY = Theme.BLUE
    val DANGER = Theme.BAD_DEEP
    val MUTED = Theme.SOFT
    val SURFACE = Theme.SUBTLE

    fun dp(ctx: Context, v: Int) = Theme.dp(ctx, v)

    fun duration(ms: Long) = if (ms >= 60_000) "${(ms + 59_999) / 60_000} min" else "${(ms + 999) / 1000} s"

    fun text(ctx: Context, value: CharSequence?, type: Type, color: Int = Theme.INK): TextView = TextView(ctx).apply {
        text = value
        Theme.style(this, type, color)
    }

    private fun pressable(ctx: Context, pressed: Int): Drawable =
        RippleDrawable(ColorStateList.valueOf(pressed), null, Theme.box(ctx, Theme.INK, 0))

    // ---------------------------------------------------------------- estrutura

    /** Rótulo de seção: 10/600, caixa alta, 0.08em, cinza de legenda. */
    fun section(ctx: Context, title: String): TextView = text(ctx, title, Type.SECTION_LABEL, Theme.FAINT).apply {
        setPadding(dp(ctx, 4), dp(ctx, 20), dp(ctx, 4), dp(ctx, 8))
    }

    /** Cartão: superfície branca, borda 1dp #DDDDDD, raio 10, sem sombra. */
    fun card(ctx: Context): LinearLayout = LinearLayout(ctx).apply {
        orientation = LinearLayout.VERTICAL
        background = Theme.box(ctx, Theme.SURFACE, Theme.R_CARD, Theme.LINE)
        clipToOutline = true
    }

    /** Divisória dentro do cartão (entre linhas). */
    fun divider(ctx: Context): View = View(ctx).apply {
        setBackgroundColor(Theme.SUBTLE)
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(ctx, 1).coerceAtLeast(1))
    }

    fun note(ctx: Context, text: CharSequence, color: Int = Theme.MID): TextView = text(ctx, text, Type.BODY, color).apply {
        setPadding(dp(ctx, 16), dp(ctx, 10), dp(ctx, 16), dp(ctx, 10))
        setTextIsSelectable(true)
    }

    /**
     * Faixa de aviso. info: fundo sutil, texto médio, ponto azul de 5dp. critical: fundo/borda vermelhos claros,
     * texto vermelho escuro, ponto de 6dp.
     */
    fun banner(ctx: Context, message: CharSequence, critical: Boolean = false): LinearLayout = LinearLayout(ctx).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setPadding(dp(ctx, 12), dp(ctx, 10), dp(ctx, 12), dp(ctx, 10))
        background = if (critical) Theme.box(ctx, Theme.BAD_TINT, Theme.R_FIELD, Theme.BAD_EDGE) else Theme.box(ctx, Theme.SUBTLE, Theme.R_FIELD)
        val size = dp(ctx, if (critical) 6 else 5)
        addView(dot(ctx, if (critical) Theme.BAD else Theme.BLUE), LinearLayout.LayoutParams(size, size).apply { marginEnd = dp(ctx, 8) })
        addView(
            text(ctx, message, if (critical) Type.BODY_STRONG else Type.BODY, if (critical) Theme.BAD_DEEP else Theme.MID).apply { setTextIsSelectable(true) },
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f),
        )
    }

    fun dot(ctx: Context, color: Int): View = View(ctx).apply {
        background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(color) }
    }

    enum class Tone(val text: Int, val fill: Int, val edge: Int, val dot: Int) {
        GOOD(Theme.GOOD_DEEP, Theme.GOOD_TINT, Theme.GOOD_EDGE, Theme.GOOD),
        BLUE(Theme.BLUE_DEEP, Theme.BLUE_TINT, Theme.BLUE_EDGE, Theme.BLUE),
        WARN(Theme.WARN_DEEP, Theme.WARN_TINT, Theme.WARN_EDGE, Theme.WARN),
        BAD(Theme.BAD_DEEP, Theme.BAD_TINT, Theme.BAD_EDGE, Theme.BAD),
        NEUTRAL(Theme.MID, Theme.SUBTLE, Theme.LINE, Theme.MUTED),
    }

    /** Pílula de status: raio 20, borda 1dp, 10/500, trio cor/fundo/borda da mesma família. */
    fun statusPill(ctx: Context, label: String, tone: Tone): LinearLayout = LinearLayout(ctx).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setPadding(dp(ctx, 8), dp(ctx, 3), dp(ctx, 8), dp(ctx, 3))
        background = Theme.box(ctx, tone.fill, Theme.R_PILL, tone.edge)
        val s = dp(ctx, 6)
        addView(dot(ctx, tone.dot), LinearLayout.LayoutParams(s, s).apply { marginEnd = dp(ctx, 6) })
        addView(text(ctx, label, Type.HELP, tone.text).apply { typeface = Theme.typeface(ctx, Theme.Font.SANS, 500) })
    }

    // ---------------------------------------------------------------- linhas de configuração

    /** Linha clicável dentro de um cartão: título 12.5/500 e descrição 11 cinza. */
    fun row(ctx: Context, title: String, value: CharSequence?, onClick: (() -> Unit)?): LinearLayout = LinearLayout(ctx).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(ctx, 16), dp(ctx, 12), dp(ctx, 16), dp(ctx, 12))
        addView(text(ctx, title, Type.CONTROL))
        if (!value.isNullOrEmpty()) addView(text(ctx, value, Type.CAPTION, Theme.SOFT).apply { setPadding(0, dp(ctx, 3), 0, 0) })
        if (onClick != null) {
            isClickable = true
            isFocusable = true
            background = pressable(ctx, Theme.SUBTLE)
            setOnClickListener { onClick() }
        }
    }

    /** Ação destrutiva: texto vermelho escuro, nunca preenchimento. */
    fun dangerRow(ctx: Context, title: String, value: CharSequence?, onClick: () -> Unit): LinearLayout =
        row(ctx, title, value, onClick).apply { (getChildAt(0) as TextView).setTextColor(Theme.BAD_DEEP) }

    fun switchRow(ctx: Context, title: String, description: String?, checked: Boolean, onChange: (Boolean) -> Unit): LinearLayout {
        val sw = Switch(ctx).apply {
            isChecked = checked
            isClickable = false
            isFocusable = false
            val states = arrayOf(intArrayOf(android.R.attr.state_checked), intArrayOf())
            thumbTintList = ColorStateList(states, intArrayOf(Theme.SURFACE, Theme.SURFACE))
            trackTintList = ColorStateList(states, intArrayOf(Theme.BLUE, Theme.MUTED))
            trackTintMode = android.graphics.PorterDuff.Mode.SRC
        }
        return LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(ctx, 16), dp(ctx, 10), dp(ctx, 12), dp(ctx, 10))
            val texts = LinearLayout(ctx).apply {
                orientation = LinearLayout.VERTICAL
                addView(text(ctx, title, Type.CONTROL))
                if (!description.isNullOrEmpty()) addView(text(ctx, description, Type.CAPTION, Theme.SOFT).apply { setPadding(0, dp(ctx, 3), 0, 0) })
            }
            addView(texts, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            addView(sw)
            isClickable = true
            background = pressable(ctx, Theme.SUBTLE)
            setOnClickListener {
                sw.isChecked = !sw.isChecked
                onChange(sw.isChecked)
            }
        }
    }

    // ---------------------------------------------------------------- campos

    private fun fieldBackground(ctx: Context, error: Boolean = false): Drawable = StateListDrawable().apply {
        addState(intArrayOf(android.R.attr.state_focused), Theme.box(ctx, Theme.SURFACE, Theme.R_FIELD, if (error) Theme.BAD_EDGE else Theme.BLUE))
        addState(intArrayOf(), Theme.box(ctx, Theme.SURFACE, Theme.R_FIELD, if (error) Theme.BAD_EDGE else Theme.LINE))
    }

    /** Campo: altura de controle, raio 8, borda 1dp; 12.5 tinta; borda azul no foco. */
    fun input(ctx: Context, hint: String, mono: Boolean = false): EditText = EditText(ctx).apply {
        this.hint = hint
        Theme.style(this, if (mono) Type.ID else Type.CONTROL)
        if (!mono) typeface = Theme.typeface(ctx, Theme.Font.SANS, 400)
        setHintTextColor(Theme.FAINT)
        background = fieldBackground(ctx)
        minHeight = dp(ctx, Theme.CONTROL)
        setPadding(dp(ctx, 10), dp(ctx, 8), dp(ctx, 10), dp(ctx, 8))
        isSingleLine = true
    }

    fun setFieldError(field: EditText, error: Boolean) {
        field.background = fieldBackground(field.context, error)
    }

    fun textField(ctx: Context, hint: String, value: String, numeric: Boolean = false, onChange: (String) -> Unit): EditText =
        input(ctx, hint, mono = numeric).apply {
            setText(value)
            inputType = if (numeric) InputType.TYPE_CLASS_NUMBER else InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            addTextChangedListener(object : android.text.TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = Unit
                override fun afterTextChanged(s: android.text.Editable?) = onChange(s?.toString().orEmpty())
            })
        }

    /** Rótulo 11/500 médio, 6dp acima do campo; ajuda 10 em cinza claro abaixo. */
    fun labeled(ctx: Context, label: String, field: View, help: String? = null): LinearLayout = LinearLayout(ctx).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(ctx, 16), dp(ctx, 12), dp(ctx, 16), dp(ctx, 12))
        addView(text(ctx, label, Type.LABEL, Theme.MID).apply { setPadding(0, 0, 0, dp(ctx, 6)) })
        addView(field, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        if (help != null) addView(text(ctx, help, Type.HELP, Theme.FAINT).apply { setPadding(0, dp(ctx, 4), 0, 0) })
    }

    fun slider(ctx: Context, label: String, value: Int, range: IntRange, suffix: String, onChange: (Int) -> Unit): LinearLayout {
        val number = text(ctx, "", Type.ID_STRONG, Theme.INK)
        fun show(v: Int) { number.text = "$v$suffix" }
        show(value)
        return LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(ctx, 16), dp(ctx, 12), dp(ctx, 16), dp(ctx, 6))
            addView(LinearLayout(ctx).apply {
                gravity = Gravity.CENTER_VERTICAL
                addView(text(ctx, label, Type.CONTROL), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
                addView(number)
            })
            addView(SeekBar(ctx).apply {
                max = range.last - range.first
                progress = value - range.first
                progressTintList = ColorStateList.valueOf(Theme.BLUE)
                progressBackgroundTintList = ColorStateList.valueOf(Theme.RULE)
                thumbTintList = ColorStateList.valueOf(Theme.BLUE)
                setPadding(dp(ctx, 4), dp(ctx, 10), dp(ctx, 4), dp(ctx, 6))
                setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                    override fun onProgressChanged(sb: SeekBar?, p: Int, fromUser: Boolean) {
                        show(p + range.first)
                        if (fromUser) onChange(p + range.first)
                    }
                    override fun onStartTrackingTouch(sb: SeekBar?) = Unit
                    override fun onStopTrackingTouch(sb: SeekBar?) = Unit
                })
            })
        }
    }

    // ---------------------------------------------------------------- seletor segmentado

    /** Seletor segmentado: trilho sutil raio 7 com 2dp de folga; opção ativa em superfície com sombra mínima. */
    fun segmented(ctx: Context, labels: List<String>, selected: Int, onSelect: (Int) -> Unit): View {
        val track = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(ctx, 2), dp(ctx, 2), dp(ctx, 2), dp(ctx, 2))
            background = Theme.box(ctx, Theme.SUBTLE, Theme.R_NAV)
        }
        labels.forEachIndexed { i, label ->
            val active = i == selected
            track.addView(text(ctx, label, Type.ID, if (active) Theme.INK else Theme.SOFT).apply {
                typeface = Theme.typeface(ctx, Theme.Font.SANS, 500)
                gravity = Gravity.CENTER
                isSingleLine = true
                setPadding(dp(ctx, 12), dp(ctx, 7), dp(ctx, 12), dp(ctx, 7))
                if (active) {
                    background = Theme.box(ctx, Theme.SURFACE, Theme.R_CHIP)
                    elevation = Theme.dpf(ctx, 1f)
                }
                setOnClickListener { onSelect(i) }
            }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                if (i > 0) marginStart = dp(ctx, 4)
            })
        }
        return android.widget.HorizontalScrollView(ctx).apply {
            isHorizontalScrollBarEnabled = false
            // sem o realce de foco cinza do Android (aparece quando o teclado devolve o foco para a tela)
            isFocusable = false
            defaultFocusHighlightEnabled = false
            clipToPadding = false
            setPadding(dp(ctx, 1), dp(ctx, 1), dp(ctx, 1), dp(ctx, 3))
            addView(track)
        }
    }

    /** As opções de escolha única são o seletor segmentado, com o respiro de uma linha de cartão. */
    fun pills(ctx: Context, labels: List<String>, selected: Int, onSelect: (Int) -> Unit): View = FrameLayout(ctx).apply {
        setPadding(dp(ctx, 16), dp(ctx, 12), dp(ctx, 16), dp(ctx, 12))
        addView(segmented(ctx, labels, selected, onSelect))
    }

    // ---------------------------------------------------------------- botões

    enum class Variant { PRIMARY, SECONDARY }

    /** Botão: altura de controle, raio 8, 12.5/500. Primário azul (pressionado mais escuro); secundário branco com borda. */
    fun button(ctx: Context, label: String, variant: Variant = Variant.SECONDARY, onClick: () -> Unit): Button = Button(ctx).apply {
        text = label
        stateListAnimator = null
        Theme.style(this, Type.CONTROL, if (variant == Variant.PRIMARY) Theme.SURFACE else Theme.MID)
        minHeight = dp(ctx, Theme.CONTROL)
        minimumHeight = dp(ctx, Theme.CONTROL)
        minWidth = 0
        minimumWidth = 0
        setPadding(dp(ctx, 16), 0, dp(ctx, 16), 0)
        background = when (variant) {
            Variant.PRIMARY -> StateListDrawable().apply {
                addState(intArrayOf(-android.R.attr.state_enabled), Theme.box(ctx, Theme.MUTED, Theme.R_FIELD))
                addState(intArrayOf(android.R.attr.state_pressed), Theme.box(ctx, Theme.BLUE_PRESS, Theme.R_FIELD))
                addState(intArrayOf(), Theme.box(ctx, Theme.BLUE, Theme.R_FIELD))
            }
            Variant.SECONDARY -> StateListDrawable().apply {
                addState(intArrayOf(android.R.attr.state_pressed), Theme.box(ctx, Theme.SUBTLE, Theme.R_FIELD, Theme.LINE))
                addState(intArrayOf(), Theme.box(ctx, Theme.SURFACE, Theme.R_FIELD, Theme.LINE))
            }
        }
        setOnClickListener { onClick() }
    }
}
