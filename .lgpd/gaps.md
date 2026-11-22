# Gap analysis — StarX Kiosk (L1, 2026-11-22; revisto para fornecedor por assinatura)

> **Leitura atual**: o usuário vende o StarX Kiosk por assinatura (MEI/ATPP, operador dos dados dos clientes). As ações de **engenharia** abaixo estão priorizadas em `roadmap-produto.md`. As ações **jurídicas/organizacionais** se dividem em **do fornecedor** (contratos com sub-operadores, acordo com o cliente, canal de privacidade, política própria) e **do cliente** (base legal, aviso aos colaboradores, Encarregado, RIPD; modelos em `kit-cliente/`). A matriz abaixo é o diagnóstico original, mantido como registro.

Base: `.lgpd/discovery.md`. Regime: controlador padrão (não ATPP).
Legenda: `OK (no código)` · `PARCIAL` · `GAP` · `VALIDAÇÃO EXTERNA NECESSÁRIA`.

## Matriz

| Dimensão | Status | Evidência observada | Tipo de pendência |
|---|---|---|---|
| Inventário de dados e cookies/SDKs | PARCIAL | Mapeado em `discovery.md`; não há `data-map.md` formal com finalidades e papéis | Técnica + Governança |
| Base legal por atividade (Arts. 7º/11) | GAP | Nenhuma base registrada. O monitoramento de produtividade e a localização exigem decisão (contrato de trabalho / legítimo interesse + LIA) | Jurídica + Governança |
| Encarregado (Res. 18/2024) | GAP | Sem identidade/contato publicados no painel, no app ou em site | Organizacional + Web |
| Transparência ao titular (Art. 9º) | GAP | Sem aviso aos colaboradores sobre leitura do SSW, bipagens, ritmo, localização e capturas de tela | Jurídica + Produto |
| Canais e endpoints DSAR (Arts. 18–19; 15 dias) | GAP | Sem exportação, correção ou eliminação por titular (colaborador = `ssw_user`; usuário do painel) | Técnica + Operacional |
| Ledger de consentimento | N/A provável | Consentimento é base fraca na relação de emprego; confirmar em L3 | Jurídica |
| Criptografia em trânsito | OK (no código) | HTTPS + lotes HMAC assinados (`server/src/ops.ts`) | — |
| Criptografia em repouso (volume/backups) | VALIDAÇÃO EXTERNA NECESSÁRIA | Disco da VPS não verificável; backups `.sql.gz` sem criptografia e no mesmo servidor | Infra |
| Trilha de auditoria íntegra e sem PII em claro | PARCIAL | `auth_events` existe, mas sem prazo, sem proteção append-only e com identificador/IP em claro | Técnica |
| Logs de aplicação | PARCIAL | Redação de `authorization`/`cookie` ok; IP e URL de toda requisição sem rotação configurada | Técnica / Infra |
| Retenção, bloqueio, backups e propagação (Arts. 15–16) | PARCIAL | Eventos 90 d, bipagens 365 d ok; cargas, `auth_events`, usuários do painel e logs sem prazo; prazos sem justificativa documentada | Técnica + Jurídica |
| Minimização na coleta (Art. 6º, III) | PARCIAL | Localização ligada por padrão, a cada 1 min, inclusive em segundo plano; IMEI/MAC/SSID coletados sempre | Técnica + Jurídica |
| Terceiros classificados + DPAs (Art. 39) | VALIDAÇÃO EXTERNA NECESSÁRIA | Vercel, Resend, Cloudflare, VPS, OpenFreeMap sem classificação nem contrato registrado no repo | Contratual / Jurídica |
| Transferência internacional (Arts. 33–36) | VALIDAÇÃO EXTERNA NECESSÁRIA | Vercel/Resend/Cloudflare provavelmente fora do Brasil (EUA: exige SCCs da Res. 19/2024) | Contratual + Infra |
| Runbook e registro de incidentes (Res. 15/2024) | GAP | Inexistente | Operacional + Governança |
| RIPD (Art. 38) | GAP | Monitoramento sistemático de empregados + localização: forte indicação de RIPD (decidir em L12) | Jurídica |
| ECA Digital / menores | N/A | B2B para colaboradores adultos; sem jovens aprendizes (confirmado em 2026-11-22) | — |

## P0 — Exposição imediata / regulatória alta

**Engenharia (repositório)**
1. **Aviso de privacidade no coletor e no painel**: tela ou link curto explicando o que é coletado (leitura do SSW, bipagens, ritmo, localização, capturas) e o contato do Encarregado. Depende do texto jurídico (L13).
2. **Exportação e eliminação por titular (mínimo viável de DSAR)**: no painel, gerar um relatório de tudo o que existe de um `ssw_user` (cargas, bipagens, eventos) e permitir anonimizar o usuário após o prazo legal. Para usuários do painel: excluir/anonimizar, não só desativar.

**Jurídico / organizacional (fora do repositório)**
3. **Designar e publicar o Encarregado** (Res. 18/2024): nome e contato em local de destaque. Hoje a razão social e o Encarregado são desconhecidos (ver `encarregado.md`).
3a. **Contrato com o provedor da VPS** (operador crítico, guarda todo o banco e os backups): identificar o provedor e verificar se há cláusulas de proteção de dados (ver `vendors/dpa-status.md`).
4. **Runbook de incidente** com o prazo de 3 dias úteis (Res. 15/2024, Art. 6º) e registro interno de 5 anos (Art. 10).
5. **Comunicar aos colaboradores** o monitoramento (política interna / aditivo / treinamento), antes ou junto com o aviso do item 1.

## P1 — Fundamentos e contratos

**Engenharia**
6. **Prazos de retenção para o que hoje é indefinido**:
   - `ops_operations` (cargas com `ssw_user`): definir prazo e anonimizar `ssw_user` depois dele;
   - `auth_events`: prazo (ex.: 6 meses a 1 ano, a definir com o jurídico);
   - usuários do painel desativados: anonimizar depois de um prazo;
   - logs Docker: rotação (`max-size`/`max-file` no `docker-compose.yml`).
7. **Minimização da localização**: avaliar desligar por padrão para perfis novos, reduzir frequência e precisão, ou limitar ao horário de trabalho. Mostrar no painel só quando necessário (decisão de produto + LIA).
8. **Backups**: criptografar (ex.: `age`/`gpg`) e copiar para fora da VPS com prazo definido.
9. **Mapa**: avaliar servir tiles próprios ou um proxy, para não expor a região do coletor e o IP do administrador ao OpenFreeMap (ou registrar isso como terceiro).

**Jurídico / organizacional**
10. **Base legal + LIA** por atividade (L3): monitoramento de produtividade, localização, capturas de tela, inventário do aparelho, segurança do painel.
11. **Operadores e transferência internacional** (L5 concluído no papel): confirmar o aceite dos DPAs de Vercel, Cloudflare e Resend e formalizar as Cláusulas-Padrão do Anexo II (Res. 19/2024) para os fluxos com os EUA; verificar a região da Resend (UE → Res. 32/2026). Ver `vendors/` e `transfers/`.
12. **Mapa de dados formal** (L2) e **ROPA** (L11).

## P2 — Maturidade

13. Trilha de auditoria append-only com encadeamento (hash chain) e prazo (`lgpd-audit-logging`).
14. Pseudonimizar `ssw_user` em relatórios agregados (`lgpd-anonymization`), se houver uso analítico.
15. Criptografia por coluna para IMEI/MAC e e-mail dos administradores (`lgpd-encryption-keys`), se o risco justificar.
16. RIPD formal do monitoramento (L12), com revisão periódica.
