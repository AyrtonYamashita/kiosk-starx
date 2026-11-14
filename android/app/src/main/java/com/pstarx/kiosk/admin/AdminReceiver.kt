package com.pstarx.kiosk.admin

import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PersistableBundle
import android.util.Base64
import android.util.Log
import com.pstarx.kiosk.config.ConfigStore
import com.pstarx.kiosk.kiosk.KioskController
import com.pstarx.kiosk.panel.PanelStore
import com.pstarx.kiosk.panel.PanelSync
import org.json.JSONObject
import kotlin.concurrent.thread

class AdminReceiver : DeviceAdminReceiver() {

    override fun onEnabled(context: Context, intent: Intent) {
        Log.i(TAG, "Admin habilitado (Device Owner: ${DeviceOwner.isDeviceOwner(context)})")
        DeviceOwner.grantSelfPermissions(context)
        KioskController.get(context).apply("admin_enabled")
    }

    /** Fim do provisionamento por QR: os extras do QR (PROVISIONING_ADMIN_EXTRAS_BUNDLE) chegam aqui. */
    override fun onProfileProvisioningComplete(context: Context, intent: Intent) {
        val pending = goAsync()
        thread {
            try {
                applyProvisioningExtras(context, adminExtras(intent))
                DeviceOwner.grantSelfPermissions(context)
                KioskController.get(context).apply("provisioning")
            } finally {
                pending.finish()
            }
        }
    }

    companion object {
        private const val TAG = "AdminReceiver"

        fun component(context: Context) = ComponentName(context, AdminReceiver::class.java)

        /** PROVISIONING_ADMIN_EXTRAS_BUNDLE de qualquer intent do provisionamento (broadcast ou activity). */
        fun adminExtras(intent: Intent?): PersistableBundle? = when {
            intent == null -> null
            Build.VERSION.SDK_INT >= 33 ->
                intent.getParcelableExtra(DevicePolicyManager.EXTRA_PROVISIONING_ADMIN_EXTRAS_BUNDLE, PersistableBundle::class.java)
            else -> {
                @Suppress("DEPRECATION")
                intent.getParcelableExtra(DevicePolicyManager.EXTRA_PROVISIONING_ADMIN_EXTRAS_BUNDLE)
            }
        }

        /**
         * Configuração inicial no QR: `config` (JSON) ou `config_b64` (JSON em base64), aceitando `security.pin`.
         * Lento se houver PIN (hash): rode fora da thread principal. Só vale uma vez (aparelho recém-provisionado).
         */
        fun applyProvisioningExtras(context: Context, extras: PersistableBundle?) {
            // painel: endereço + código de cadastro do QR. A rede pode ainda não estar pronta: fica pendente e o
            // PanelSync tenta a cada 30 s até cadastrar.
            val serverUrl = extras?.getString("server_url")?.let { PanelStore.normalizeUrl(it) }
            val code = extras?.getString("enrollment_code")
            if (serverUrl != null && !code.isNullOrBlank() && !PanelStore.get(context).state.enrolled) {
                PanelStore.get(context).setPending(serverUrl, code)
                PanelSync.now(context, "provisioning")
            }
            val raw = extras?.getString("config")
                ?: extras?.getString("config_b64")?.let { String(Base64.decode(it, Base64.DEFAULT), Charsets.UTF_8) }
                ?: return
            val store = ConfigStore.get(context)
            if (store.meta.revision > 0) {
                Log.i(TAG, "Provisionamento: configuração já existe (rev ${store.meta.revision}), extras ignorados")
                return
            }
            val result = runCatching { store.update(JSONObject(raw), source = "provisioning", replace = true) }
            result.onSuccess { r ->
                if (r.ok) Log.i(TAG, "Configuração do QR aplicada. Avisos: ${r.warnings}") else Log.w(TAG, "Configuração do QR recusada: ${r.error}")
            }.onFailure { Log.w(TAG, "Configuração do QR ilegível: ${it.message}") }
        }
    }
}
