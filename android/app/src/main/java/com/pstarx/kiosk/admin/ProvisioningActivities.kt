package com.pstarx.kiosk.admin

import android.app.Activity
import android.app.admin.DevicePolicyManager
import android.content.Intent
import android.os.Bundle
import kotlin.concurrent.thread

/**
 * Android 12+: durante o provisionamento por QR o sistema pergunta ao app qual modo usar.
 * O app só trabalha como Device Owner (aparelho totalmente gerenciado).
 */
class GetProvisioningModeActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val result = Intent().putExtra(
            DevicePolicyManager.EXTRA_PROVISIONING_MODE,
            DevicePolicyManager.PROVISIONING_MODE_FULLY_MANAGED_DEVICE,
        )
        setResult(RESULT_OK, result)
        finish()
    }
}

/** Android 12+: etapa de conformidade no fim do provisionamento. Os extras do QR também chegam aqui. */
class PolicyComplianceActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val extras = AdminReceiver.adminExtras(intent)
        thread {
            DeviceOwner.grantSelfPermissions(this)
            AdminReceiver.applyProvisioningExtras(this, extras)
            runOnUiThread {
                setResult(RESULT_OK)
                finish()
            }
        }
    }
}
