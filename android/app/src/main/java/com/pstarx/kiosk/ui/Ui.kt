package com.pstarx.kiosk.ui

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.text.InputType
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.SeekBar
import android.widget.Switch
import android.widget.TextView

/** Componentes simples da tela de configurações (sem AndroidX). */
object Ui {
    val PRIMARY = Color.rgb(31, 94, 255)
    val DANGER = Color.rgb(200, 40, 40)
    val MUTED = Color.rgb(110, 110, 120)
    val SURFACE = Color.rgb(245, 246, 250)

    fun dp(ctx: Context, v: Int) = (v * ctx.resources.displayMetrics.density).toInt()

    fun duration(ms: Long) = if (ms >= 60_000) "${(ms + 59_999) / 60_000} min" else "${(ms + 999) / 1000} s"

    fun section(ctx: Context, title: String): TextView = TextView(ctx).apply {
        text = title.uppercase()
        setTextColor(PRIMARY)
        typeface = Typeface.DEFAULT_BOLD
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
        setPadding(dp(ctx, 16), dp(ctx, 20), dp(ctx, 16), dp(ctx, 6))
    }

    fun note(ctx: Context, text: CharSequence, color: Int = MUTED): TextView = TextView(ctx).apply {
        this.text = text
        setTextColor(color)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
        setPadding(dp(ctx, 16), dp(ctx, 4), dp(ctx, 16), dp(ctx, 8))
        setTextIsSelectable(true)
    }

    /** Linha clicável com título e valor/descrição embaixo. */
    fun row(ctx: Context, title: String, value: CharSequence?, onClick: (() -> Unit)?): LinearLayout = LinearLayout(ctx).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(ctx, 16), dp(ctx, 12), dp(ctx, 16), dp(ctx, 12))
        addView(TextView(ctx).apply {
            text = title
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            setTextColor(Color.rgb(20, 20, 30))
        })
        if (!value.isNullOrEmpty()) addView(TextView(ctx).apply {
            text = value
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            setTextColor(MUTED)
        })
        if (onClick != null) {
            isClickable = true
            isFocusable = true
            background = ctx.obtainStyledAttributes(intArrayOf(android.R.attr.selectableItemBackground)).let { a ->
                a.getDrawable(0).also { a.recycle() }
            }
            setOnClickListener { onClick() }
        }
    }

    fun switchRow(ctx: Context, title: String, description: String?, checked: Boolean, onChange: (Boolean) -> Unit): LinearLayout {
        val sw = Switch(ctx).apply { isChecked = checked; isClickable = false; isFocusable = false }
        return LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(ctx, 16), dp(ctx, 10), dp(ctx, 16), dp(ctx, 10))
            val texts = LinearLayout(ctx).apply {
                orientation = LinearLayout.VERTICAL
                addView(TextView(ctx).apply { text = title; setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f); setTextColor(Color.rgb(20, 20, 30)) })
                if (!description.isNullOrEmpty()) addView(TextView(ctx).apply { text = description; setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f); setTextColor(MUTED) })
            }
            addView(texts, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            addView(sw)
            isClickable = true
            setOnClickListener {
                sw.isChecked = !sw.isChecked
                onChange(sw.isChecked)
            }
        }
    }

    fun textField(ctx: Context, hint: String, value: String, numeric: Boolean = false, onChange: (String) -> Unit): EditText =
        EditText(ctx).apply {
            this.hint = hint
            setText(value)
            inputType = if (numeric) InputType.TYPE_CLASS_NUMBER else InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            isSingleLine = true
            addTextChangedListener(object : android.text.TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = Unit
                override fun afterTextChanged(s: android.text.Editable?) = onChange(s?.toString().orEmpty())
            })
        }

    /** Campo com rótulo em cima. */
    fun labeled(ctx: Context, label: String, field: View): LinearLayout = LinearLayout(ctx).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(ctx, 16), dp(ctx, 8), dp(ctx, 16), dp(ctx, 4))
        addView(TextView(ctx).apply { text = label; setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f); setTextColor(Color.rgb(20, 20, 30)) })
        addView(field)
    }

    fun slider(ctx: Context, label: String, value: Int, range: IntRange, suffix: String, onChange: (Int) -> Unit): LinearLayout {
        val title = TextView(ctx).apply { setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f); setTextColor(Color.rgb(20, 20, 30)) }
        fun show(v: Int) { title.text = "$label: $v$suffix" }
        show(value)
        return LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(ctx, 16), dp(ctx, 8), dp(ctx, 16), dp(ctx, 4))
            addView(title)
            addView(SeekBar(ctx).apply {
                max = range.last - range.first
                progress = value - range.first
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

    /** Fileira de opções (uma selecionada), com rolagem horizontal em telas estreitas. */
    fun pills(ctx: Context, labels: List<String>, selected: Int, onSelect: (Int) -> Unit): View {
        val row = LinearLayout(ctx).apply { setPadding(dp(ctx, 12), 0, dp(ctx, 12), 0) }
        labels.forEachIndexed { i, label ->
            row.addView(pill(ctx, label, i == selected) { onSelect(i) },
                LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginEnd = dp(ctx, 8) })
        }
        return android.widget.HorizontalScrollView(ctx).apply { isHorizontalScrollBarEnabled = false; addView(row) }
    }

    fun pill(ctx: Context, text: String, selected: Boolean, onClick: () -> Unit): TextView = TextView(ctx).apply {
        this.text = text
        isSingleLine = true
        gravity = Gravity.CENTER
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
        setPadding(dp(ctx, 16), dp(ctx, 10), dp(ctx, 16), dp(ctx, 10))
        setTextColor(if (selected) Color.WHITE else Color.rgb(20, 20, 30))
        background = GradientDrawable().apply {
            cornerRadius = dp(ctx, 20).toFloat()
            setColor(if (selected) PRIMARY else SURFACE)
        }
        setOnClickListener { onClick() }
    }

    fun divider(ctx: Context): View = View(ctx).apply {
        setBackgroundColor(Color.rgb(230, 230, 236))
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 1)
    }
}
