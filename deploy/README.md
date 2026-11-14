# Deploy

```
VPS:     Caddy (já existente, HTTPS) ──► API (Docker, 127.0.0.1:3100) ──► Postgres (Docker)
Vercel:  painel Next.js (web/) ──► API (pelo servidor do painel; o navegador não fala com a API)
Aparelhos ──► API (HTTPS): cadastro, check-in, download do APK do QR
```

## 1. API na VPS

```bash
# na VPS (Docker + Compose v2), numa pasta fora de sites públicos, ex.: /opt/starx-kiosk
git clone <repositório> /opt/starx-kiosk      # ou copie as pastas server/ e deploy/
cd /opt/starx-kiosk/deploy
cp .env.example .env && nano .env             # PUBLIC_URL, POSTGRES_PASSWORD, ADMIN_*
docker compose up -d --build
curl -s http://127.0.0.1:3100/health          # {"ok":true}
```

As migrações do banco rodam sozinhas quando a API sobe. O administrador inicial só é criado se não houver nenhum.
Depois do primeiro login, troque a senha em **Conta** e apague `ADMIN_PASSWORD` do `.env`.

### Caddy (já existente)

Acrescente o bloco de [Caddyfile.snippet](Caddyfile.snippet) ao Caddyfile, com o domínio da API. Antes, crie um
registro DNS A apontando o domínio para o IP da VPS. Em seguida, recarregue o Caddy:
`caddy reload --config /etc/caddy/Caddyfile`, ou `systemctl reload caddy`.

**Caddy em Docker:** `127.0.0.1` dentro do container é o próprio container. Escolha uma das opções:

- coloque a API na rede do Caddy e use `reverse_proxy api:3100` (acrescente `networks` ao serviço `api`);
- ou use `reverse_proxy host.docker.internal:3100`, com `extra_hosts: ["host.docker.internal:host-gateway"]`
  no Caddy, e troque o `ports` da API para `"172.17.0.1:3100:3100"`.

### APK do QR

O QR manda o aparelho baixar o app de `PUBLIC_URL/apks/`. Para publicar uma versão:

```bash
# na máquina de build (precisa da keystore em ~/.starx-kiosk/signing)
cd android && ./gradlew publishApk -Pstarx.apkOut=build-publish
scp build-publish/* vps:/opt/starx-kiosk/deploy/data/apks/
```

## 2. Painel na Vercel

1. Na Vercel: **Add New → Project** → importe o repositório → **Root Directory: `web`**. O framework Next.js é detectado sozinho.
2. Em **Environment Variables**, defina `API_URL=https://<domínio da API>`.
3. Faça o deploy. O painel abre em `https://<projeto>.vercel.app`. Se quiser um domínio próprio, configure em Settings → Domains.

## Backup

O serviço `backup` faz um `pg_dump` diário em `deploy/backups/` e guarda os últimos 14. Copie essa pasta para fora
da VPS. Restaurar:

```bash
gunzip -c backups/kiosk-AAAAMMDD-HHMM.sql.gz | docker compose exec -T postgres psql -U kiosk kiosk
```

Fora do banco, guarde também:

| O quê | Onde | Se perder |
|---|---|---|
| Keystore de assinatura do app | `~/.starx-kiosk/signing/` (máquina de build) | **não dá mais para atualizar o app** nos aparelhos (reprovisionamento total) |
| `deploy/.env` | VPS | recriável; trocar `POSTGRES_PASSWORD` exige alterar a senha no banco |
| APKs publicados | `deploy/data/apks/` | republicáveis com `publishApk` |
