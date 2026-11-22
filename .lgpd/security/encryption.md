# Criptografia e gestão de chaves — StarX Kiosk (F7, 2026-11-22)

Art. 46 LGPD: a lei exige medidas aptas a proteger os dados, mas **não** fixa algoritmos ou versões. Os parâmetros abaixo são **referência de engenharia**.

## 1. Em trânsito

| Trecho | Situação | Evidência |
|---|---|---|
| Coletor → Cloudflare → Caddy → API | HTTPS (certificado do Caddy; borda Cloudflare) | `deploy/Caddyfile.snippet`, `server/src/app.ts:33-37` |
| Integridade dos lotes do coletor | HMAC por lote + proteção contra repetição | `server/src/ops.ts` (`signBatch`), `devices.ops_last_ts` |
| Navegador → painel (Vercel) | HTTPS; sessão em cookie httpOnly | `web/src/lib/actions.ts` |
| Painel (Vercel) → API | HTTPS | — |
| API → Postgres | rede interna do Docker, sem TLS. A API escuta só em `127.0.0.1` (`docker-compose.yml:20-21`) e o Postgres não publica porta | aceitável (mesma máquina) |
| **HSTS** | **não configurado** no Caddy | `deploy/Caddyfile.snippet` (só `reverse_proxy`) |

**Observação**: a Cloudflare termina o TLS na borda e vê o conteúdo em claro (eventos do SSW, localização). Ver `transfers/cloudflare.md`.

## 2. Em repouso (infraestrutura)
- **Disco/volume da VPS**: **validação externa** (depende do provedor).
- **Backups** (`deploy/backups/kiosk-*.sql.gz`): **sem criptografia**, no **mesmo servidor**, 14 dias. Um acesso indevido à VPS leva o banco e 14 cópias dele.
- **APKs** (`data/apps`): não contêm dados pessoais.

## 3. Em nível de aplicação (o que já existe)

| Dado | Proteção | Evidência |
|---|---|---|
| Senha do painel | **Argon2id** (scrypt antigo regravado no login) | `server/src/crypto.ts:3, 26` |
| Token do aparelho, sessão, navegador confiável | só SHA-256 no banco | `001_init.sql:10, 39`; `005_mfa_email.sql` |
| Código por e-mail, códigos de recuperação | HMAC | `005_mfa_email.sql` |
| Segredo TOTP | **AES-256-GCM**, chave derivada do `AUTH_SECRET` | `006_totp.sql:2, 8` |
| IMEI, MAC, e-mail dos administradores, `ssw_user`, localização | **em claro** | `devices.info`, `admins.email`, `ops_*` |

## 4. Recomendações (proporcionais ao risco atual)

| # | Ação | Prioridade | Observação |
|---|---|---|---|
| E1 | **Criptografar os backups** (ex.: `age` ou `gpg` com chave pública na VPS e chave privada fora dela) e **copiar para fora da VPS** | P1 | maior ganho por esforço: o dump é o banco inteiro |
| E2 | Confirmar a **criptografia de disco** com o provedor da VPS | P1 (externo) | — |
| E3 | **HSTS** no Caddy (`header Strict-Transport-Security "max-age=31536000"`) | P2 | só depois de confirmar HTTPS estável no domínio |
| E4 | Cifrar por coluna IMEI/MAC/e-mail (AES-256-GCM versionado + índice cego) | P2 / **não recomendado agora** | baixo ganho: a API precisa deles em claro e o vazamento típico (credencial/dump) os exporia igual. Reavaliar no cenário multiempresa |
| E5 | **Separar a chave do TOTP** do `AUTH_SECRET` (chave própria em variável dedicada) | P2 | hoje um único segredo protege sessões e TOTP |
| E6 | Cloudflare só como DNS ou TLS ponta a ponta, se o jurídico considerar a borda um risco | P2 | decisão de infraestrutura |

**Não aplicável**: o modelo de referência em Prisma (`assets/field-encryption.ts`), porque a API usa `pg` direto. Se E4 for adotado, implementar os mesmos princípios na camada `server/src`.
