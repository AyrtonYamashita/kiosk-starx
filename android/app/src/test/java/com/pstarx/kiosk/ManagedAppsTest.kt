package com.pstarx.kiosk

import com.pstarx.kiosk.apps.Artifact
import com.pstarx.kiosk.apps.ManagedApps
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class ManagedAppsTest {
    @Test
    fun esperaCresceAteSeisHoras() {
        val min = 60_000L
        assertEquals(5 * min, ManagedApps.retryDelayMs(1))
        assertEquals(10 * min, ManagedApps.retryDelayMs(2))
        assertEquals(40 * min, ManagedApps.retryDelayMs(4))
        assertEquals(6 * 60 * min, ManagedApps.retryDelayMs(8))
        assertEquals(6 * 60 * min, ManagedApps.retryDelayMs(50))
    }

    @Test
    fun artefatoDoPainel() {
        val a = Artifact.fromJson(
            JSONObject("""{"packageName":"com.exemplo.coletor","versionCode":2,"versionName":"1.1","url":"/v1/device/apps/x/apk","sha256":"ABCD","sizeBytes":1234}"""),
        )
        assertEquals(Artifact("com.exemplo.coletor", 2, "/v1/device/apps/x/apk", "abcd", 1234), a)
    }
}

class BatteryWarnTest {
    private fun warn(level: Int, charging: Boolean = false, threshold: Int = 15, last: Int? = null) =
        com.pstarx.kiosk.kiosk.BatteryWatch.shouldWarn(level, charging, threshold, last)

    @org.junit.Test
    fun avisaNoLimiteERepeteACada5() {
        org.junit.Assert.assertFalse(warn(16))
        org.junit.Assert.assertTrue(warn(15))
        org.junit.Assert.assertFalse(warn(13, last = 15))
        org.junit.Assert.assertTrue(warn(10, last = 15))
        org.junit.Assert.assertFalse(warn(5, charging = true, last = 10))
        org.junit.Assert.assertFalse(warn(5, threshold = 0))
    }
}
