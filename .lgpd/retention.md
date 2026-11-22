# Retenção, bloqueio e eliminação — StarX Kiosk (F9, 2026-11-22)

**Status**: proposta técnica. Os prazos marcados como "decisão jurídica" dependem do advogado trabalhista/consumerista da empresa. Arts. 15 e 16 LGPD: terminada a finalidade, elimina-se; conserva-se só nas hipóteses do Art. 16, minimizado e bloqueado.

## 1. Matriz de retenção

| Registro (tabela) | Atividade | Hoje | Proposta | Fundamento / critério | Marco inicial | Ação ao fim |
|---|---|---|---|---|---|---|
| Eventos brutos do SSW (`ops_events`) | A001 | 90 d | **manter 90 d** | necessidade operacional (diagnóstico e reconstrução de carga) | recebimento | apagar (já implementado) |
| Sinal de vida do SSW (`ops_events` tipo heartbeat) | A001 | 7 d | **manter 7 d** | necessidade técnica | recebimento | apagar (já implementado) |
| Estado atual do coletor (`ops_device_state`) | A001 | sobrescrito | **manter** | só o estado atual | — | sobrescrito; some com o aparelho |
| Bipagens (`ops_scans`) | A003 | 365 d | **365 d (decisão jurídica)** | rastreio de volumes para divergências e reclamações de clientes; o prazo deve acompanhar o prazo real de reclamação dos contratos de transporte/armazenagem | data da bipagem | apagar (já implementado) |
| Cargas com colaborador (`ops_operations.ssw_user`) | A001/A002 | **indefinido** | **365 d identificado**; depois **anonimizar `ssw_user`** (manter números agregados da carga) | finalidade operacional/gerencial cumprida em até 1 ano | início da carga | anonimizar (implementado) |
| Cargas para defesa trabalhista | A002 | — | **opcional (decisão jurídica)**: se o jurídico quiser reter para defesa em reclamação trabalhista, guardar **bloqueado** (sem uso no painel) até 2 anos após o desligamento, respeitado o limite de 5 anos (CF, Art. 7º, XXIX) | Art. 7º, VI + Art. 16 | desligamento do colaborador | eliminar/anonimizar |
| Capturas de tela (`screenshots`) | A005 | últimas 10, sem prazo | **7 d** (mantido o teto de 10) | suporte se resolve em dias | criação | apagar (implementado) |
| Última localização (`devices.info.location`) | A004 | sobrescrita | **manter** só a última; com a localização desligada, o app envia nulo e apaga | minimização | — | sobrescrita (já implementado) |
| Inventário do aparelho (`devices`) | A006 | enquanto cadastrado | **manter** | gestão do ativo | — | remoção do aparelho no painel (já implementado; `ON DELETE CASCADE` apaga ops/capturas/comandos) |
| Comandos (`commands`) | A006 | sem prazo | **180 d** | histórico técnico | criação | apagar (implementado) |
| Trilha de login e ações (`auth_events`) | A007/A008 | **indefinido** | **1 ano**; tentativas com identificador de **conta inexistente: 30 d** | segurança e responsabilização; o Marco Civil, Art. 15 (6 meses) é **referência**, não obrigação direta para um sistema interno | data do evento | apagar (implementado) |
| Sessões, OTP, navegadores confiáveis | A007 | expiram | **manter** | — | — | já implementado |
| Usuários do painel desativados (`admins`) | A007 | **nunca excluídos** | **anonimizar 1 ano após desativar** (usuário/e-mail substituídos; mantém o id para a trilha) | fim da finalidade | desativação | anonimizar (implementado) |
| Logs da API (stdout Docker) | A009 | **sem limite** | **rotação ~30 d** (`logging: max-size/max-file` no `docker-compose.yml`) | diagnóstico | — | rotação (implementado) |
| Backups (`deploy/backups`) | A009 | 14 d, na VPS, sem cifra | **14 d na VPS + cópia cifrada fora (até 30 d)** | recuperação de desastre | criação | rotação (implementado; cifrado com age desde 2026-11-22; cópia externa adiada) |
| Registro de incidentes (`.lgpd/incidents/log.md`) | — | inexistente | **mínimo 5 anos** | Res. CD/ANPD nº 15/2024, Art. 10 | registro | — |

## 2. Eliminação a pedido do titular (Art. 18, VI)
- **Colaborador** (identificado pelo `ssw_user`): anonimizar `ssw_user` em `ops_operations` e `ops_device_state`; os eventos e bipagens vinculados seguem a carga (já sem identificação depois da anonimização) e expiram pelos prazos acima. Exceção: registros bloqueados para defesa trabalhista, se o jurídico decidir (Art. 16).
- **Usuário do painel**: anonimizar `admins` (usuário/e-mail), apagar sessões, TOTP, passkeys, códigos e navegadores confiáveis; a trilha fica com o id anonimizado.

## 3. Backups e eliminação
- Prazo curto (14 d): dado eliminado some de todos os backups em até 14 dias (30 se houver cópia externa).
- **Restauração de backup** (Abordagem A simplificada): manter uma lista sem PII das eliminações feitas (ex.: HMAC do `ssw_user` / id do admin + data) e **reaplicar as anonimizações** depois de qualquer restauração, antes de reabrir o painel. Documentar no `deploy/README.md` (seção Backup) quando for implementado.
- Crypto-shredding (Abordagem B): desproporcional para o volume atual.

## 4. Propagação a operadores (Art. 18, § 6º)
- **VPS**: o banco é o próprio sistema; eliminar no banco basta (backups conforme §3).
- **Vercel / Cloudflare**: não guardam dados de negócio, só logs transitórios. Confirmar o prazo desses logs (validação externa); sem API de exclusão necessária.
- **Resend**: pode guardar o histórico de e-mails enviados (endereço). Ao anonimizar um usuário do painel, verificar/remover no painel da Resend ou confirmar a retenção curta.

## 5. Implementação (Fase 1, parte 2: `server/src/retention.ts`, commit a seguir)
**Implementado** (2026-11-22): rotina a cada 6 h na API (`server/src/retention.ts`, testes em `server/test/retention.test.ts`), além da limpeza do SSW (`server/src/opsRetention.ts`), com prazos em variáveis de ambiente:
`OPS_OPERATION_IDENTIFIED_DAYS=365`, `SCREENSHOT_RETENTION_DAYS=7`, `COMMAND_RETENTION_DAYS=180`, `AUTH_EVENT_RETENTION_DAYS=365`, `AUTH_UNKNOWN_IDENTIFIER_DAYS=30`, `ADMIN_DISABLED_ANONYMIZE_DAYS=365`; mais a rotação de logs no `docker-compose.yml`. Os schemas Prisma de referência (`RetentionRule`, `ErasureSuppressionTombstone`, `OperatorPropagationOutbox`) não se aplicam como estão (a API usa SQL direto). Uma tabela simples de eliminações cumpre o §3.
