package com.pstarx.kiosk.admin

import android.Manifest
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.os.Build
import android.util.Log

object DeviceOwner {
    private const val TAG = "DeviceOwner"

    fun dpm(context: Context): DevicePolicyManager = context.getSystemService(DevicePolicyManager::class.java)

    fun isDeviceOwner(context: Context): Boolean = dpm(context).isDeviceOwnerApp(context.packageName)

    /** Permissões de runtime que o app usa (serial/IMEI, SSID). Device Owner concede sem interação. */
    private val SELF_PERMISSIONS = buildList {
        add(Manifest.permission.READ_PHONE_STATE)
        add(Manifest.permission.ACCESS_FINE_LOCATION)
        add(Manifest.permission.ACCESS_COARSE_LOCATION)
        if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
    }

    fun grantSelfPermissions(context: Context) {
        if (!isDeviceOwner(context)) return
        val dpm = dpm(context)
        val admin = AdminReceiver.component(context)
        for (perm in SELF_PERMISSIONS) {
            try {
                dpm.setPermissionGrantState(admin, context.packageName, perm, DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED)
            } catch (e: Exception) {
                Log.w(TAG, "Não foi possível conceder $perm: ${e.message}")
            }
        }
    }
}
