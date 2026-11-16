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
        input = Ui.input(this, "••••", mono = true).apply {
            inputType = if (pinHash.numeric) InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
            else InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            gravity = Gravity.CENTER
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
            letterSpacing = 0.2f
            imeOptions = EditorInfo.IME_ACTION_DONE
            setOnEditorActionListener { _, _, _ -> check(); true }
        }
        // mensagem sob o campo: 10, vermelho escuro (a borda do campo fica vermelha junto)
        error = Ui.text(this, "", Theme.Type.HELP, Theme.BAD_DEEP).apply { setPadding(0, Ui.dp(this@PinActivity, 6), 0, 0) }
        ok = Ui.button(this, "Entrar", Ui.Variant.PRIMARY) { check() }
        val cancel = Ui.button(this, "Cancelar") { finish() }
        val pad = Ui.dp(this, 24)
        setContentView(
            LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(pad, pad, pad, pad)
                minimumWidth = Ui.dp(this@PinActivity, 300)
                addView(Ui.text(this@PinActivity, "Administração do kiosk", Theme.Type.SECTION_TITLE))
                addView(Ui.text(this@PinActivity, "Digite o PIN para abrir as configurações.", Theme.Type.BODY, Theme.SOFT).apply {
                    setPadding(0, Ui.dp(this@PinActivity, 4), 0, Ui.dp(this@PinActivity, 20))
                })
                addView(Ui.text(this@PinActivity, "PIN", Theme.Type.LABEL, Theme.MID).apply { setPadding(0, 0, 0, Ui.dp(this@PinActivity, 6)) })
                addView(input, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
                addView(error)
                addView(LinearLayout(this@PinActivity).apply {
                    gravity = Gravity.END
                    setPadding(0, Ui.dp(this@PinActivity, 20), 0, 0)
                    addView(cancel)
                    addView(ok, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { marginStart = Ui.dp(this@PinActivity, 8) })
                })
            },
        )
        gate.lockedForMs().takeIf { it > 0 }?.let {
            error.text = "Muitas tentativas. Tente de novo em ${Ui.duration(it)}."
            Ui.setFieldError(input, true)
        }
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
                val msg = when (result) {
                    PinGate.Result.Ok, PinGate.Result.NoPin -> { openSettings(); "" }
                    is PinGate.Result.Locked -> "Muitas tentativas. Tente de novo em ${Ui.duration(result.remainingMs)}."
                    is PinGate.Result.Wrong -> if (result.lockedForMs > 0) "PIN incorreto. Bloqueado por ${Ui.duration(result.lockedForMs)}."
                    else "PIN incorreto (${result.freeAttemptsLeft} tentativa(s) antes do bloqueio)"
                }
                error.text = msg
                Ui.setFieldError(input, msg.isNotEmpty())
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
