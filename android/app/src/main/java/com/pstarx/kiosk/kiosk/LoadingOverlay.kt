package com.pstarx.kiosk.kiosk

import android.content.Context
import android.content.res.ColorStateList
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import com.pstarx.kiosk.ui.Theme
import com.pstarx.kiosk.ui.Ui

/**
 * Tela de espera por cima do site (antes de abrir a página): indicador girando, título ("Aguardando conexão com a
 * internet", "Conectando…") e detalhe. Cobre a página inteira e não deixa tocar nela.
 */
class LoadingOverlay(context: Context, background: Int, foreground: Int) : FrameLayout(context) {
    private val title = Ui.text(context, "", Theme.Type.SECTION_TITLE, foreground).apply { gravity = Gravity.CENTER }
    private val detail = Ui.text(context, "", Theme.Type.BODY, Theme.withAlpha(foreground, 0.7f)).apply {
        gravity = Gravity.CENTER
        setLineSpacing(0f, 1.3f)
    }

    init {
        setBackgroundColor(background)
        isClickable = true
        isFocusable = true
        val d = { v: Int -> Theme.dp(context, v) }
        val column = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(d(32), d(24), d(32), d(24))
            addView(ProgressBar(context).apply {
                isIndeterminate = true
                indeterminateTintList = ColorStateList.valueOf(Theme.BLUE_SOFT)
            }, LinearLayout.LayoutParams(d(44), d(44)).apply { bottomMargin = d(20) })
            addView(title, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
            addView(detail, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = d(8) })
        }
        addView(column, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT, Gravity.CENTER))
        contentDescription = "Carregando"
    }

    fun show(titleText: String, detailText: String) {
        title.text = titleText
        detail.text = detailText
        detail.visibility = if (detailText.isBlank()) View.GONE else View.VISIBLE
        visibility = View.VISIBLE
    }

    fun hide() {
        visibility = View.GONE
    }
}
