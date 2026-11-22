# Plano de produto LGPD — StarX Kiosk como serviço por assinatura

**Data**: 2026-11-22. Cada item é para aprovação antes de codar (entregas pequenas e testáveis). A coluna "Quem precisa" mostra se é obrigação **sua** (operador/fornecedor) ou um recurso para o **cliente** cumprir a parte dele.

## Fase 1 — Antes do primeiro cliente (bloqueia a venda)

| # | Item | Quem precisa | Por quê | Esforço |
|---|---|---|---|---|
| R1 | **Backups cifrados + cópia fora da VPS** | você (Art. 46; cláusulas 5 e 9 do acordo) | o backup é o banco inteiro, hoje em claro no mesmo servidor | P |
| R2 | **Rotação dos logs da API** (`docker-compose.yml`) | você | logs sem limite com IP de todos | P |
| R3 | **Página pública `/privacidade`** no painel (política do fornecedor + canal) e link no login | você (canal obrigatório da ATPP) | sem ela não há canal publicado | P |
| R4 | **Aviso de privacidade no coletor** (primeira vez e em Configurações), com texto definido pelo cliente | cliente (Art. 9º) | sem transparência, o legítimo interesse do cliente não se sustenta | M |
| R5 | **Localização desligada por padrão** nos perfis novos | cliente (minimização; LIA de localização) | o desenho atual reprova no balanceamento | P |
| R6 | **Prazos de guarda automáticos**: anonimizar `ssw_user` em cargas com mais de 365 d; capturas 7 d; comandos 180 d; trilha de login 1 ano (conta inexistente 30 d); usuários desativados anonimizados em 1 ano | ambos | hoje há dados sem prazo | M |
| R7 | **Exportar e anonimizar por colaborador** (tela "Privacidade" no painel, só admin) + "baixar meus dados" em Conta | cliente (Art. 18), com o operador ajudando (cláusula 7) | é como o cliente atende os colaboradores | M |

> **R4 adiado (2026-11-22)**: implementado e testado no emulador (app 0.5.4, commit 9d1b29c), mas o usuário não aprovou o aviso no coletor por enquanto e o commit foi revertido (aadab1c) sem publicar. Para retomar: `git revert aadab1c`. Enquanto isso, a transparência ao colaborador fica no aviso formal do cliente (`kit-cliente/aviso-colaboradores-modelo.md`).

## Fase 2 — Para vender a mais de um cliente

| # | Item | Quem precisa | Por quê | Esforço |
|---|---|---|---|---|
| R8 | **Multiempresa** (`docs/multiempresa.md`): cada cliente vê só os próprios dados; usuários, coletores, cargas e configurações por empresa | você (segurança; cláusulas 4 e 5) | com dois clientes na mesma base, isolamento é obrigatório | G |
| R9 | **Exportação completa e eliminação de um cliente** (fim de contrato) | você (cláusula 9) | devolução e eliminação em 30 dias | M |
| R10 | **Prazos configuráveis por cliente** (no painel, dentro de limites) | cliente | as instruções do controlador viram configuração | M |
| R11 | **Registro de consultas** a dados de colaboradores (histórico de cargas, consulta por código, exportações) | ambos | quem vê os indicadores individuais | P |

## Fase 3 — Maturidade

| # | Item | Por quê |
|---|---|---|
| R12 | Aviso no coletor ao tirar captura de tela | transparência da LIA de capturas |
| R13 | Indicadores individuais visíveis só a perfis autorizados | minimização de acesso |
| R14 | Mapa sem terceiro (tiles próprios ou proxy) | a OpenFreeMap deixa de ver a região e o IP |
| R15 | HSTS, chave própria do TOTP, trilha à prova de alteração | defesa em profundidade |

**Esforço**: P = horas, M = 1 a 2 dias, G = semanas.

## Fora do código (você)
- **Contratos com sub-operadores**: identificar o provedor da VPS e o contrato; aceitar os DPAs de Vercel, Cloudflare e Resend; formalizar as Cláusulas-Padrão (Anexo II da Res. 19/2024) com os de fora do Brasil; verificar a região da Resend.
- **Documentos de venda**: contrato de assinatura + `vendors/dpa-cliente.md` + `vendors/sub-operadores.md` + kit (`kit-cliente/`), todos revisados por advogado.
- **Canal de privacidade** e, com o primeiro cliente, Encarregado como serviço externo (`encarregado.md`).
- **Contador**: confirmar que o MEI comporta a atividade de SaaS e o faturamento das assinaturas.
