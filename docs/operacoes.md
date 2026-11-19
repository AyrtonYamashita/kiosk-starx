# Acompanhamento de operações (Fase 2)

O app lê a tela do SSW no coletor (WebView) e manda eventos para a API, que mantém o estado de cada coletor e o
resumo de cada descarga. O painel mostra isso ao vivo (2.3).

## Telas do SSW (mapeadas em 2026-11-17)

Descarga de manifesto, coleta e romaneio usam a mesma tela de bipagem (`/bin/sswbar/descarga/{manifesto,coleta,romaneio}/<placa>@`).
**Carga** (achada no piloto em 2026-11-18): `/bin/sswbar/carga/manifesto/<placa>` (sem `@`), título "Carga de Manifesto",
`funcao` = número (`4`), "Placa provisória:" e "Unidades destino:" / "Centralizadoras:"; volumes, peso, valor e os
campos `full_*` iguais aos da descarga; Concluir e Interromper são links (`#btn_concluir`, `#btn_sair`). Função no
servidor: `carga_manifesto` (e `carga_coleta`/`carga_romaneio`, se aparecerem).

| Dado | Onde |
|---|---|
| Usuário | `input[name=usuario]` (também `#dropdownMenuButton`) |
| Empresa / filial | `input[name=dominio]`, `input[name=filial]` |
| Função | caminho da URL; título `#navbar_title`; `input[name=funcao]` |
| Placa / placa real | `input[name=placa]`, `input[name=placa_real]` |
| Unidades (filiais) | `P` "Unidades:" → `SPAN` (ex.: `ALT OTI BOT CGB`) |
| Volumes total / lidos / faltam | `#total_qtde`, `#cap_qtde`, `#fal_qtde` |
| Peso total / lido / falta | `#total_peso`, `#cap_peso`, `#fal_peso` |
| Valor total / lido / falta | `#total_vlr`, `#cap_vlr`, `#fal_vlr`; exatos: `full_total_vlr`, `full_cap_vlr` (vírgula decimal) |
| Ações | botões "Concluir" e "Interromper" (o leitor só observa o clique) |

A tela não mostra a hora de cada bipagem: cada aumento de "Lidos" é uma bipagem, com a hora em que o número mudou.

## Leitor no app (2.4, app 0.5.0)

- **Quem lê**: a **chave geral** (fim da página do Acompanhamento, só administradores) diz "só no piloto" ou "todos os
  coletores". Na página de cada coletor dá para ligar ou desligar só nele, ou voltar a seguir a chave geral
  (`devices.ops_reader`: null = segue a chave, true/false = escolha do coletor; `ops_settings.reader_all` = chave). O
  check-in informa o app (`opsReader`, o que vale) e, a cada mudança, a API avisa os coletores na hora (~0,5 s). Com a
  leitura desligada, a API recusa os eventos (`403 ops_disabled`) e o app para e descarta a fila.
- **Leitor da página** (`server/reader/ssw_reader.js`): injetado só em páginas `https://*.ssw.inf.br`. Desde a 0.5.1
  vem da API: o check-in informa `reader.sha256`, o app baixa `GET /v1/device/reader`, confere o sha256 e troca o
  leitor na página aberta (a versão nova para a antiga). O mesmo arquivo vai no APK como reserva. **Ajuste de
  mapeamento = mudar esse arquivo e publicar a API**, sem app novo.
- **Diagnóstico** (0.5.1): bipagem sem função/placa/total, ou tela do SSW desconhecida, gera um evento `diag` (uma vez
  por tela a cada 10 min) com endereço, título, ids, nomes dos campos (valor só de funcao/placa/dominio/filial) e
  rótulos. Consulta: `SELECT at, data FROM ops_events WHERE type = 'diag' ORDER BY at DESC`.
- **Atualização do app** (0.5.1): adiada enquanto há bipagem (tela de bipagem ou carga aberta, com mudança há menos de
  15 min); instala no check-in seguinte, quando o colaborador sai da bipagem.
  Lê os campos da tabela acima, confere a cada mudança da página e a cada 500 ms (campos escondidos mudam sem gerar
  aviso) e manda um retrato ao app só quando algo mudou. Observa os toques em Concluir/Interromper. Não clica nem digita.
- **Regras** (`OpsTracker.kt`):
  - a leitura começa quando aparece o usuário logado (`#dropdownMenuButton` / `usuario`); a tela de login = saiu;
  - abrir a bipagem → `op_start`; cada aumento de "Lidos" → `progress`;
  - Concluir/Interromper só encerram quando a página sai da bipagem em até 10 s (confirmação cancelada não fecha);
  - sair da bipagem sem Concluir/Interromper: voltando à mesma placa em até 2 min, segue a mesma carga; senão
    `op_end` "left" (painel: "saiu sem concluir");
  - sinal de vida a cada 15 s e quando a tela muda (a tela do coletor não apaga: só escurece).
- **Fila e envio** (`OpsQueue.kt`, `OpsSender.kt`): eventos gravados no aparelho antes de sair (até 5.000; sinal de
  vida só o último, na memória), lote ~0,3 s depois da mudança, até 200 por lote, respostas tratadas como abaixo
  (lote com evento inválido é dividido até achar o culpado, que é descartado).

## Envio: `POST /v1/device/events`

Cabeçalhos:

- `x-device-id`: id do aparelho
- `x-ts`: hora do envio em ms (hora do aparelho **corrigida** pela do servidor)
- `x-signature`: `hex(HMAC-SHA256(chave, "<x-ts>.<sha256 hex do corpo>"))`, com `chave = sha256 hex do token do aparelho`
  (o token nunca trafega neste endpoint)

Corpo (até 64 KB, 1–200 eventos):

```json
{ "schema": 1, "events": [ { "id": "<uuid>", "at": 1794950000000, "type": "...", "...": "..." } ] }
```

| `type` | Campos | Quando |
|---|---|---|
| `session` | `user` (null = saiu), `domain`, `branch` | usuário do SSW mudou |
| `op_start` | `fn` (manifesto/coleta/romaneio, carga_manifesto/carga_coleta/carga_romaneio), `plate`, `realPlate`, `units[]`, `total`, `read?` | abriu a tela de bipagem |
| `progress` | `fn`, `plate`, `read`, `total?` | números de Lidos mudaram |
| `op_end` | `fn`, `plate`, `reason` (concluded/interrupted/left) | Concluir, Interromper ou saiu da tela |
| `heartbeat` | `screen` (bipagem/placa/menu/login/outra), `user?`, `fn?`, `plate?` | a cada 15 s |
| `diag` | `screen`, `reason`, `path`, `title?`, `ids[]?`, `inputs[]?`, `texts[]?`, `reader?` | tela não entendida (0.5.1) |

`total`/`read` = `{ "qty": n, "kg": n, "value": n }` (números, ponto decimal).

Respostas (todas trazem `serverTime`):

- `200 { accepted, duplicates }` — apagar da fila local.
- `401 clock_skew` — relógio fora de ±5 min: guardar `offset = serverTime - agora` e reenviar.
- `409 stale` — `x-ts` não é maior que o do último lote aceito: reenviar com hora nova (mesmos eventos).
- `400` — formato inválido: descartar o lote (não adianta repetir) e registrar no log.
- `401` (outros) — aparelho removido ou assinatura errada: parar e esperar o próximo check-in.
- `403 ops_disabled` — leitura desligada para o coletor: parar de ler e descartar a fila.
- `413` — lote grande demais: dividir. `429` — esperar e repetir (com jitter).

Regras no servidor: evento com id já recebido é ignorado (reenvio não duplica); eventos do lote são aplicados pela
hora do aparelho; `op_start` da mesma função+placa continua a operação; outra placa encerra a anterior
(`replaced`); `progress` sem início abre a operação; `session` com `user: null` encerra (`left`).

## Banco

- `ops_operations`: uma linha por descarga — totais, lidos, bipagens, primeira/última, soma e quantidade de intervalos
  (tempo médio por volume = soma ÷ quantidade). Guardado sem prazo.
- `ops_events`: eventos como chegaram. Limpeza (2.5, `src/opsRetention.ts`), pela própria API ao subir (+1 min) e a
  cada hora, em lotes de 5.000:
  - sinal de vida: `OPS_HEARTBEAT_RETENTION_DAYS` (padrão 7 dias);
  - demais eventos: `OPS_RETENTION_DAYS` (padrão 90 dias);
  - antes de apagar os eventos de uma carga, os pontos do gráfico de bipagens vão para `ops_operations.scan_curve`
    (`[[hora ms, lidos], ...]`, só quando "lidos" muda) e o detalhe da carga continua igual.
- `ops_settings`: chave geral da leitura (uma linha; na fase 3, uma por tenant).
- `ops_device_state`: o que cada coletor está fazendo agora (os cards).

## Tela "Acompanhamento de operações" (2.3)

- **Cards** (`/operations`): um por coletor — "Fulano está na função X agora, no carro Y", total/lidos/faltam, valor,
  tempo médio por volume, previsão de término, há quanto tempo a carga começou. Em operação primeiro; "sem sinal"
  quando o coletor fica mais de 45 s sem mandar nada (o app manda sinal de vida a cada 15 s).
- **Detalhe** (`/operations/<coletor>`): volumes/peso/valor (total, lidos, faltam), tempo do colaborador na função hoje
  (todas as cargas dele nessa função), tempo desta carga, tempo médio por volume, estimativa de término, lista de
  bipagens com o intervalo de cada uma e as cargas de hoje do coletor (clique abre uma carga antiga).
- **Ao vivo**: o navegador abre uma conexão SSE direto na API (`GET /v1/ops/stream?ticket=…`). O ingresso é pedido pelo
  painel (`POST /v1/admin/ops/stream-ticket`, com a sessão), vale 60 s e uma única vez. Se a conexão cair, a tela pede
  outro ingresso e reconecta (1, 2, 5, 10 s). Mudanças rápidas do mesmo coletor são juntadas em 150 ms.
- **Sessão**: a conexão confere a sessão a cada 60 s (encerrada/expirada → a tela avisa) e conta como uso — uma TV com a
  tela aberta não cai pelas 8 h sem uso; o limite de 2 dias continua.
- **Limites**: 10 conexões por usuário, 300 no total; CORS só para os endereços do painel (`PANEL_ORIGINS`).
- **Estimativa de término**: faltantes × tempo médio por volume da carga, a partir da última bipagem.
