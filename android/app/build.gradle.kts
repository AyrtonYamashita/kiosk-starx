import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.KeyStore
import java.security.MessageDigest
import java.time.Instant
import java.util.Base64
import java.util.Properties

plugins {
    id("com.android.application")
}

val appVersionCode = 4
val appVersionName = "0.3.0"

// ---------------------------------------------------------------------------------------------
// Assinatura de release: keystore FORA do repositório e do OneDrive, com backup próprio.
// Perder a keystore = não dá mais para atualizar o app nos aparelhos (o Android exige a mesma assinatura).
// Padrão: ~/.starx-kiosk/signing/kiosk-keystore.properties (ou -Pstarx.keystoreProperties=<arquivo>).
// Formato: storeFile (relativo ao .properties), storePassword, keyAlias, keyPassword.
// ---------------------------------------------------------------------------------------------
val keystorePropsFile: File = file(
    providers.gradleProperty("starx.keystoreProperties")
        .getOrElse("${System.getProperty("user.home")}/.starx-kiosk/signing/kiosk-keystore.properties"),
)
val keystoreProps = Properties().apply { if (keystorePropsFile.isFile) keystorePropsFile.inputStream().use { load(it) } }

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

    signingConfigs {
        if (keystorePropsFile.isFile) {
            create("release") {
                storeFile = keystorePropsFile.parentFile.resolve(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release")
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

tasks.matching { it.name == "preReleaseBuild" }.configureEach {
    doFirst {
        if (!keystorePropsFile.isFile) throw GradleException("Keystore de release não encontrada: ${keystorePropsFile.absolutePath}")
    }
}

/**
 * APK de release assinado + release.json (lido pela API para montar o QR) numa pasta de saída.
 * Padrão: ../server/data/apks (servidor local). Para a VPS: -Pstarx.apkOut=<pasta> e copie para deploy/data/apks.
 */
abstract class PublishApk : DefaultTask() {
    @get:InputFile abstract val apk: RegularFileProperty
    @get:InputFile abstract val keystorePropertiesFile: RegularFileProperty
    @get:Input abstract val versionCode: Property<Int>
    @get:Input abstract val versionName: Property<String>
    @get:Input abstract val packageName: Property<String>
    @get:OutputDirectory abstract val outputDir: DirectoryProperty

    @TaskAction
    fun publish() {
        val propsFile = keystorePropertiesFile.get().asFile
        val props = Properties().apply { propsFile.inputStream().use { load(it) } }
        val ks = KeyStore.getInstance("PKCS12")
        propsFile.parentFile.resolve(props.getProperty("storeFile")).inputStream().use { ks.load(it, props.getProperty("storePassword").toCharArray()) }
        val cert = ks.getCertificate(props.getProperty("keyAlias")) ?: throw GradleException("alias ${props.getProperty("keyAlias")} não existe")
        fun sha256(b: ByteArray) = MessageDigest.getInstance("SHA-256").digest(b)
        val signatureChecksum = Base64.getUrlEncoder().withoutPadding().encodeToString(sha256(cert.encoded))

        val dir = outputDir.get().asFile.apply { mkdirs() }
        val name = "starx-kiosk-${versionCode.get()}.apk"
        val dest = dir.resolve(name)
        apk.get().asFile.copyTo(dest, overwrite = true)
        val sha = sha256(dest.readBytes()).joinToString("") { "%02x".format(it) }
        val json = """
            |{
            |  "packageName": "${packageName.get()}",
            |  "versionCode": ${versionCode.get()},
            |  "versionName": "${versionName.get()}",
            |  "file": "$name",
            |  "sizeBytes": ${dest.length()},
            |  "sha256": "$sha",
            |  "signatureChecksum": "$signatureChecksum",
            |  "builtAt": "${Instant.now()}"
            |}
            |""".trimMargin()
        val tmp = dir.resolve("release.json.tmp")
        tmp.writeText(json)
        Files.move(tmp.toPath(), dir.resolve("release.json").toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
        logger.lifecycle("APK publicado: $dest")
        logger.lifecycle("  versão ${versionName.get()} (${versionCode.get()}), sha256 $sha")
        logger.lifecycle("  checksum da assinatura (QR): $signatureChecksum")
    }
}

tasks.register<PublishApk>("publishApk") {
    group = "distribution"
    description = "Build de release assinado → pasta de APKs da API + release.json"
    dependsOn("assembleRelease")
    apk.set(layout.buildDirectory.file("outputs/apk/release/app-release.apk"))
    keystorePropertiesFile.set(keystorePropsFile)
    versionCode.set(appVersionCode)
    versionName.set(appVersionName)
    packageName.set("com.pstarx.kiosk")
    outputDir.set(
        providers.gradleProperty("starx.apkOut").map { rootProject.layout.projectDirectory.dir(it) }
            .orElse(rootProject.layout.projectDirectory.dir("../server/data/apks")),
    )
}
