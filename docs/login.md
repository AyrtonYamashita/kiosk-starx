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

## 1.2 — Argon2id

- Senhas novas em **Argon2id** (formato PHC, 19 MiB, t=2, p=1 — mínimo recomendado pela OWASP), biblioteca
  `@node-rs/argon2` (binário pronto para o Alpine da imagem).
- Hashes antigos em scrypt continuam entrando; no próximo login certo a senha é regravada em Argon2id (evento
  `password_rehashed` na auditoria). Senha errada não regrava nada.
- Conta inexistente gasta o mesmo tempo (hash falso também em Argon2id).

**Deploy:** só a imagem da API (sem migração). **Rollback:** voltar a imagem anterior **não** lê Argon2id — quem já
tiver entrado depois da 1.2 ficaria sem login. Antes de um rollback, redefina essas senhas (página Usuários) ou
mantenha a 1.2.

## 1.3a — segundo fator por e-mail, confiar no navegador, códigos de recuperação

Com `AUTH_REQUIRE_2FA=true`, a senha certa não abre o painel: a API devolve uma **sessão provisória** (10 min, `stage='mfa'`)
que só serve para pedir/conferir o código. O código vai por e-mail (Resend, `no-reply@pstarx.com`).

- **Código**: 8 caracteres do alfabeto `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (sem 0/O/1/I/L), `crypto.randomInt`,
  mostrado como `ABCD-2345`. No banco só o HMAC-SHA256 com `AUTH_SECRET`. Vale 10 min (`OTP_TTL_MIN`), uso único;
  pedir outro invalida o anterior; 5 erros no mesmo código o invalidam.
- **Tentativas**: 5 códigos errados por sessão provisória derrubam a etapa (volta para a senha). Cada erro também conta
  no bloqueio progressivo da conta (o mesmo da senha: 5 falhas → 60 s, 5 min, 15 min, 1 h).
- **Envio**: no máximo 3 a cada 15 min por conta, 60 s entre envios, 10 por hora por IP → 429 com `Retry-After`.
  O envio é assíncrono (a resposta não espera o Resend), com 3 tentativas e chave de idempotência; falha vai para o log
  e para a auditoria (`otp_send_failed`).
- **Confiar neste navegador**: marcado na tela do código, cria um token de 30 dias (`TRUST_DAYS`) guardado em cookie
  httpOnly `kiosk_trust` (no banco só o SHA-256). Nesse navegador a senha continua sendo pedida, o código não.
  Trocar a senha, ter a senha redefinida pelo admin ou ser desativado apaga todos os navegadores confiáveis.
- **Códigos de recuperação**: 10, gerados na Conta, mostrados uma única vez, uso único (HMAC no banco). Gerar de novo
  invalida os anteriores.
- **Admin → Usuários → Editar → Zerar 2FA**: apaga códigos de recuperação e navegadores confiáveis e encerra as sessões
  da pessoa (para quem perdeu o acesso ao e-mail: o admin corrige o e-mail e zera).
- **Auditoria**: `login_password_ok`, `mfa_challenge`, `mfa_failure`, `mfa_success`, `otp_send_failed`,
  `recovery_codes_generated`, `trusted_device_revoked`, `mfa_reset`. O código nunca é registrado.

Variáveis (`deploy/.env`): `AUTH_REQUIRE_2FA`, `AUTH_SECRET` (32+ caracteres, obrigatório com 2FA ligado),
`RESEND_API_KEY` (só no servidor), `MAIL_FROM`, opcionais `OTP_TTL_MIN` e `TRUST_DAYS`.

### Checklist de deploy (1.3a)

1. Backup do banco (`pg_dump` em `deploy/backups/`).
2. Conferir no `.env` da VPS: `RESEND_API_KEY`, `MAIL_FROM`, `AUTH_SECRET` e **`AUTH_REQUIRE_2FA=false`**.
3. Subir a API (migração `005_mfa_email.sql` roda sozinha) e publicar o painel (Vercel).
4. Com o 2FA ainda desligado: entrar normalmente, abrir **Conta**, gerar os códigos de recuperação e guardá-los.
5. Conferir que **todas** as contas têm e-mail (Usuários). Conta sem e-mail só entra com código de recuperação.
6. Ligar: `AUTH_REQUIRE_2FA=true` e `docker compose up -d api`. Entrar de novo: o código deve chegar por e-mail.

### Rollback (1.3a)

- Problema com e-mail ou com a tela: `AUTH_REQUIRE_2FA=false` e `docker compose up -d api` (volta ao login só com senha,
  sem perder nada).
- Voltar a imagem anterior: a migração 005 só adiciona colunas/tabelas, a versão 1.2 continua funcionando com elas.

## 1.3b — app autenticador (TOTP), opcional

- **Ativar** (Conta → Verificação em duas etapas → App autenticador): senha atual → QR Code e chave para digitar →
  primeiro código de 6 dígitos confirma. Sem confirmar (ou depois de 30 min), não vale.
- **Login de quem ativou**: o código é pedido pelo app e o e-mail **não** sai sozinho; "Sem o celular? Receber código por
  e-mail" envia na hora (mesmos limites de envio). Códigos de recuperação continuam valendo.
- **Padrão**: RFC 6238 (HMAC-SHA1, 6 dígitos, 30 s), aceita ±1 passo (relógio do celular até ~30 s fora). Implementação
  própria (`server/src/totp.ts`), testada com o vetor oficial do RFC.
- **Segurança**: a chave fica criptografada no banco (AES-256-GCM, chave derivada do `AUTH_SECRET` via HKDF) — trocar o
  `AUTH_SECRET` invalida todos os apps (cada pessoa ativa de novo). O passo usado é gravado: o mesmo código, ou um
  anterior, não entra de novo. Erros contam nos 5 por etapa e no bloqueio da conta. Senha errada ao ativar/desativar
  também conta no bloqueio.
- **Desativar**: pede a senha atual. "Zerar 2FA" (admin) também remove o app.
- **Auditoria**: `totp_enabled`, `totp_disabled`, `password_check_failed`; `mfa_success` com `method: "totp"`.

### Deploy (1.3b)

1. Backup do banco. 2. Subir a API (migração `006_totp.sql`, só adiciona a tabela `admin_totp`) e publicar o painel.
Nenhuma variável nova. Rollback: voltar a imagem anterior (a tabela a mais não atrapalha; quem ativou o app volta a
receber o código por e-mail).

## 1.3c — passkeys (opcional)

- **Cadastrar** (Conta → Verificação em duas etapas → Passkeys → Adicionar passkey): nome + senha atual → janela do
  navegador (Windows Hello, Touch ID, Android, chave de segurança). Até 10 por conta; lista com último uso e Remover.
- **"Entrar com passkey"** na tela de login: sem usuário, senha nem código — a passkey já é 2 fatores (aparelho +
  biometria/PIN) e não funciona em site falso. Também aparece como primeira opção na etapa 2 de quem entrou com senha
  (o e-mail então não sai sozinho; continua disponível).
- **Domínio (RP ID)**: `pstarx.com` — vale em `kiosk.pstarx.com` e em qualquer `*.pstarx.com` no futuro. **Não trocar**:
  mudar o RP ID invalida todas as passkeys cadastradas.
- **Segurança**: verificação do usuário obrigatória (biometria/PIN, não só toque); desafio de uso único com 5 min; origem
  (`WEBAUTHN_ORIGINS`) e domínio conferidos; contador do autenticador só anda para a frente (clone é recusado); só a
  chave pública fica no banco. Falhas do login sem senha contam no bloqueio por IP; na etapa 2, no bloqueio da conta.
  Uma passkey entra mesmo com a conta bloqueada por senhas erradas (o bloqueio protege a senha; a passkey não é
  adivinhável) — o bloqueio por IP continua valendo.
- **Admin → Zerar 2FA** também remove as passkeys.
- **Auditoria**: `passkey_registered`, `passkey_removed`, `passkey_register_failed`, `passkey_failure`,
  `login_success` com `method: "passkey"`.
- **Testes**: autenticador de software (`server/test/softAuthenticator.ts`, ES256) cobre cadastro, login, replay,
  site/domínio errado, sem biometria, contador voltando, passkey removida, bloqueio por IP e etapa 2.

### Deploy (1.3c)

1. Backup do banco.
2. No `.env` da VPS: `WEBAUTHN_RP_ID=pstarx.com` e `WEBAUTHN_ORIGINS=https://kiosk.pstarx.com`.
3. Subir a API (migração `007_passkeys.sql`, só tabelas novas) e publicar o painel.
Rollback: voltar a imagem anterior (as tabelas a mais não atrapalham; as passkeys param de funcionar até voltar).
