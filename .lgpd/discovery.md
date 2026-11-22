# Discovery técnico — StarX Kiosk (L1, 2026-11-22)

Fatos observados no repositório (commit `3a5d170`, ramo `painel-v2`). Este documento **não** é parecer jurídico. O que depende de contrato, processo humano ou configuração fora do repositório está marcado como **validação externa**.

## 1. Arquitetura e fluxo

| Componente | Onde roda | Papel |
|---|---|---|
| App Android `com.pstarx.kiosk` (Device Owner) | coletores dos colaboradores | kiosk, inventário do aparelho, localização, comandos remotos, **leitura da tela do SSW** |
| API Fastify + Postgres | VPS (Docker, `deploy/docker-compose.yml`), atrás de Caddy/Cloudflare | recebe check-in, eventos do SSW, guarda e serve o painel |
| Painel Next.js | Vercel (`kiosk.pstarx.com`) | administração e acompanhamento ao vivo |
| E-mail transacional | Resend (`server/src/mfa.ts:65`) | código de 2º fator do login do painel |
| Mapa | OpenFreeMap (`web/src/app/(panel)/devices/[id]/DeviceMap.tsx:16`) | tiles requisitados pelo navegador do administrador |

## 2. Categorias de titulares e dados pessoais

### 2.1 Colaboradores que usam os coletores (titulares principais)
- **Identificação no SSW**: `ssw_user`, `domain`, `branch` em `ops_operations` e `ops_device_state` (`server/migrations/008_ops.sql:16-18, 57-61`). Lidos da página pelo `server/reader/ssw_reader.js:104-106`.
- **Atividade/produtividade**: cada carga com início, fim, motivo, volumes, peso, valor, número de bipagens, intervalos entre bipagens (`008_ops.sql:8-33`) e a curva de bipagens (`010_...sql:18`). O painel calcula ritmo (s/volume), tempo na função no dia e previsão de término (`server/src/routes/opsAdmin.ts`).
- **Bipagens**: código de barras, horário e classificação de cada leitura (`012_ops_scans.sql`), retidas **365 dias** (`server/src/config.ts`, `OPS_SCAN_RETENTION_DAYS`).
- **Eventos brutos do SSW**: `ops_events.data` (jsonb) retidos **90 dias**; sinal de vida retido 7 dias (`deploy/.env.example:39-41`, `server/src/opsRetention.ts:91-134`).
- **Localização do aparelho** (indiretamente do colaborador que o porta): GPS/rede, atualizada a cada 1 min ou 10 m (`android/.../device/LocationTracker.kt:18-19`), enviada no check-in e guardada **só a última posição** em `devices.info` (sobrescrita). Ligada por padrão (`KioskConfig.kt:127`, `security.reportLocation = true`). A permissão inclui `ACCESS_BACKGROUND_LOCATION`, concedida sem interação pelo Device Owner (`admin/DeviceOwner.kt:16-22`), e a localização do sistema é forçada a ligada (`DeviceOwner.kt:30-42`).
- **Capturas de tela** do coletor sob comando do painel (`003_commands_apps.sql:24`), até 10 por aparelho (`server/src/routes/commands.ts:48`). Podem mostrar o que o colaborador vê no SSW.
- **Encerramento por inatividade** no coletor (app 0.5.3): só lógica local, sem dado novo.

### 2.2 Aparelho (dado pessoal indireto quando associado ao colaborador)
- IMEI, serial, MAC Wi-Fi, SSID, IPs locais, IP público, bateria, apps instalados (`android/.../device/DeviceInfo.kt:52-122`; `001_init.sql:35-60`).

### 2.3 Usuários do painel (administradores/operadores)
- `admins`: usuário, e-mail, hash de senha, papel (`001_init.sql:3`, `004_auth_base.sql:4-11`).
- Sessões com IP e user agent (`004_auth_base.sql:15-18`); navegadores confiáveis com IP/UA (`005_mfa_email.sql:36`); TOTP, passkeys, códigos de recuperação (só hash/HMAC).
- **Trilha `auth_events`**: identificador digitado (mesmo de conta inexistente), IP, UA, detalhes, **sem rotina de exclusão** (`004_auth_base.sql:21-31`; nenhuma `DELETE FROM auth_events` em `server/src`).

### 2.4 Dados sensíveis (Art. 11)
- Nenhum dado sensível tratado de propósito. Ponto de atenção: as capturas de tela e os textos de diagnóstico do leitor (`ssw_reader.js:203-221`, até 30 textos da página) podem conter o que estiver na tela.

## 3. Coleta: o que o leitor do SSW **não** faz (controles já existentes)
- Não captura senha: o campo de senha só serve para detectar a tela de login (`ssw_reader.js:94`).
- No diagnóstico, os **valores** de campos se limitam a `funcao, placa, placa_real, dominio, filial` (`ssw_reader.js:204-213`).
- Só observa: não clica nem digita (cabeçalho do `ssw_reader.js`).
- Só lê com a chave ligada (geral ou por coletor; `009`, `010`).

## 4. Segurança observada
- **Em trânsito**: HTTPS (Caddy + Cloudflare; `deploy/Caddyfile.snippet`). Lotes do coletor **assinados** com HMAC e protegidos contra repetição (`server/src/ops.ts`, `signBatch`; `devices.ops_last_ts`).
- **Credenciais**: senha com hash; token de aparelho, sessão, OTP e recuperação guardados só como SHA-256/HMAC (`001_init.sql:10, 39`; `005_mfa_email.sql`).
- **Autenticação do painel**: 2FA (e-mail, TOTP, passkey), bloqueio progressivo por IP e por conta (`004_auth_base.sql:37`), papéis admin/operador.
- **Logs da API**: o pino oculta `authorization` e `cookie` (`server/src/app.ts:28`), mas registra URL e IP de cada requisição. Não há rotação de log configurada no `docker-compose.yml` (driver padrão).
- **Em repouso**: criptografia de disco/volume da VPS **não verificável no repositório** (validação externa). Não há criptografia por coluna.
- **Backups**: `pg_dump` diário, mantém os últimos 14, **no mesmo servidor** (`deploy/docker-compose.yml:41-55`). Não são criptografados. O README recomenda copiar para fora (`deploy/README.md:74`).

## 5. Cookies, SDKs e rastreadores (painel)
- Sem analytics, pixels, Sentry ou rastreadores nas dependências (`web/package.json`).
- Cookies estritamente necessários: sessão, etapa de MFA e navegador confiável (`web/src/lib/actions.ts:22-54, 435-551`). Tema em `localStorage` (next-themes).
- Terceiro acionado pelo navegador: **OpenFreeMap** (tiles do mapa). As requisições revelam a região da posição do coletor e o IP do administrador ao provedor.

## 6. Retenção observada

| Dado | Prazo no código | Onde |
|---|---|---|
| Eventos brutos do SSW | 90 dias | `OPS_RETENTION_DAYS` |
| Sinal de vida do SSW | 7 dias | `OPS_HEARTBEAT_RETENTION_DAYS` |
| Bipagens (códigos) | 365 dias | `OPS_SCAN_RETENTION_DAYS` |
| Cargas (`ops_operations`, com `ssw_user`) | **indefinido** | sem rotina |
| Trilha `auth_events` | **indefinido** | sem rotina |
| Sessões / OTP | expiração + limpeza | `routes/admin.ts:170-171` |
| Capturas de tela | últimas 10 por aparelho | `routes/commands.ts:48, 195` |
| Última localização | até a próxima posição ou a remoção do aparelho | `devices.info` |
| Usuários do painel | desativados, **nunca excluídos** (sem `DELETE FROM admins`) | `routes/users*` |
| Backups | 14 dias | `docker-compose.yml:55` |
| Logs da API (stdout Docker) | **sem limite configurado** | `docker-compose.yml` |

## 7. Transparência e governança no repositório
- **Não há** política de privacidade, aviso aos colaboradores (no coletor ou no SSW), contato do Encarregado nem termos de uso no painel ou no app.
- **Não há** canal ou fluxo de direitos do titular (acesso, correção, eliminação, portabilidade) para colaboradores nem para usuários do painel.
- **Não há** runbook de incidente nem registro de incidentes.
- Há trilha de ações administrativas (`audit()` em `server/src/auth.ts:73`), mas sem proteção contra alteração nem prazo.

## 8. Operadores/terceiros identificados
| Terceiro | Dados | Localização provável | Papel provável |
|---|---|---|---|
| Vercel | tráfego do painel, cookies de sessão em trânsito, dados exibidos | EUA/global (validação externa) | operador |
| Resend | e-mail e nome de usuário do painel, conteúdo do código | EUA (validação externa) | operador |
| Cloudflare | todo o tráfego da API (IPs, payloads em trânsito) | global | operador |
| Provedor da VPS | banco, backups, logs | validação externa | operador |
| OpenFreeMap | região consultada no mapa + IP do administrador | validação externa | terceiro (tiles públicos) |
| SSW (sistema do cliente) | origem dos dados lidos na tela | — | sistema do próprio controlador |

## 9. Menores (ECA Digital)
- Produto B2B interno, usado por colaboradores adultos. Não é direcionado a menores. **Sem jovens aprendizes** operando coletores (confirmado pelo usuário em 2026-11-22): ECA Digital e Art. 14 não se aplicam.
