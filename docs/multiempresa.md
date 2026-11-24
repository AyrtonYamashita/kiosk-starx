# Várias empresas no mesmo painel (Fase 3)

**Situação:** 3.1 (base) e 3.2 (filtro na aplicação) feitas em 2026-11-24 (migrações `016_tenants.sql` e
`017_tenant_scope.sql`; testes em `server/test/tenants.test.ts` e `server/test/isolation.test.ts`). 3.3 e 3.4 ainda
não começaram. Respostas do dono do produto em 2026-11-18 no fim; o desenho abaixo já as considera.

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

1. **3.1 Base, sem mudar comportamento:** tabela `tenants`, empresa "Alt Brasil" (a primeira cliente; a PStarX é a
   plataforma, não uma empresa) criada com todos os dados atuais, `tenant_id` obrigatório e chaves únicas por empresa.
   O usuário da PStarX vira plataforma (sem empresa).
2. **3.2 Filtro na aplicação:** empresa na sessão e no coletor, e todas as consultas filtradas. Bateria de testes com
   duas empresas: para cada rota, a empresa B recebe 404 nos ids da A, as listas só trazem o que é dela, e o SSE e os
   eventos do coletor também ficam separados.
3. **3.3 RLS:** políticas e um papel do banco sem permissão para ignorá-las. Os testes da 3.2 rodam de novo com o RLS
   ligado.
4. **3.4 Painel da plataforma:** criar e suspender empresa, convidar o primeiro admin, "entrar como" com auditoria.

Cada parte é publicada e validada antes da próxima, como nas fases anteriores.

## 3.1 como foi feita (2026-11-24)

- **Plataforma:** marcador `admins.platform`, sem empresa (`tenant_id` vazio). O banco exige as duas coisas juntas:
  usuário de empresa tem empresa, e o da plataforma não tem. Sessões, passkeys etc. do usuário da plataforma também
  ficam sem empresa. A migração marca `ayrtonyamashita@pstarx.com`; o admin da Alt Brasil é
  `ticba@altbrasil.com.br`. Numa instalação nova, o `ensureAdmin` cria um admin comum da primeira empresa. Para
  marcar outro usuário da plataforma, por enquanto só por SQL (a 3.4 traz a tela).
- **Primeira empresa:** numa instalação em uso (já com usuários), a migração cria "Alt Brasil" (`altbrasil`) com
  todos os dados. Numa instalação nova, cria "Empresa principal" (`principal`), para renomear depois.
- **Gatilhos de preenchimento:** quem grava sem `tenant_id` recebe a empresa do pai (usuário pelo `admin_id`, coletor
  pelo `device_id`, coletor novo pelo código de cadastro, anonimização por quem pediu). Nas tabelas de topo, vale
  `app.tenant_id` (para a 3.3) ou, **só enquanto existir uma empresa**, a única. Com duas empresas e nada informado, a
  gravação falha (NOT NULL) em vez de adivinhar.
- **FKs compostas** `(tenant_id, id)`: comando, carga, evento, sessão etc. só apontam para coletor/usuário da mesma
  empresa; coletor e código de cadastro só usam perfil/código da mesma empresa. O banco recusa a mistura.
- Ficaram sem empresa obrigatória: `auth_events` e `webauthn_challenges` sem usuário (conta inexistente, login sem
  senha), `auth_lockouts` e `upload_tokens`.
- `ops_settings` agora tem uma linha por empresa (chave `tenant_id`), criada por gatilho junto com a empresa.
- A sessão já leva a empresa: `req.admin.tenantId`/`platform`, e `/v1/admin/me` devolve `tenant` e `platform`.

## 3.2 como foi feita (2026-11-24)

- **Escopos na API:** as rotas do painel se dividem em *conta* (sessão, senha, 2FA, passkeys, notificações, exportar
  os próprios dados, app do kiosk) e *empresa* (`requireTenant` em `src/tenant.ts`: aparelhos, perfis, códigos,
  comandos, apps, acompanhamento, cargas, usuários, segurança, LGPD dos colaboradores). Toda consulta e gravação de
  empresa filtra/passa `tenant_id` (sempre o da sessão, via `tenantOf(req)`). Id de outra empresa: 404.
- **Coletor:** leva a empresa do código de cadastro (`authDevice` devolve `tenant_id`); download de APK só do
  repositório da empresa dele. O mesmo serial em outra empresa: o registro antigo fica com `transferred_at`, o token
  de lá para de valer e o histórico fica com a empresa antiga; o coletor voltando com código da antiga reaproveita o
  registro.
- **Login:** e-mail é único no sistema; nome de usuário repetido entre empresas entra na conta cuja senha confere
  (até 5 contas com o mesmo nome). O bloqueio do 2FA passou a ser pelo e-mail (`adminLockKey`), para o erro de uma
  empresa não bloquear a conta de mesmo nome da outra.
- **Bloqueios e auditoria:** os bloqueios continuam globais (IP e identificador digitado). A empresa vê e desbloqueia
  só contas dela e IPs de onde alguém dela tentou entrar nas últimas 24 h. A auditoria mostra os eventos da empresa e
  os sem empresa cujo identificador digitado é de um usuário dela.
- **Ao vivo e notificações:** cada conexão ao vivo só recebe cards da empresa do ingresso (limite de 100 conexões por
  empresa); cada carga notifica só os usuários da empresa dela.
- **Repositório de apps por empresa:** o arquivo continua único por sha256 e só sai do disco quando nenhuma empresa
  usa mais.
- **App do kiosk:** só a plataforma envia, publica e descarta; a empresa vê a versão publicada e os coletores dela.
- **Plataforma no painel:** sem empresa, vê só "App do kiosk" e "Conta"; telas de empresa levam para Apps. As telas
  das empresas chegam com o "entrar como" da 3.4.
- **Sem atalho:** `tenant_fallback()` só usa `app.tenant_id` (para a 3.3); gravação sem empresa falha.

**Fica para depois:** empresa suspensa ainda entra e os coletores dela continuam (entra na 3.4, junto com a tela de
empresas); prazos de retenção continuam globais.

## Respostas (2026-11-18)

- **A. Quem são as empresas:** outras transportadoras (clientes). Por isso o desenho com isolamento total, RLS e
  plataforma.
- **B. Usuário em mais de uma empresa:** não. Cada usuário tem uma empresa só, e o login não pergunta a empresa.
- **C. Quem cria empresas:** só a plataforma (PStarX). Não há cadastro aberto.
- **D. Limite de coletores por empresa:** por enquanto não. Se vier cobrança por coletor, entra uma coluna em `tenants`
  e uma conferência no cadastro do coletor.
- **E. App do kiosk:** o mesmo para todas, publicado pela plataforma.
