package com.pstarx.kiosk

import android.app.Application
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import com.pstarx.kiosk.config.ConfigStore
import com.pstarx.kiosk.kiosk.KioskController
import com.pstarx.kiosk.panel.PanelSync

class KioskApp : Application() {
    override fun onCreate() {
        super.onCreate()
        // captura de tela remota: precisa saber qual tela deste app está na frente
        registerActivityLifecycleCallbacks(com.pstarx.kiosk.commands.ScreenCapture.tracker)
        // apps instalados/removidos: o app do kiosk pode ter chegado (ou sumido); a grade precisa redesenhar.
        // Broadcast implícito: só por registro dinâmico (o processo vive enquanto a tela do kiosk for o launcher).
        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_PACKAGE_ADDED)
            addAction(Intent.ACTION_PACKAGE_REMOVED)
            addAction(Intent.ACTION_PACKAGE_CHANGED)
            addAction(Intent.ACTION_PACKAGE_REPLACED)
            addDataScheme("package")
        }
        registerReceiver(object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                KioskController.get(context).apply("packages")
            }
        }, filter)
        // painel: configuração alterada (tela, ADB, importação) vai no próximo check-in, que é antecipado
        ConfigStore.get(this).addListener { PanelSync.now(this, "config") }
        PanelSync.schedule(this)
        // aviso imediato do painel (comandos e configuração chegam em ~1 s, não em até 30 s)
        com.pstarx.kiosk.panel.PanelPush.start(this)
    }
}
