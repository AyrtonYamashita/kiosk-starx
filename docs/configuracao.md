# Configuração do StarX Kiosk

Toda a configuração do aparelho é **um documento JSON**. O mesmo documento é:

- editado na tela de configurações do aparelho (gesto no canto + PIN);
- exportado e importado em arquivo `.json` (aba **Avançado**);
- aplicado por ADB (abaixo);
- aplicado no provisionamento por QR (extras do QR);
- editado no painel, por **perfil** (vários aparelhos) e com **ajustes por aparelho** (veja "Configuração pelo painel").

Campo ausente = valor padrão. Valor inválido = valor padrão + aviso; nunca derruba a configuração inteira.
Toda alteração ganha um número de **revisão** e a origem (`local`, `adb`, `provisioning`; depois `painel`).

## Formato (schema 1)

```json
{
  "schema": 1,
  "kiosk": {
    "enabled": true,
    "mode": "apps",
    "app": null,
    "apps": ["com.android.chrome", "com.empresa.coletor"],
    "relaunchDelaySec": 3,
    "web": { "url": "", "reloadOnErrorSec": 15, "inactivityReturnSec": 0, "allowZoom": true, "reloadButton": false }
  },
  "display": { "keepScreenOn": true, "brightness": null, "dimAfterSec": 0, "lowBatteryPercent": 15, "lowBatteryMessage": "Troque a bateria antes de continuar a operação.", "orientation": "auto", "showStatusBar": false },
  "appearance": { "title": "", "backgroundColor": "#001425", "textColor": "#FFFFFF", "columns": 4 },
  "security": {
    "pin": "1234",
    "exitCorner": "bottom_right",
    "exitTaps": 5,
    "allowNotifications": false,
    "allowPowerMenu": true,
    "disableLockScreen": true,
    "blockFactoryReset": true,
    "blockSafeBoot": true,
    "blockUsbFileTransfer": false,
    "blockDebugging": false,
    "systemSettingsShortcuts": true
  }
}
```

| Campo | Valores | O que faz |
|---|---|---|
| `kiosk.enabled` | true/false | Liga o kiosk. Desligado, o aparelho funciona normalmente, mas as restrições de `security.block*` continuam valendo. |
| `kiosk.mode` | `app`, `apps`, `web` | App único, grade de apps ou site. |
| `kiosk.app` | pacote | App do modo `app`. Se fechar ou travar, reabre depois de `relaunchDelaySec`. Se cair 5 vezes em 2 min, espera 30 s. |
| `kiosk.apps` | lista de pacotes | Apps da grade, na ordem. O botão Home volta para a grade. |
| `kiosk.web.url` | http(s) | Site do modo `web`. Links que não são http(s) (tel:, intent:) são bloqueados. |
| `kiosk.web.reloadOnErrorSec` | 0–3600 | Recarrega depois de erro de carregamento (0 = não recarrega). |
| `kiosk.web.inactivityReturnSec` | 0–86400 | Volta para a URL inicial depois desse tempo sem toque (0 = nunca). |
| `kiosk.web.reloadButton` | true/false | Botão de recarregar na tela do kiosk (no rodapé, ou flutuante quando a barra do Android aparece). |
| `display.dimAfterSec` | 0–86400 | Sem toque por esse tempo, o brilho cai para 1%; a tela nunca apaga e o primeiro toque devolve o brilho (0 = desligado). Ligado, a tela fica sempre ligada. |
| `display.lowBatteryPercent` | 0–50 | Aviso de bateria fraca na tela (sem carregar) a partir desse nível; repete a cada 5% a menos e fecha ao carregar (0 = sem aviso). |
| `display.lowBatteryMessage` | texto até 200 | Mensagem do aviso (ex.: pedir para trocar a bateria antes de continuar). |
| `security.reportLocation` | true/false | Envia a localização (GPS/rede do Android, sem serviços do Google) a cada contato; o painel mostra no mapa. |
| `display.keepScreenOn` | true/false | Tela sempre ligada durante o kiosk (o valor original volta quando o kiosk desliga). |
| `display.brightness` | null ou 0–100 | Brilho fixo em %. `null` = não mexe. |
| `display.orientation` | `auto`, `portrait`, `landscape` | Orientação da grade e do site. **Não vale para apps de terceiros.** |
| `display.showStatusBar` | true/false | Mostra hora, bateria e rede no kiosk. |
| `appearance.*` | | Título no topo da grade, cores (#RRGGBB) e colunas (2–8). |
| `security.pin` | 4–32 caracteres | **Só na entrada.** Vira `security.pinHash` e o texto nunca é gravado. Só dígitos = teclado numérico. |
| `security.pinHash` | objeto ou null | Hash PBKDF2 do PIN (é o que o export grava). `null` remove o PIN. |
| `security.exitCorner` | `top_left`, `top_right`, `bottom_left`, `bottom_right` | Canto do gesto que abre a administração. |
| `security.exitTaps` | 3–10 | Toques rápidos (em até 2 s) no canto. |
| `security.allowNotifications` | true/false | Área de notificações durante o kiosk. Liga também o botão Home (regra do Android). |
| `security.allowPowerMenu` | true/false | Menu de desligar/reiniciar no botão de energia. |
| `security.disableLockScreen` | true/false | Sem tela de bloqueio durante o kiosk (só funciona sem senha/padrão no aparelho). |
| `security.blockFactoryReset` | true/false | Bloqueia o reset de fábrica pelas configurações. |
| `security.blockSafeBoot` | true/false | Bloqueia o modo de segurança. |
| `security.blockUsbFileTransfer` | true/false | Bloqueia a transferência de arquivos por USB. |
| `security.blockDebugging` | true/false | Bloqueia opções do desenvolvedor e depuração USB. **Corta o ADB.** |
| `security.systemSettingsShortcuts` | true/false | Atalhos de Wi-Fi, Bluetooth e Configurações do Android na administração. |

## Abrir a administração no aparelho

Toque **5 vezes rápido** (padrão) no **canto inferior direito** (padrão) e digite o PIN.

- Na grade e no site, o gesto funciona sempre.
- **Sobre outros apps** (app único, ou um app aberto pela grade), o gesto precisa da permissão "Sobrepor a outros
  apps". O Device Owner não consegue conceder essa permissão sozinho. Conceda uma vez, de um destes jeitos:
  - na administração, aba **Avançado** → "Permissão Sobrepor a outros apps";
  - por ADB: `adb shell appops set com.pstarx.kiosk SYSTEM_ALERT_WINDOW allow`.

  Sem a permissão, a administração continua acessível quando o app fecha (a tela do kiosk aparece por alguns segundos
  antes de reabrir) e, na grade, pelo botão Home.
- Com a administração aberta, o kiosk libera por até 10 minutos as Configurações do Android e o seletor de arquivos
  (Wi-Fi, importar/exportar). Ao fechar a tela, tudo volta a ficar bloqueado.

Erros de PIN: as 4 primeiras tentativas são livres. Depois disso, cada erro bloqueia por 30 s, e o bloqueio dobra a
cada erro até 15 min. Esse bloqueio vale também para o ADB.

## Configurar por ADB

Só o shell do ADB consegue chamar, porque o receptor exige a permissão `DUMP`, que apps comuns não têm. O `pin` é
sempre obrigatório. Se o aparelho ainda não tem PIN, o `pin` do comando vira o PIN do aparelho.

```bash
# 1. alteração parcial (mesclada com a configuração atual) a partir de um arquivo
adb push kiosk.json /data/local/tmp/kiosk.json
adb shell 'am broadcast -n com.pstarx.kiosk/.adb.AdbConfigReceiver -a com.pstarx.kiosk.CONFIG --es pin 1234 --es config "$(cat /data/local/tmp/kiosk.json)"'

# 2. substituir a configuração inteira (o que não vier volta ao padrão; o PIN só muda se o arquivo trouxer pin/pinHash)
adb shell 'am broadcast -n com.pstarx.kiosk/.adb.AdbConfigReceiver -a com.pstarx.kiosk.CONFIG --es pin 1234 --ez replace true --es config "$(cat /data/local/tmp/kiosk.json)"'

# 3. JSON em base64 (evita problemas de aspas no Windows)
adb shell am broadcast -n com.pstarx.kiosk/.adb.AdbConfigReceiver -a com.pstarx.kiosk.CONFIG --es pin 1234 --es config_b64 eyJraW9zayI6eyJlbmFibGVkIjpmYWxzZX19

# 4. ler a configuração atual / as informações do aparelho
adb shell am broadcast -n com.pstarx.kiosk/.adb.AdbConfigReceiver -a com.pstarx.kiosk.CONFIG --es pin 1234 --ez dump true
adb shell am broadcast -n com.pstarx.kiosk/.adb.AdbConfigReceiver -a com.pstarx.kiosk.CONFIG --es pin 1234 --ez info true
```

A resposta sai na linha `Broadcast completed: result=0, data="{...}"` (`result=0` = ok, `result=1` = erro, com o
motivo em `error`). Os avisos de valores corrigidos vêm em `warnings`.

> Git Bash no Windows: use `MSYS_NO_PATHCONV=1` antes do `adb` para ele não reescrever `/data/local/tmp`.

## Provisionamento por QR com configuração

No QR de provisionamento, os extras do admin (`android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE`) podem levar
`config` (o JSON como texto) ou `config_b64`. O aparelho já sai do provisionamento com o kiosk configurado. Isso só
vale na primeira configuração do aparelho. O QR completo (com o painel) chega na fase 2.

## Configuração pelo painel

- **Perfil:** configuração completa, aplicada a vários aparelhos. Ao salvar o perfil, cada aparelho recebe a
  configuração no próximo contato (até 30 s) e a aplica inteira. O que o perfil não define volta ao padrão.
- **Ajustes do aparelho:** JSON parcial mesclado por cima do perfil. Por exemplo, um site ou um título diferente para
  um aparelho.
- **PIN no perfil:** o PIN é digitado no painel e gravado só como hash, no mesmo formato do app. O perfil tem três
  opções: "não mexer no PIN dos aparelhos" (cada um mantém o seu), "definir/trocar" ou "sem PIN".
- **Alterações no próprio aparelho** (pela tela ou por ADB) depois do painel são mantidas. O painel mostra
  "alterada no aparelho", e **Reaplicar** desfaz essas alterações.
- **Configuração recusada pelo aparelho:** o painel mostra o erro e não reenvia a mesma versão até a configuração
  mudar ou alguém clicar em Reaplicar.
- **Aparelho sem perfil e sem ajustes:** o painel não envia nada, e o aparelho fica com a configuração local.
- **Código de cadastro com perfil:** o aparelho cadastrado com esse código (por QR, ADB ou pela tela) já recebe a
  configuração no primeiro contato.
