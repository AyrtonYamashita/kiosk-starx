# StarX Kiosk

App de kiosk para Android, no estilo do FreeKiosk. Roda como **Device Owner** e tem uma tela de configurações no
próprio aparelho. Na próxima fase ganha um **painel na nuvem** (VPS própria) para controlar todos os aparelhos
de um lugar só.

O princípio é que **a configuração é um documento JSON só**. A tela do aparelho, o arquivo exportado, o ADB, o QR e,
depois, o painel mexem no mesmo documento. Veja [docs/configuracao.md](docs/configuracao.md).

```
android/   app Kotlin com.pstarx.kiosk (sem AndroidX e sem dependências externas)
server/    API (Node + Fastify + Postgres): cadastro, check-in, painel, APK do QR → VPS
web/       painel (Next.js) → Vercel
deploy/    docker compose da VPS, bloco do Caddy, guia de deploy
docs/      guias
```

## Fases

| Fase | Conteúdo | Estado |
|---|---|---|
| 1 | App kiosk local: Device Owner, app único / grade / site, configurações no aparelho (gesto + PIN), JSON com import/export, ADB, boot | ✅ (validada no C6000) |
| 2 | API na VPS (Docker + Postgres, atrás do Caddy existente), painel na Vercel, cadastro por QR/ADB/tela, check-in, inventário | ✅ publicada (api-kiosk.pstarx.com + kiosk.pstarx.com); ✅ QR validado no C6000 |
| 3 | Configuração pelo painel: perfis, ajustes por aparelho, aplicação em lote, reaplicar, código de cadastro com perfil | ✅ código e testes; falta validar no C6000 |
| 4 | Comandos (bloquear, reiniciar, mensagem, captura de tela) e apps (instalar/remover, auto-update) | |
| 5 | Agenda de tela, protetor de tela, alertas, backup | |

## Build do app

Pré-requisitos: Android Studio (JBR e SDK).

```bash
cd android
# OneDrive: tire as saídas de build da pasta sincronizada (local.properties)
#   sdk.dir=C:/Users/<você>/AppData/Local/Android/Sdk
#   starx.buildRoot=C:/Users/<você>/AppData/Local/starx-kiosk/android-build
JAVA_HOME="/c/Program Files/Android/Android Studio/jbr" ./gradlew testDebugUnitTest assembleDebug
```

O APK sai em `<buildRoot>/app/outputs/apk/debug/app-debug.apk`, ou em `android/app/build/...` sem o `buildRoot`.

## Instalar como Device Owner (ADB)

Antes, o aparelho precisa estar **sem nenhuma conta** (Google, Samsung etc.) e sem outro Device Owner. Na prática,
logo depois do reset de fábrica, pulando a configuração de contas.

```bash
adb install -t app-debug.apk          # -t: o build de debug é testOnly (dá para remover o Device Owner por ADB)
adb shell dpm set-device-owner com.pstarx.kiosk/.admin.AdminReceiver
adb shell appops set com.pstarx.kiosk SYSTEM_ALERT_WINDOW allow   # gesto no canto por cima de outros apps
```

Em seguida, abra o app **StarX Kiosk** na gaveta. Sem PIN definido, as configurações abrem direto. Defina o PIN,
escolha o modo e os apps, ligue o kiosk e toque em **Salvar**.

Para remover o Device Owner, há dois caminhos:

- na administração, aba **Avançado** → "Remover Device Owner";
- por ADB (só no build de debug): `adb shell dpm remove-active-admin com.pstarx.kiosk/.admin.AdminReceiver`.
