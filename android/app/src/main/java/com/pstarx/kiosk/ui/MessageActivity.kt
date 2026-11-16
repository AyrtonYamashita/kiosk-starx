package com.pstarx.kiosk.ui

import android.app.Activity
import android.graphics.Typeface
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.pstarx.kiosk.commands.Commands
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/** Mensagem do painel na tela, por cima do kiosk, até alguém tocar em OK. O painel vê "exibida" e depois "lida". */
class MessageActivity : Activity() {
    private var commandId: String? = null
    private var shownReported = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setShowWhenLocked(true)
        setTurnScreenOn(true)
        setFinishOnTouchOutside(false)
        commandId = intent.getStringExtra(EXTRA_ID)
        shownReported = savedInstanceState?.getBoolean("shown") ?: false
        val title = intent.getStringExtra(EXTRA_TITLE) ?: "Mensagem"
        val text = intent.getStringExtra(EXTRA_TEXT).orEmpty()
        val pad = Ui.dp(this, 20)

        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad, pad, pad)
        }
        column.addView(TextView(this).apply {
            this.text = title
            typeface = Typeface.DEFAULT_BOLD
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
        })
        column.addView(ScrollView(this).apply {
            addView(TextView(this@MessageActivity).apply {
                this.text = text
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
                setPadding(0, Ui.dp(this@MessageActivity, 12), 0, Ui.dp(this@MessageActivity, 16))
            })
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        column.addView(Button(this).apply {
            this.text = "OK"
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
            setOnClickListener { acknowledge() }
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { gravity = Gravity.END })
        setContentView(column)
        window.setLayout((resources.displayMetrics.widthPixels * 0.9).toInt(), ViewGroup.LayoutParams.WRAP_CONTENT)
    }

    override fun onResume() {
        super.onResume()
        val id = commandId ?: return
        if (!shownReported) {
            shownReported = true
            Commands.report(this, id, Commands.Outcome(true, "exibida na tela"))
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putBoolean("shown", shownReported)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        // só sai pelo OK (confirma a leitura)
    }

    private fun acknowledge() {
        commandId?.let { id ->
            val now = Date()
            val iso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.format(now)
            val local = SimpleDateFormat("HH:mm", Locale.getDefault()).format(now)
            Commands.report(this, id, Commands.Outcome(true, "lida às $local", JSONObject().put("ackAt", iso)))
        }
        finishAndRemoveTask()
    }

    companion object {
        const val EXTRA_ID = "id"
        const val EXTRA_TITLE = "title"
        const val EXTRA_TEXT = "text"
    }
}
