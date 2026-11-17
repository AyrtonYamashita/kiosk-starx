package com.pstarx.kiosk.device

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Looper
import android.util.Log
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Localização do aparelho para o painel (security.reportLocation). Só o serviço de localização do próprio Android
 * (GPS e rede), sem serviços do Google: funciona também em coletores sem Google. Guarda a última posição e vai no
 * check-in. Atualiza a cada minuto ou 10 m andados. Precisa da permissão (Device Owner concede) e da localização
 * ligada (DeviceOwner.ensureLocationEnabled).
 */
object LocationTracker {
    private const val TAG = "LocationTracker"
    private const val MIN_TIME_MS = 60_000L
    private const val MIN_DISTANCE_M = 10f
    /** Uma posição mais nova só substitui uma mais precisa se a precisa tiver mais de 2 min. */
    private const val STALE_MS = 2 * 60_000L

    @Volatile private var last: Location? = null
    private var running = false
    private val listener = object : LocationListener {
        override fun onLocationChanged(location: Location) = offer(location)
        @Deprecated("Deprecated in Java")
        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
        override fun onProviderEnabled(provider: String) = Unit
        override fun onProviderDisabled(provider: String) = Unit
    }

    /** Liga ou desliga conforme a configuração (idempotente). Thread principal. */
    @SuppressLint("MissingPermission")
    @Synchronized
    fun configure(context: Context, enabled: Boolean) {
        val ctx = context.applicationContext
        val lm = ctx.getSystemService(LocationManager::class.java) ?: return
        if (!enabled) {
            if (running) runCatching { lm.removeUpdates(listener) }
            running = false
            last = null
            return
        }
        if (running) return
        if (ctx.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            Log.w(TAG, "Sem permissão de localização")
            return
        }
        for (p in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) {
            if (!lm.allProviders.contains(p)) continue
            runCatching { lm.getLastKnownLocation(p)?.let(::offer) }
            runCatching { lm.requestLocationUpdates(p, MIN_TIME_MS, MIN_DISTANCE_M, listener, Looper.getMainLooper()) }
                .onFailure { Log.w(TAG, "Sem atualizações de $p: ${it.message}") }
        }
        running = true
        Log.i(TAG, "Localização ligada")
    }

    /** Fica com a melhor posição: a mais nova, a não ser que seja bem menos precisa que uma recente. */
    private fun offer(loc: Location) {
        val cur = last
        if (cur == null || isBetter(loc, cur)) last = loc
    }

    /** Exposto para teste: `candidate` substitui `current`? */
    fun isBetter(candidate: Location, current: Location): Boolean {
        val newer = candidate.time - current.time
        if (newer > STALE_MS) return true
        if (newer < -STALE_MS) return false
        val acc = (candidate.accuracy - current.accuracy).toInt()
        return acc <= 0 || (newer > 0 && acc <= 50)
    }

    /** Para o check-in: null sem posição. */
    fun snapshot(): JSONObject? {
        val l = last ?: return null
        val iso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
        return JSONObject()
            .put("lat", l.latitude)
            .put("lon", l.longitude)
            .put("accuracyM", if (l.hasAccuracy()) l.accuracy.toDouble() else JSONObject.NULL)
            .put("provider", l.provider ?: JSONObject.NULL)
            .put("at", iso.format(Date(l.time)))
    }
}
