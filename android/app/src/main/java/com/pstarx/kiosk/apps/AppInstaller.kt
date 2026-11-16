package com.pstarx.kiosk.apps

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import com.pstarx.kiosk.BuildConfig
import com.pstarx.kiosk.panel.PanelStore
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/** APK a instalar, como o painel manda (url relativa à API). */
data class Artifact(val packageName: String, val versionCode: Long, val url: String, val sha256: String, val sizeBytes: Long) {
    companion object {
        fun fromJson(j: JSONObject) = Artifact(
            j.getString("packageName"),
            j.getLong("versionCode"),
            j.getString("url"),
            j.getString("sha256").lowercase(),
            j.getLong("sizeBytes"),
        )
    }
}

/**
 * Instalação e remoção silenciosas como Device Owner (PackageInstaller, sem nenhuma tela).
 * O APK só é instalado se tamanho e SHA-256 conferirem com o que o painel informou. Chamadas bloqueantes.
 */
class AppInstaller(context: Context) {
    private val ctx = context.applicationContext

    sealed interface Result {
        data class Ok(val message: String) : Result
        data class Failed(val message: String) : Result
    }

    fun installedVersion(packageName: String): Long? = try {
        ctx.packageManager.getPackageInfo(packageName, PackageManager.MATCH_UNINSTALLED_PACKAGES).longVersionCode
    } catch (_: PackageManager.NameNotFoundException) {
        null
    }

    /** Uma instalação por vez (coletores têm pouco espaço e pouca CPU). Nunca rebaixa a versão. */
    fun install(a: Artifact): Result = lock.withLock {
        val current = installedVersion(a.packageName)
        if (current != null && current >= a.versionCode) return Result.Ok("já instalado (versão $current)")
        val file = File(ctx.cacheDir, "install-${a.sha256.take(16)}.apk")
        try {
            download(a, file)?.let { return Result.Failed(it) }
            commit(a, file)
        } finally {
            file.delete()
        }
    }

    fun uninstall(packageName: String): Result = lock.withLock {
        if (packageName == ctx.packageName) return Result.Failed("o app do kiosk não se remove")
        if (installedVersion(packageName) == null) return Result.Ok("não estava instalado")
        val (id, latch) = register()
        ctx.packageManager.packageInstaller.uninstall(packageName, statusIntent(id).intentSender)
        await(id, latch, "removido", UNINSTALL_TIMEOUT_MS)
    }

    /** Mensagem de erro, ou null se o arquivo baixado está íntegro. */
    private fun download(a: Artifact, target: File): String? {
        val base = PanelStore.get(ctx).state.serverUrl ?: return "aparelho não está ligado a um painel"
        val url = if (a.url.startsWith("/")) base + a.url else a.url
        if (ctx.cacheDir.usableSpace < a.sizeBytes * 2 + FREE_MARGIN) return "espaço insuficiente no aparelho"
        val conn = URL(url).openConnection() as HttpURLConnection
        return try {
            conn.connectTimeout = 15_000
            conn.readTimeout = 60_000
            conn.setRequestProperty("User-Agent", "StarXKiosk/${BuildConfig.VERSION_NAME}")
            // APKs do repositório exigem o token do aparelho; o do próprio kiosk é público (QR)
            if (a.url.startsWith("/v1/")) PanelStore.get(ctx).state.token?.let { conn.setRequestProperty("Authorization", "Bearer $it") }
            val status = conn.responseCode
            if (status != 200) return "download falhou: HTTP $status"
            val digest = MessageDigest.getInstance("SHA-256")
            var total = 0L
            conn.inputStream.use { input ->
                target.outputStream().use { out ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        total += n
                        if (total > a.sizeBytes) return "download maior que o esperado (${a.sizeBytes} bytes)"
                        digest.update(buf, 0, n)
                        out.write(buf, 0, n)
                    }
                }
            }
            if (total != a.sizeBytes) return "tamanho não confere ($total de ${a.sizeBytes} bytes)"
            val sha = digest.digest().joinToString("") { "%02x".format(it) }
            if (sha != a.sha256) return "SHA-256 não confere: APK recusado"
            null
        } catch (e: Exception) {
            "download falhou: ${e.javaClass.simpleName}: ${e.message}"
        } finally {
            conn.disconnect()
        }
    }

    private fun commit(a: Artifact, file: File): Result {
        val installer = ctx.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(a.packageName)
            setSize(file.length())
            if (Build.VERSION.SDK_INT >= 31) setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        }
        val sessionId = installer.createSession(params)
        val (id, latch) = register()
        try {
            installer.openSession(sessionId).use { session ->
                session.openWrite("base.apk", 0, file.length()).use { out ->
                    file.inputStream().use { it.copyTo(out, 64 * 1024) }
                    session.fsync(out)
                }
                // instalar o próprio app encerra este processo; o resultado aparece na versão do próximo check-in
                session.commit(statusIntent(id).intentSender)
            }
        } catch (e: Exception) {
            pending.remove(id)
            runCatching { installer.abandonSession(sessionId) }
            return Result.Failed("instalação falhou: ${e.message}")
        }
        return await(id, latch, "instalado (versão ${a.versionCode})", INSTALL_TIMEOUT_MS)
    }

    private class Wait {
        val latch = CountDownLatch(1)
        @Volatile var intent: Intent? = null
    }

    private fun register(): Pair<Int, Wait> {
        val id = nextId.incrementAndGet()
        val w = Wait()
        pending[id] = w
        return id to w
    }

    private fun statusIntent(id: Int): PendingIntent {
        val intent = Intent(ctx, StatusReceiver::class.java).setAction(ACTION_STATUS).putExtra(EXTRA_ID, id)
        val mutable = if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0
        return PendingIntent.getBroadcast(ctx, id, intent, mutable or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    private fun await(id: Int, w: Wait, okMessage: String, timeoutMs: Long): Result {
        w.latch.await(timeoutMs, TimeUnit.MILLISECONDS)
        pending.remove(id)
        val intent = w.intent ?: return Result.Failed("o sistema não respondeu em ${timeoutMs / 1000} s")
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        val msg = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
        return when (status) {
            PackageInstaller.STATUS_SUCCESS -> Result.Ok(okMessage)
            PackageInstaller.STATUS_PENDING_USER_ACTION -> Result.Failed("o sistema pediu confirmação na tela (o app é Device Owner?)")
            else -> Result.Failed("${STATUS_NAMES[status] ?: "erro $status"}${msg?.let { ": $it" } ?: ""}")
        }
    }

    /** Resultado do PackageInstaller (instalação ou remoção). */
    class StatusReceiver : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val w = pending[intent.getIntExtra(EXTRA_ID, -1)]
            if (w == null) {
                Log.i(TAG, "Resultado de instalação sem espera ativa: ${intent.getIntExtra(PackageInstaller.EXTRA_STATUS, -99)}")
                return
            }
            w.intent = intent
            w.latch.countDown()
        }
    }

    companion object {
        private const val TAG = "AppInstaller"
        private const val ACTION_STATUS = "com.pstarx.kiosk.INSTALL_STATUS"
        private const val EXTRA_ID = "id"
        private const val INSTALL_TIMEOUT_MS = 5 * 60_000L
        private const val UNINSTALL_TIMEOUT_MS = 2 * 60_000L
        private const val FREE_MARGIN = 50L * 1024 * 1024
        private val pending = ConcurrentHashMap<Int, Wait>()
        private val nextId = AtomicInteger((System.currentTimeMillis() % 100_000).toInt())
        private val lock = ReentrantLock()

        private val STATUS_NAMES = mapOf(
            PackageInstaller.STATUS_FAILURE to "falha",
            PackageInstaller.STATUS_FAILURE_ABORTED to "cancelada",
            PackageInstaller.STATUS_FAILURE_BLOCKED to "bloqueada pelo sistema",
            PackageInstaller.STATUS_FAILURE_CONFLICT to "conflito com app instalado (assinatura diferente?)",
            PackageInstaller.STATUS_FAILURE_INCOMPATIBLE to "incompatível com o aparelho",
            PackageInstaller.STATUS_FAILURE_INVALID to "APK inválido",
            PackageInstaller.STATUS_FAILURE_STORAGE to "sem espaço",
        )
    }
}
