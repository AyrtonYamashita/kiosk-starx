package com.pstarx.kiosk.ui

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import com.pstarx.kiosk.kiosk.KioskActivity
import com.pstarx.kiosk.kiosk.KioskController

/** Ícone do app na gaveta: com o kiosk ativo, volta para ele; senão, abre a administração (PIN). */
class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val kiosk = KioskController.get(this)
        if (kiosk.enforced) {
            startActivity(Intent(this, KioskActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } else {
            PinActivity.open(this)
        }
        finish()
    }
}
