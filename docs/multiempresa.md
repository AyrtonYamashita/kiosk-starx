# Várias empresas no mesmo painel (Fase 3 — desenho)

Só desenho: nada disto está implementado. As tabelas criadas desde a Fase 1 já têm `tenant_id` (vazio).
Respostas do dono do produto em 2026-11-18 no fim; o desenho abaixo já as considera.

## Objetivo

Uma instalação (API + Postgres na VPS + painel na Vercel) atende várias **empresas** (tenants): outras
transportadoras, clientes da PStarX. Cada empresa vê e mexe
só no que é dela: coletores, cadastros/QR, perfis, apps, comandos, usuários, acompanhamento e auditoria. Acima delas,
a **plataforma** (a PStarX) cria empresas, publica o app do kiosk e dá suporte.

## Decisões propostas

### 1. Isolamento: banco único, `tenant_id` em toda linha, RLS como segunda barreira

| Opção | Prós | Contras |
|---|---|---|
| **Banco e tabelas únicos + `tenant_id` + RLS** (proposta) | uma migração, um backup, um deploy; relatório da plataforma fácil | um erro de filtro pode vazar dados → por isso o RLS |
| Schema por empresa | separação forte | migração e backup N vezes; conexões por schema |
| Instalação por empresa (VPS/compose próprios) | separação total | N deploys, N painéis; só para cliente que exigir em contrato |

A API já aceita `DB_SCHEMA`, então uma empresa que exigir separação total pode ganhar uma instalação própria sem mudar
código. O padrão é o banco único.

**RLS (Row Level Security do Postgres):** cada requisição roda numa transação com `set_config('app.tenant_id', …)`. As
políticas permitem só `tenant_id = current_setting('app.tenant_id')::uuid`. Com `FORCE ROW LEVEL SECURITY`, nem o dono
das tabelas escapa. Se faltar um `WHERE tenant_id = …` em alguma consulta, o banco devolve vazio em vez de dados de
outra empresa. A plataforma usa um papel separado do banco, que ignora o RLS, só nas rotas dela.

### 2. De onde vem a empresa de cada requisição

- **Painel:** da sessão (`sessions.tenant_id`, copiado do usuário no login). Nunca de cabeçalho, URL ou corpo.
- **Coletor:** do próprio aparelho (`devices.tenant_id`, encontrado pelo token). A busca pelo token acontece antes de se
  saber a empresa: é a única consulta fora do RLS, feita por uma função `SECURITY DEFINER` que só devolve id e empresa.
- **Plataforma "entrando" numa empresa** (suporte): a sessão guarda a empresa escolhida. Isso gera um registro na
  auditoria da plataforma e da empresa, e o painel mostra uma faixa "você está vendo a empresa X".

### 3. Usuários e papéis

- Papéis por empresa continuam `admin` e `operador`. Acima deles entra **`plataforma`** (`tenant_id` vazio).
- O e-mail continua **único no sistema todo**: o login não precisa perguntar a empresa, e a 2FA, as passkeys
  (RP `pstarx.com`) e os códigos por e-mail não mudam.
- O nome de usuário passa a ser único **por empresa**.
- Cada usuário pertence a uma empresa só.

### 4. O que muda tabela a tabela

| Tabela | Muda |
|---|---|
| `tenants` (nova) | id, nome, apelido, situação (ativa/suspensa), criada em |
| `admins` | `tenant_id` obrigatório (exceto para plataforma); `username` único por empresa |
| `sessions`, `trusted_devices`, `recovery_codes`, `admin_totp`, `webauthn_*`, `email_otps` | `tenant_id` copiado do usuário |
| `enrollment_codes` | `tenant_id`: o código define a empresa do coletor no cadastro |
| `devices` | `tenant_id` obrigatório; a unificação por serial (`mergeBySerial`) só dentro da mesma empresa |
| `profiles` | `name` único por empresa |
| `commands`, `screenshots` | `tenant_id` copiado do coletor (para RLS e índices) |
| `apps`, `app_versions` | repositório por empresa: chave `(tenant_id, package_name)`. Os arquivos continuam guardados pelo sha256 (o mesmo APK enviado por duas empresas ocupa espaço uma vez), mas o acesso é conferido por empresa |
| `ops_*` | `tenant_id` copiado do coletor; `ops_settings` com uma linha por empresa |
| `auth_events` | `tenant_id` preenchido; a plataforma vê tudo, a empresa só o dela |
| `auth_lockouts`, `upload_tokens` | continuam globais (bloqueio por IP/identificador; token de envio já ligado ao usuário) |

**Coletor que muda de empresa:** cadastrado com o código de outra empresa, ele vira um registro novo na empresa nova.
Na antiga, o registro fica como "transferido" e o token antigo para de valer. Hoje o serial unifica registros, e sem
essa regra o código de uma empresa poderia "tomar" o coletor de outra.

### 5. Partes que não são tabela

- **App do kiosk (`release.json`):** um só, publicado pela plataforma. "Apps → App do kiosk" passa a ser da plataforma.
  Fixar uma versão por empresa fica para depois, se for preciso.
- **Aviso imediato (waker):** é por coletor, então não muda.
- **Acompanhamento ao vivo (SSE):** o ingresso leva a empresa, e cada conexão só recebe os cards da empresa dela. O
  limite de conexões passa a ser por empresa.
- **Limpeza dos eventos:** os prazos continuam globais (`.env`). Prazo por empresa fica para depois, se alguma pedir.
- **Domínio:** um painel só (`kiosk.pstarx.com`) e um domínio de API só. Subdomínio por empresa (`empresa.kiosk…`) não
  traz ganho agora e complica cookies, passkeys e a Vercel.
- **LGPD:** cada empresa é a controladora dos dados dos colaboradores dela (usuário do SSW, localização), e a PStarX é
  a operadora. Apagar uma empresa apaga tudo dela em cascata. Os backups diários (14 dias) saem da janela sozinhos.
  Vale um contrato de operador (DPA) com cada empresa.

## Como seria a implementação (quando for a hora)

1. **3.1 Base, sem mudar comportamento:** tabela `tenants`, empresa "PStarX" criada com todos os dados atuais,
   `tenant_id` obrigatório e chaves únicas por empresa. O seu usuário vira plataforma e também admin da PStarX.
2. **3.2 Filtro na aplicação:** empresa na sessão e no coletor, e todas as consultas filtradas. Bateria de testes com
   duas empresas: para cada rota, a empresa B recebe 404 nos ids da A, as listas só trazem o que é dela, e o SSE e os
   eventos do coletor também ficam separados.
3. **3.3 RLS:** políticas e um papel do banco sem permissão para ignorá-las. Os testes da 3.2 rodam de novo com o RLS
   ligado.
4. **3.4 Painel da plataforma:** criar e suspender empresa, convidar o primeiro admin, "entrar como" com auditoria.

Cada parte é publicada e validada antes da próxima, como nas fases anteriores.

## Respostas (2026-11-18)

- **A. Quem são as empresas:** outras transportadoras (clientes). Por isso o desenho com isolamento total, RLS e
  plataforma.
- **B. Usuário em mais de uma empresa:** não. Cada usuário tem uma empresa só, e o login não pergunta a empresa.
- **C. Quem cria empresas:** só a plataforma (PStarX). Não há cadastro aberto.
- **D. Limite de coletores por empresa:** por enquanto não. Se vier cobrança por coletor, entra uma coluna em `tenants`
  e uma conferência no cadastro do coletor.
- **E. App do kiosk:** o mesmo para todas, publicado pela plataforma.
