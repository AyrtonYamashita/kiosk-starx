package com.pstarx.kiosk.boot

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.pstarx.kiosk.kiosk.KioskController
import com.pstarx.kiosk.panel.PanelSync

/** Reaplica a configuração no boot e depois de atualizar o próprio APK. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED -> {
                Log.i("BootReceiver", "Aplicando configuração (${intent.action})")
                KioskController.get(context).apply("boot")
                PanelSync.now(context, "boot")
            }
        }
    }
}
