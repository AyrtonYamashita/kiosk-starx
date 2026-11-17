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
        // localização também com outro app na frente (modo app único)
        if (Build.VERSION.SDK_INT >= 29) add(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
    }

    /**
     * Localização ligada: sem ela o Android não informa o nome da rede Wi-Fi (SSID), que aparece no painel e na barra
     * do rodapé. Device Owner liga sem pedir nada na tela.
     */
    fun ensureLocationEnabled(context: Context) {
        if (!isDeviceOwner(context)) return
        if (context.getSystemService(android.location.LocationManager::class.java).isLocationEnabled) return
        try {
            if (Build.VERSION.SDK_INT >= 30) {
                dpm(context).setLocationEnabled(AdminReceiver.component(context), true)
            } else {
                // Android 10: setLocationEnabled não existe; LOCATION_MODE é permitido ao Device Owner
                @Suppress("DEPRECATION")
                dpm(context).setSecureSetting(
                    AdminReceiver.component(context),
                    android.provider.Settings.Secure.LOCATION_MODE,
                    android.provider.Settings.Secure.LOCATION_MODE_HIGH_ACCURACY.toString(),
                )
            }
            Log.i(TAG, "Localização ligada (nome da rede Wi-Fi)")
        } catch (e: Exception) {
            Log.w(TAG, "Não foi possível ligar a localização: ${e.message}")
        }
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
