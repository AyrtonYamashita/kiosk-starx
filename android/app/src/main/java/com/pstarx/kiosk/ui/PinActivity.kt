package com.pstarx.kiosk.ui

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.text.InputType
import android.util.TypedValue
import android.view.Gravity
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import com.pstarx.kiosk.config.ConfigStore
import com.pstarx.kiosk.kiosk.KioskController
import com.pstarx.kiosk.security.PinGate
import kotlin.concurrent.thread

/** Pedido do PIN de administrador. Acertou: abre as configurações. Sem PIN definido: abre direto. */
class PinActivity : Activity() {
    private lateinit var gate: PinGate
    private lateinit var input: EditText
    private lateinit var error: TextView
    private lateinit var ok: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        gate = PinGate(this)
        val pinHash = ConfigStore.get(this).config.security.pinHash
        if (pinHash == null) {
            openSettings()
            return
        }
        setFinishOnTouchOutside(false)
        input = EditText(this).apply {
            inputType = if (pinHash.numeric) InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
            else InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            hint = "PIN"
            gravity = Gravity.CENTER
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
            imeOptions = EditorInfo.IME_ACTION_DONE
            setOnEditorActionListener { _, _, _ -> check(); true }
        }
        error = TextView(this).apply { setTextColor(Ui.DANGER); gravity = Gravity.CENTER }
        ok = Button(this).apply { text = "Entrar"; setOnClickListener { check() } }
        val cancel = Button(this).apply { text = "Cancelar"; setOnClickListener { finish() } }
        val pad = Ui.dp(this, 24)
        setContentView(
            LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(pad, pad, pad, pad / 2)
                minimumWidth = Ui.dp(this@PinActivity, 300)
                addView(TextView(this@PinActivity).apply { text = "Administração do kiosk"; setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f) })
                addView(input)
                addView(error)
                addView(LinearLayout(this@PinActivity).apply {
                    gravity = Gravity.END
                    addView(cancel)
                    addView(ok)
                })
            },
        )
        gate.lockedForMs().takeIf { it > 0 }?.let { error.text = "Muitas tentativas. Tente de novo em ${Ui.duration(it)}." }
    }

    private fun check() {
        val pin = input.text.toString()
        if (!ok.isEnabled || pin.isEmpty()) return
        ok.isEnabled = false
        error.text = "Verificando…"
        thread {
            val result = gate.check(pin)
            runOnUiThread {
                if (isFinishing) return@runOnUiThread
                ok.isEnabled = true
                input.text.clear()
                error.text = when (result) {
                    PinGate.Result.Ok, PinGate.Result.NoPin -> { openSettings(); "" }
                    is PinGate.Result.Locked -> "Muitas tentativas. Tente de novo em ${Ui.duration(result.remainingMs)}."
                    is PinGate.Result.Wrong -> if (result.lockedForMs > 0) "PIN incorreto. Bloqueado por ${Ui.duration(result.lockedForMs)}."
                    else "PIN incorreto (${result.freeAttemptsLeft} tentativa(s) antes do bloqueio)"
                }
            }
        }
    }

    private fun openSettings() {
        KioskController.get(this).beginAdminSession()
        startActivity(Intent(this, SettingsActivity::class.java))
        finish()
    }

    companion object {
        fun open(context: Context) {
            context.startActivity(
                Intent(context, PinActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            )
        }
    }
}
