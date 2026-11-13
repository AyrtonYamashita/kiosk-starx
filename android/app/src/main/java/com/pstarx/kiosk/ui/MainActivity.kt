package com.pstarx.kiosk.ui

import android.app.Activity
import android.os.Bundle
import com.pstarx.kiosk.kiosk.KioskController

/** Ícone do app na gaveta: com o kiosk ativo, volta para ele; senão, abre a administração (PIN). */
class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val kiosk = KioskController.get(this)
        if (kiosk.enforced) {
            startActivity(kiosk.homeIntent())
        } else {
            PinActivity.open(this)
        }
        finish()
    }
}
