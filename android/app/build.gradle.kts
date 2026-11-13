plugins {
    id("com.android.application")
}

val appVersionCode = 1
val appVersionName = "0.1.0"

android {
    namespace = "com.pstarx.kiosk"
    compileSdk = 36

    defaultConfig {
        // O applicationId não pode mudar depois que os aparelhos forem provisionados.
        applicationId = "com.pstarx.kiosk"
        minSdk = 29 // Android 10
        targetSdk = 34
        versionCode = appVersionCode
        versionName = appVersionName
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        buildConfig = true
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
    // implementação real do org.json para testes na JVM (o android.jar só tem stubs)
    testImplementation("org.json:json:20250517")
}
