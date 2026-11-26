# Mapa de Dados Pessoais — StarX Kiosk

**Versão**: v1 | **Status**: Preliminar com bases propostas (L3) — pendente validação jurídica | **Data**: 2026-11-22
**Responsável técnico / Encarregado**: Encarregado pendente (L4)
**Fonte**: `.lgpd/discovery.md` (código) + contagens agregadas de produção em 2026-11-22 (sem dados pessoais): 15 coletores, 11 usuários do SSW distintos, 68 cargas desde 18/11/2026, 4.440 bipagens, 1 usuário do painel, 14 coletores com localização.

**Papéis**: cada **cliente** do StarX Kiosk (empresa que usa os coletores) é o **controlador** destas atividades; o **fornecedor** (MEI que vende a assinatura) é o **operador** (Art. 39). Este mapa descreve o serviço prestado; ver `ROPA.md` §II.

## 1. Atividades de tratamento

### A001 — Acompanhamento das operações de descarga (leitura do SSW)

| Campo | Valor |
|---|---|
| Slug | `a001-acompanhamento-operacoes` |
| Finalidade (Art. 6º, I) | Acompanhar em tempo real as descargas (função, placa, volumes lidos/faltantes, valor) e quem está em cada coletor, para coordenar a operação do armazém |
| Base legal | Art. 7º, IX ([LIA](./kit-cliente/lia-modelos/monitoramento-operacional.md)) — proposta, validar |
| Titulares | colaboradores operadores de coletor (adultos; **sem jovens aprendizes**, confirmado pelo usuário em 2026-11-22) |
| Dados comuns | usuário do SSW, domínio, filial, tela atual, função, placa, unidades, volumes/peso/valor, horários de início e fim, motivo do encerramento, sinal de vida |
| Dados sensíveis | Não |
| Origem | observado: leitura da tela do SSW pelo app (`server/reader/ssw_reader.js`) |
| Sistemas | `ops_device_state`, `ops_operations`, `ops_events` (Postgres na VPS); SSE ao vivo para o painel |
| Terceiros e papel | VPS (**operador**), Cloudflare (**operador**, trânsito), Vercel (**operador**, painel) |
| Transferência internacional | provável (Cloudflare, Vercel) — L5 |
| Retenção | eventos brutos 90 d; sinal de vida 7 d; estado atual sobrescrito; cargas: **sem prazo** (gap) |
| Controles | leitura passiva, sem senha; chave geral/por coletor; lotes assinados HMAC; acesso só autenticado (2FA) |
| Alto risco? | **RIPD preventivo recomendado (forte)**: monitoramento contínuo e individualizado de empregados (ver §3) |

### A002 — Indicadores individuais de produtividade e histórico de cargas

| Campo | Valor |
|---|---|
| Slug | `a002-produtividade-historico` |
| Finalidade | Medir o andamento de cada carga e o desempenho por colaborador (ritmo s/volume, tempo na função no dia, previsão de término) e manter o histórico consultável por placa e colaborador (tela Cargas) |
| Base legal | Art. 7º, IX reforçado ([LIA](./kit-cliente/lia-modelos/monitoramento-operacional.md)) — proposta, validar |
| Titulares | colaboradores |
| Dados comuns | usuário do SSW associado a métricas, intervalos entre bipagens, curva de bipagens, motivo do encerramento ("saiu sem concluir", "perdeu o sinal") |
| Dados sensíveis | Não |
| Origem | **inferido**: calculado pela API a partir de A001/A003 |
| Sistemas | `ops_operations` (`scan_interval_*`, `scan_curve`), rotas `/v1/admin/ops/*` |
| Terceiros e papel | VPS, Vercel, Cloudflare (**operadores**) |
| Transferência internacional | provável — L5 |
| Retenção | **sem prazo** (gap P1) |
| Controles | acesso autenticado; sem decisão automatizada (ninguém é punido pelo sistema) |
| Alto risco? | **RIPD preventivo recomendado (forte)**: definição de perfil de desempenho individual |

### A003 — Registro de bipagens e consulta por código de barras

| Campo | Valor |
|---|---|
| Slug | `a003-bipagens` |
| Finalidade | Rastrear qual volume foi bipado, em que carga, coletor e hora, por quem (para resolver divergências de carga) |
| Base legal | Art. 7º, IX (+ VI em disputas) ([LIA](./kit-cliente/lia-modelos/monitoramento-operacional.md)) — proposta |
| Titulares | colaboradores (via carga → `ssw_user`) |
| Dados comuns | código de barras do volume, horário, classificação (lido/outra/erro/não contou), mensagem de erro que o SSW mostrou ao recusar o código (ex.: "CTRC 4711 já foi lido"), vínculo com carga e colaborador |
| Dados sensíveis | Não (o código identifica o volume; não foi verificado se codifica dados do destinatário: **validação externa**). A mensagem de erro é texto do SSW sobre o volume/CTRC; não foi verificado se alguma mensagem traz dado de pessoa: **validação externa** |
| Origem | observado (leitura da tela) |
| Sistemas | `ops_scans` (`error`, `error_key`); rotas `/v1/admin/ops/scans` e `/v1/admin/ops/scan-errors`; notificação `scan_error`. Captura da tela com o alerta de erro grave (`ops_scan_shots`, JPEG: mostra o usuário logado, a placa, a hora, a mensagem — que pode trazer o usuário de outra carga — e o fundo da tela do SSW); apagada em 90 d (`OPS_RETENTION_DAYS`) e no pedido de anonimização do colaborador da carga |
| Terceiros e papel | VPS, Vercel, Cloudflare (**operadores**) |
| Retenção | 365 d (`OPS_SCAN_RETENTION_DAYS`) — justificar em L3/retenção |
| Alto risco? | integra A001/A002 no RIPD |

### A004 — Localização dos coletores

| Campo | Valor |
|---|---|
| Slug | `a004-localizacao` |
| Finalidade | Localizar coletores (perda, furto, conferência de qual pátio/filial) |
| Base legal | Art. 7º, IX condicionada à minimização ([LIA](./kit-cliente/lia-modelos/localizacao-coletores.md)) — proposta |
| Titulares | colaboradores que portam o coletor |
| Dados comuns | latitude, longitude, precisão, horário da última posição |
| Dados sensíveis | Não |
| Origem | observado: GPS/rede a cada 1 min ou 10 m, **inclusive em segundo plano**, ligado por padrão (`LocationTracker.kt`, `KioskConfig.kt:127`) |
| Sistemas | `devices.info.location` (só a última posição); mapa do painel |
| Terceiros e papel | **OpenFreeMap**: recebe do navegador do administrador as requisições de tiles da região (+ IP do administrador): **terceiro independente** (serviço público de tiles, sem contrato); VPS, Vercel, Cloudflare (**operadores**) |
| Transferência internacional | OpenFreeMap e Vercel: validar — L5 |
| Retenção | sobrescrita a cada posição; some com a remoção do aparelho |
| Alto risco? | integra o RIPD (localização de empregado) |

### A005 — Capturas de tela remotas

| Campo | Valor |
|---|---|
| Slug | `a005-capturas-tela` |
| Finalidade | Suporte remoto: ver o que está na tela do coletor quando há problema |
| Base legal | Art. 7º, IX com salvaguardas ([LIA](./kit-cliente/lia-modelos/capturas-tela.md)) — proposta |
| Titulares | colaboradores (e terceiros cujos dados estejam na tela do SSW) |
| Dados | imagem JPEG da tela (pode conter qualquer dado exibido) |
| Dados sensíveis | Não esperados, mas **possíveis** (conteúdo arbitrário da tela) |
| Origem | observado, sob comando de administrador |
| Sistemas | `screenshots` (bytea, até 10 por aparelho) |
| Terceiros | VPS, Cloudflare, Vercel (**operadores**) |
| Retenção | últimas 10 por aparelho, sem prazo em dias (gap) |
| Alto risco? | integra o RIPD; sugerir aviso visível no coletor no momento da captura |

### A006 — Gestão dos aparelhos (MDM)

| Campo | Valor |
|---|---|
| Slug | `a006-gestao-aparelhos` |
| Finalidade | Cadastrar, configurar e manter os coletores (modo kiosk, apps, atualizações, comandos remotos, estado da bateria/rede) |
| Base legal | Art. 7º, IX ([LIA](./kit-cliente/lia-modelos/seguranca-gestao.md)) |
| Titulares | indiretamente o colaborador (aparelho atribuído); sem vínculo direto no banco |
| Dados | IMEI, serial, MAC Wi-Fi, SSID, IPs locais e público, apps instalados, bateria, configuração, comandos enviados |
| Dados sensíveis | Não |
| Origem | observado (check-in do app) |
| Sistemas | `devices`, `commands`, `enrollment_codes`, `profiles`, `apps`, `app_versions` |
| Terceiros | VPS, Cloudflare, Vercel (**operadores**) |
| Retenção | enquanto o aparelho estiver cadastrado |
| Alto risco? | Não isoladamente |

### A007 — Autenticação e segurança do painel

| Campo | Valor |
|---|---|
| Slug | `a007-autenticacao-painel` |
| Finalidade | Controlar o acesso ao painel e proteger as contas (senha, 2FA, bloqueio de tentativas, trilha de acesso) |
| Base legal | Art. 7º, IX + Art. 46 ([LIA](./kit-cliente/lia-modelos/seguranca-gestao.md)) |
| Titulares | usuários do painel (administradores/operadores) e quem tentar entrar |
| Dados | usuário, e-mail, hash de senha, segredos TOTP/passkey/recuperação (hash/HMAC), sessões com IP e navegador, navegadores confiáveis, **identificador digitado em tentativas**, IP e navegador em `auth_events` |
| Dados sensíveis | Não (passkey não guarda biometria; a biometria fica no aparelho do usuário) |
| Origem | fornecido + observado |
| Sistemas | `admins`, `sessions`, `email_otps`, `recovery_codes`, `trusted_devices`, `admin_totp`, `webauthn_*`, `auth_events`, `auth_lockouts` |
| Terceiros e papel | **Resend** (**operador**, envia o código por e-mail), Vercel, Cloudflare, VPS (**operadores**) |
| Transferência internacional | Resend/Vercel provável EUA — L5 |
| Retenção | sessões e OTP expiram; `auth_events` **sem prazo**; usuários desativados **nunca excluídos** (gaps) |
| Alto risco? | Não |

### A008 — Registro de ações administrativas

| Campo | Valor |
|---|---|
| Slug | `a008-auditoria-admin` |
| Finalidade | Responsabilização: quem fez o quê no painel (comandos, configurações, usuários) |
| Base legal | Art. 7º, IX (+ VI) ([LIA](./kit-cliente/lia-modelos/seguranca-gestao.md)) |
| Titulares | usuários do painel |
| Dados | id do usuário, evento, IP, navegador, detalhes |
| Sistemas | `auth_events` (mesma tabela de A007) |
| Retenção | **sem prazo** (gap) |
| Alto risco? | Não |

### A009 — Logs técnicos e backups

| Campo | Valor |
|---|---|
| Slug | `a009-logs-backups` |
| Finalidade | Operação, diagnóstico de falhas e recuperação de desastre |
| Base legal | Art. 7º, IX + Art. 46 ([LIA](./kit-cliente/lia-modelos/seguranca-gestao.md)) |
| Titulares | todos os anteriores |
| Dados | logs da API (URL, IP, horário de cada requisição; sem cabeçalhos de autenticação); cópia integral do banco |
| Sistemas | stdout Docker da API; `deploy/backups/*.sql.gz` |
| Terceiros | provedor da VPS (**operador**) |
| Retenção | backups 14 dias (mesmo servidor, sem criptografia); logs **sem limite** (gap) |
| Alto risco? | Não isoladamente; risco de segurança se a VPS for comprometida |

### Nota — Encerramento por inatividade no coletor
Lógica só local (timer no app). Não guarda nem envia dado novo. Não é atividade de tratamento autônoma.

## 2. Inventário de cookies, armazenamento local e terceiros no navegador

| Nome / Identificador | Tipo | Finalidade | Papel do terceiro | Estritamente necessário? | Bloqueado antes do consentimento? |
|---|---|---|---|---|---|
| cookie de sessão do painel (`SESSION_COOKIE`, `web/src/lib/actions.ts`) | cookie httpOnly | sessão autenticada | próprio | Sim | N/A |
| cookie de etapa MFA (`MFA_COOKIE`) | cookie httpOnly | concluir o 2º fator | próprio | Sim | N/A |
| cookie de navegador confiável | cookie httpOnly | pular o 2º fator por 30 dias (opcional, escolhido pelo usuário) | próprio | Sim (funcionalidade pedida) | N/A |
| `theme` (next-themes) | localStorage | lembrar claro/escuro | próprio | Sim (preferência) | N/A |
| tiles OpenFreeMap | requisição a terceiro | desenhar o mapa | terceiro independente | Sim para o mapa | N/A (sem cookie; revela região + IP) |
| Analytics / pixels / replay / APM | — | **nenhum encontrado** | — | — | — |

**App Android**: sem SDKs de terceiros de analytics ou anúncios; sem GAID/IDFA. Armazenamento local: fila de eventos do SSW em disco (`OpsQueue`), token do aparelho, configuração.

## 3. Triagem de alto risco

- **Regime**: controlador padrão. O teste da Res. 2/2022, Art. 4º serve como parâmetro objetivo de risco, não como dispensa.
- **A001 + A002 + A003 + A004 + A005 (monitoramento de colaboradores)**:
  - **Critério geral, impacto significativo em direitos**: **provável sim**. É monitoramento contínuo e individualizado no trabalho (produtividade, localização, capturas de tela), com potencial de uso em avaliação e disciplina.
  - **Critério geral, larga escala**: **não** pelo volume atual (11 titulares, 15 aparelhos). Reavaliar se o uso crescer (multiempresa).
  - **Critério específico, decisão unicamente automatizada / definição de perfis**: há **definição de perfil de desempenho** (ritmo, tempo na função). Não há decisão automatizada. Enquadramento **a confirmar** no RIPD.
  - **Critério específico, adolescentes**: **não** (sem jovens aprendizes, confirmado em 2026-11-22).
  - **Conclusão**: **RIPD recomendado** (L12), tratando as cinco atividades em conjunto. Ele passa a ser exigível se a ANPD pedir (Art. 38) ou se a base adotada for legítimo interesse (Art. 10, § 3º).
- **A006–A009**: sem indicação de alto risco isoladamente.

## Checklist de qualidade
- [x] Todas as tabelas com dados pessoais vinculadas a uma atividade (`admins`…`webauthn_*` → A007/A008; `devices`/`commands` → A006/A004; `screenshots` → A005; `ops_*` → A001–A003)
- [x] Cookies, armazenamento local, SDKs e logs inventariados
- [x] Cada terceiro com papel explícito (a confirmar contratualmente em L5)
- [x] Menores: não há (sem jovens aprendizes nos coletores, confirmado em 2026-11-22)
- [x] Alto risco avaliado pelo teste cumulativo, sem atalho numérico
