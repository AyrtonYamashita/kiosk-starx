package com.pstarx.kiosk.device

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ApplicationInfo
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.PowerManager
import android.os.StatFs
import android.os.SystemClock
import android.telephony.TelephonyManager
import android.util.Log
import com.pstarx.kiosk.BuildConfig
import com.pstarx.kiosk.admin.AdminReceiver
import com.pstarx.kiosk.admin.DeviceOwner
import com.pstarx.kiosk.kiosk.KioskController
import org.json.JSONArray
import org.json.JSONObject
import java.net.Inet4Address

/**
 * Informações do aparelho. Cada seção falha isolada (um erro de permissão não derruba o resto).
 * Na fase 2 é o que vai para o painel no check-in.
 */
class DeviceInfo(private val context: Context) {

    fun collect(includeApps: Boolean = true): JSONObject = JSONObject().apply {
        put("hardware", hardware())
        put("battery", battery())
        put("storage", storage())
        put("memory", memory())
        put("network", network())
        put("screenOn", context.getSystemService(PowerManager::class.java).isInteractive)
        put("uptimeMs", SystemClock.elapsedRealtime())
        // última posição conhecida (null se desligado no perfil ou ainda sem posição)
        put("location", LocationTracker.snapshot() ?: JSONObject.NULL)
        put("app", app())
        if (includeApps) put("apps", apps())
    }

    fun hardware(): JSONObject = JSONObject()
        .put("manufacturer", Build.MANUFACTURER)
        .put("model", Build.MODEL)
        .put("device", Build.DEVICE)
        .put("serialNumber", serial() ?: JSONObject.NULL)
        .put("imeis", JSONArray(imeis()))
        .put("androidVersion", Build.VERSION.RELEASE)
        .put("sdkInt", Build.VERSION.SDK_INT)
        .put("securityPatch", Build.VERSION.SECURITY_PATCH)
        .put("buildFingerprint", Build.FINGERPRINT)

    // Device Owner com READ_PHONE_STATE pode ler o serial no Android 10+
    private fun serial(): String? = safe("serial") { Build.getSerial().takeIf { it.isNotBlank() && it != Build.UNKNOWN } }

    private fun imeis(): List<String> = safe("imei") {
        val tm = context.getSystemService(TelephonyManager::class.java) ?: return@safe emptyList()
        @Suppress("DEPRECATION") // activeModemCount só existe a partir do Android 11
        val slots = if (Build.VERSION.SDK_INT >= 30) tm.activeModemCount else tm.phoneCount
        (0 until slots).mapNotNull { slot -> runCatching { tm.getImei(slot) }.getOrNull()?.takeIf { it.isNotBlank() } }
    } ?: emptyList()

    fun battery(): JSONObject {
        val intent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = intent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = intent?.getIntExtra(BatteryManager.EXTRA_SCALE, 100) ?: 100
        val status = intent?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
        val temp = intent?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, Int.MIN_VALUE) ?: Int.MIN_VALUE
        return JSONObject()
            .put("level", if (level >= 0 && scale > 0) (level * 100 / scale).coerceIn(0, 100) else JSONObject.NULL)
            .put("charging", status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL)
            .put("temperatureC", if (temp != Int.MIN_VALUE) temp / 10.0 else JSONObject.NULL)
    }

    fun storage(): JSONObject {
        val stat = StatFs(Environment.getDataDirectory().path)
        return JSONObject().put("totalBytes", stat.totalBytes).put("freeBytes", stat.availableBytes)
    }

    fun memory(): JSONObject {
        val info = ActivityManager.MemoryInfo()
        context.getSystemService(ActivityManager::class.java).getMemoryInfo(info)
        return JSONObject().put("totalBytes", info.totalMem).put("availBytes", info.availMem)
    }

    @Suppress("DEPRECATION") // WifiManager.connectionInfo é a API disponível no Android 10
    fun network(): JSONObject {
        val cm = context.getSystemService(ConnectivityManager::class.java)
        val active = cm.activeNetwork
        val caps = active?.let { cm.getNetworkCapabilities(it) }
        val type = when {
            caps == null -> "none"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
            else -> "other"
        }
        val ips = active?.let { cm.getLinkProperties(it) }?.linkAddresses
            ?.mapNotNull { la -> la.address.takeIf { it is Inet4Address && !it.isLoopbackAddress }?.hostAddress }
            .orEmpty()
        val wifi = if (type == "wifi") safe("wifi") {
            val info = context.applicationContext.getSystemService(WifiManager::class.java).connectionInfo
            JSONObject()
                // SSID exige localização ligada; sem ela vem "<unknown ssid>"
                .put("ssid", info.ssid?.removeSurrounding("\"")?.takeIf { it.isNotBlank() && it != "<unknown ssid>" } ?: JSONObject.NULL)
                .put("rssi", info.rssi)
                .put("linkSpeedMbps", info.linkSpeed)
                .put("frequencyMhz", info.frequency)
        } else null
        val mac = safe("mac") {
            if (DeviceOwner.isDeviceOwner(context)) DeviceOwner.dpm(context).getWifiMacAddress(AdminReceiver.component(context)) else null
        }
        return JSONObject()
            .put("type", type)
            .put("wifi", wifi ?: JSONObject.NULL)
            .put("ipAddresses", JSONArray(ips))
            .put("wifiMac", mac ?: JSONObject.NULL)
    }

    fun app(): JSONObject {
        val k = KioskController.get(context)
        return JSONObject()
            .put("versionName", BuildConfig.VERSION_NAME)
            .put("versionCode", BuildConfig.VERSION_CODE)
            .put("isDeviceOwner", k.isDeviceOwner)
            .put("kioskActive", k.enforced && k.inLockTask)
            .put("configRevision", k.store.meta.revision)
    }

    fun apps(): JSONArray {
        val pm = context.packageManager
        val result = JSONArray()
        pm.getInstalledPackages(0).sortedBy { it.packageName }.forEach { p ->
            val ai = p.applicationInfo ?: return@forEach
            result.put(
                JSONObject()
                    .put("packageName", p.packageName)
                    .put("label", runCatching { pm.getApplicationLabel(ai).toString() }.getOrDefault(p.packageName))
                    .put("versionName", p.versionName ?: JSONObject.NULL)
                    .put("versionCode", p.longVersionCode)
                    .put("system", ai.flags and ApplicationInfo.FLAG_SYSTEM != 0),
            )
        }
        return result
    }

    /** Texto para a tela de configurações. */
    fun summary(): String {
        val i = collect(includeApps = false)
        val h = i.getJSONObject("hardware")
        val b = i.getJSONObject("battery")
        val n = i.getJSONObject("network")
        val s = i.getJSONObject("storage")
        val m = i.getJSONObject("memory")
        val wifi = n.optJSONObject("wifi")
        fun gb(bytes: Long) = "%.1f GB".format(bytes / 1_073_741_824.0)
        val imeis = h.getJSONArray("imeis").let { a -> (0 until a.length()).joinToString { a.getString(it) } }
        return buildString {
            appendLine("Modelo: ${h.getString("manufacturer")} ${h.getString("model")}")
            appendLine("Serial: ${h.opt("serialNumber").takeIf { it != JSONObject.NULL } ?: "indisponível"}")
            if (imeis.isNotEmpty()) appendLine("IMEI: $imeis")
            appendLine("Android ${h.getString("androidVersion")} (SDK ${h.getInt("sdkInt")}), patch ${h.getString("securityPatch")}")
            appendLine("Bateria: ${b.opt("level")}%${if (b.getBoolean("charging")) " (carregando)" else ""}")
            appendLine("Armazenamento: ${gb(s.getLong("freeBytes"))} livres de ${gb(s.getLong("totalBytes"))}")
            appendLine("Memória: ${gb(m.getLong("availBytes"))} livres de ${gb(m.getLong("totalBytes"))}")
            append("Rede: ${n.getString("type")}")
            if (wifi != null) append(" ${wifi.opt("ssid").takeIf { it != JSONObject.NULL } ?: ""} (${wifi.optInt("rssi")} dBm)")
            appendLine()
            val ips = n.getJSONArray("ipAddresses")
            if (ips.length() > 0) appendLine("IP: ${(0 until ips.length()).joinToString { ips.getString(it) }}")
            n.opt("wifiMac").takeIf { it != JSONObject.NULL }?.let { appendLine("MAC Wi-Fi: $it") }
            append("Ligado há ${Ui0.uptime(i.getLong("uptimeMs"))}")
        }
    }

    private inline fun <T> safe(section: String, block: () -> T?): T? = try {
        block()
    } catch (e: Exception) {
        Log.w(TAG, "Falha em $section: ${e.message}")
        null
    }

    private object Ui0 {
        fun uptime(ms: Long): String {
            val min = ms / 60_000
            return if (min < 60) "$min min" else if (min < 1440) "${min / 60} h ${min % 60} min" else "${min / 1440} d ${(min % 1440) / 60} h"
        }
    }

    companion object {
        private const val TAG = "DeviceInfo"
    }
}
