# Login do painel (Fase 1)

## 1.1 — base (contas, limites, bloqueio, auditoria, sessões)

- **Contas:** usuário e e-mail (o login aceita os dois), papel `admin` (tudo) ou `operator` (operação: aparelhos,
  comandos, acompanhamento; sem Usuários e segurança). `tenant_id` já existe nas tabelas novas (multi-tenant futuro).
- **Limite e bloqueio:** 10 tentativas/min por IP (429 + `Retry-After`); 5 senhas erradas bloqueiam a **conta** e 20
  erros do mesmo **IP** bloqueiam o IP. A duração cresce: 1 min → 5 min → 15 min → 1 h; 24 h sem erro zeram o
  histórico. A conta é o que foi digitado (existindo ou não), e a mensagem é sempre "usuário ou senha incorretos".
  Desbloqueio manual em **Usuários → Bloqueios ativos**.
- **Sessão:** 2 dias no máximo, expira após 8 h sem uso (`SESSION_TTL_HOURS`, `SESSION_IDLE_HOURS`). Nova a cada login
  (a anterior do navegador é encerrada no servidor). Logout e "Encerrar" apagam a sessão no servidor.
- **Auditoria:** login, falha (motivo), barrado, bloqueio, desbloqueio, logout, sessão encerrada, senha trocada,
  usuário criado/alterado. Nunca grava senha.
- **IP real:** o painel (Vercel) repassa o IP e o navegador de quem usa, assinados com `PANEL_SECRET` (mesmo valor na
  API e na Vercel). Sem o segredo, a API vê o IP da Vercel e o limite por IP valeria para todos juntos.

### Checklist de deploy (1.1)

1. Backup do banco (`pg_dump`) na VPS.
2. Gerar o segredo (`openssl rand -base64 32`) e pôr `PANEL_SECRET=` no `deploy/.env` da VPS.
3. **Vercel → Settings → Environment Variables:** `PANEL_SECRET` com o mesmo valor (Production) e redeploy do painel.
4. Subir a API (`docker compose up -d --build api`): a migração `004_auth_base.sql` roda sozinha (só acrescenta).
5. Pôr o e-mail do admin atual: `UPDATE admins SET email = '…' WHERE username = 'admin';`
6. Conferir: login por usuário e por e-mail; página Usuários; IP real na auditoria (não o da Vercel).

### Rollback

A migração só acrescenta colunas e tabelas: voltar a imagem anterior da API funciona com o banco novo. As sessões
continuam válidas nas duas versões.
