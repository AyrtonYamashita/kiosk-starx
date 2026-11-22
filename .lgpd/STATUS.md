# LGPD Privacy Engineering Status

**Projeto**: StarX Kiosk (app Android Device Owner `com.pstarx.kiosk` + API Fastify/Postgres na VPS + painel Next.js na Vercel)
**Modelo de negócio**: **serviço por assinatura** para empresas de logística (nenhum cliente formalizado em 2026-11-22)
**Papéis**:
- **Operador** (Art. 39) dos dados dos colaboradores e usuários de cada cliente: papel principal;
- **Controlador** dos dados do próprio negócio (clientes, cobrança, segurança da plataforma).

**Cenário**: C (Híbrido): base em produção + funcionalidades novas
**Enquadramento**: **MEI → ATPP** (Res. CD/ANPD nº 2/2022), **com ressalva de alto risco** nas operações como operador (monitoramento individual de colaboradores). Por cautela, segue o regime padrão; decisão jurídica pendente.
**Início**: 2026-11-22 | **Última atualização**: 2026-11-22
**Canal / Encarregado**: **PENDENTE**. Canal obrigatório; Encarregado (serviço externo) recomendado ao fechar o primeiro cliente (`encarregado.md`)

## Escopo verificado vs. fora do repositório
- **Verificado no código**: migrations 001–013, rotas e rotinas de retenção da API, leitor do SSW, coleta do app (inventário, localização, capturas), cookies/SDKs do painel, `deploy/` (backups, logs), região das funções da Vercel
- **Fora do repositório**:
  - provedor/contrato da VPS;
  - aceite dos DPAs (Vercel, Cloudflare, Resend) e Cláusulas-Padrão;
  - região da Resend;
  - criptografia de disco da VPS;
  - contrato de assinatura;
  - enquadramento MEI para SaaS (contador).

## Mudança de enquadramento (2026-11-22)
As etapas L1–F12 foram feitas primeiro como se o usuário fosse a empresa que usa os coletores. Depois o usuário esclareceu que **vende o sistema por assinatura** e é **MEI**. Os artefatos foram reorganizados:
- **o que é dever do cliente** (bases legais, avaliações de legítimo interesse, Encarregado do cliente, aviso aos colaboradores) foi para `kit-cliente/` como **modelos**;
- **o que é dever do fornecedor** ficou na raiz (ROPA como operador, acordo com o cliente, sub-operadores, segurança, retenção, incidentes);
- **as lacunas técnicas** viraram o plano de produto (`roadmap-produto.md`).

## Pipeline
- [x] L0: setup e enquadramento (revisto para fornecedor MEI/ATPP)
- [x] L1: discovery + gaps ⏸ (aprovado)
- [x] L2: mapa de dados (`data-map.md`: 9 atividades = o serviço prestado ao cliente)
- [x] L3: bases legais → **modelo para o cliente** (`kit-cliente/bases-legais-modelo.md`, `kit-cliente/lia-modelos/`)
- [x] L4: canal/Encarregado do fornecedor (`encarregado.md`); orientação ao cliente (`kit-cliente/encarregado-orientacao.md`)
- [x] L5: sub-operadores, transferências e acordo com o cliente (`vendors/`, `transfers/`)
- [x] F5: consentimento: não se aplica
- [x] F6: menores/ECA Digital: não se aplica nos usos atuais (o cliente declara se houver aprendizes)
- [x] F7–F11: criptografia, trilha, retenção, direitos dos titulares, incidentes (documentados)
- [x] F12: ROPA v0.9 reescrito como fornecedor (`ROPA.md`) ⏸ aguardando revisão
- [x] F13: RIPD: **modelo para o cliente** (`RIPD/ripd-monitoramento-colaboradores.md`) ⏸ parecer do Encarregado do cliente
- [x] F14: política de privacidade do fornecedor: minuta `policies/privacy-policy-v1-draft.md` ⏸ revisão jurídica
- [ ] F15: relatório final

## Artefatos
- Fornecedor: `ROPA.md`, `encarregado.md`, `roadmap-produto.md`, `vendors/` (`dpa-cliente.md`, `sub-operadores.md`, `audit-2026-11-22.md`, `dpa-status.md`, `dpa-template.md`), `transfers/`, `security/`, `retention.md`, `dsar/`, `incidents/`
- Base técnica: `discovery.md`, `data-map.md`, `gaps.md`
- Cliente: `kit-cliente/` (README, bases legais, 4 avaliações de legítimo interesse, aviso aos colaboradores, orientação de Encarregado)

## Próximo passo
⏸ Revisão jurídica da minuta de política; depois F15 (relatório final). Em paralelo, a Fase 1 do `roadmap-produto.md` (código, com aprovação item a item).

## F13 — RIPD ✓ (modelo)
- 1 RIPD (monitoramento de colaboradores, A001–A005): alto risco provável (geral II + específico III, a confirmar), exigível pela ANPD por ser legítimo interesse
- 8 riscos mapeados: 7 com risco residual baixo após o roadmap, 1 médio (uso disciplinar dos indicadores, depende do cliente)
- ⏸ Aprovação: Encarregado do cliente (pendente; é documento do controlador)

## F14 — Política de privacidade ✓ (minuta)
- Minuta em `.lgpd/policies/privacy-policy-v1-draft.md`, alinhada ao ROPA (controlador §I + papel de operador §II)
- 8 divergências com o sistema atual listadas no fim da minuta (prazos, backups, Cláusulas-Padrão, canal, página pública)
- ⏸ Aguardando revisão jurídica antes de publicar
