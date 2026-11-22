# Trilha de auditoria — StarX Kiosk (F8, 2026-11-22)

A LGPD **não** exige hash chain. Exige segurança (Art. 46) e demonstração de responsabilidade (Art. 6º, X). Proposta proporcional ao porte atual (1 usuário no painel, uma VPS).

## Situação atual
- Tabela `auth_events` (`server/migrations/004_auth_base.sql:21`), gravada por `audit()` (`server/src/auth.ts:73-85`): login, falhas, bloqueios, sessões, usuários, fatores e ações administrativas (comandos, configuração, aparelhos).
- Colunas: `admin_id`, `identifier` (o que foi digitado, mesmo de conta inexistente), `event`, `ip`, `user_agent` (300 caracteres), `details` (jsonb).
- **Sem prazo**, **sem proteção contra alteração** (a role da API pode `UPDATE`/`DELETE`), **sem encadeamento**.
- **Não registrado hoje**: consultas de dados de colaboradores (tela Cargas, detalhe de carga, consulta por código de barras, exportações futuras de direitos do titular).

## Recomendações

| # | Ação | Prioridade | Nota |
|---|---|---|---|
| T1 | **Prazo** conforme `retention.md` (1 ano; identificador de conta inexistente 30 d) | P1 | a rotina de retenção roda com permissão própria; ver T3 |
| T2 | **Registrar consultas e exportações de dados de colaboradores**: `ops_history_view` (filtros usados, sem resultados), `ops_scan_lookup`, `dsar_export`, `dsar_anonymize` | P1 | sustenta a LIA (quem vê os indicadores individuais) |
| T3 | **Append-only no banco**: trigger bloqueando `UPDATE`/`TRUNCATE` em `auth_events` e `DELETE` permitido só para linhas além do prazo (a própria trigger checa `created_at < now() - prazo`), ou a limpeza feita por uma role separada | P2 | evita que uma sessão comprometida da API apague rastros recentes |
| T4 | **Encadeamento (hash chain)** com `seq` + `pg_advisory_xact_lock` + âncora externa diária | P2 / não agora | alto custo para o volume atual; reavaliar no cenário multiempresa |
| T5 | **Cópia externa** da trilha (junto com o backup cifrado, `encryption.md` E1) | P1 | também preserva evidências em incidente (`incidents/runbook.md`) |
| T6 | **Minimizar `details`**: nunca gravar senha, código, token ou conteúdo exportado; só ids e metadados | contínuo | conferido: `audit()` recebe `details` explícitos das rotas |

**Não aplicável como está**: os artefatos de referência em Prisma (`assets/audit-log.prisma`, `audit-log.ts`), porque a API usa `pg` direto. Se T4 for adotado, portar a mesma lógica (seq serializado + verificador) para `server/src/auth.ts`.
