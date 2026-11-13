import java.util.Properties

plugins {
    id("com.android.application") version "9.4.1" apply false
}

// Opcional, por máquina (local.properties): starx.buildRoot=<pasta> tira as saídas de build da árvore do projeto.
// Necessário quando o projeto fica numa pasta sincronizada: o OneDrive marca pastas como somente leitura e o
// Gradle não consegue apagá-las.
val localProperties = Properties().apply {
    val f = rootDir.resolve("local.properties")
    if (f.isFile) f.inputStream().use { load(it) }
}
localProperties.getProperty("starx.buildRoot")?.let { buildRoot ->
    allprojects {
        layout.buildDirectory.set(file("$buildRoot/${if (path == ":") "root" else path.removePrefix(":").replace(':', '/')}"))
    }
}
