# Registro de Operações de Tratamento (ROPA — Art. 37 LGPD) — fornecedor do StarX Kiosk

**Agente de Tratamento**: `PENDENTE (razão social do MEI)` | **CNPJ**: `PENDENTE` | **Enquadramento**: ATPP (MEI, Res. CD/ANPD nº 2/2022), **com ressalva de alto risco** nas operações como operador (ver `encarregado.md`)
**Canal de privacidade / Encarregado**: `PENDENTE` (canal obrigatório; ver `encarregado.md`)
**Modelo**: completo, por cautela (o simplificado do Art. 9º da Res. 2/2022 vale só se não houver alto risco)
**Versão**: v0.9 (minuta) | **Data**: 2026-11-22 | **Próxima revisão**: ao fechar o primeiro cliente ou em 2027-05-22

## Histórico
- `v0.9` (2026-11-22): reescrito para o papel de **fornecedor por assinatura** (antes estava como se fosse a empresa que usa os coletores)

## Elementos comuns
- **Sub-operadores**: ver `vendors/sub-operadores.md` (VPS, Vercel, Cloudflare, Resend).
- **Segurança (Art. 46)**: ver `security/encryption.md` e `security/audit-logging.md`; pendências em `roadmap-produto.md`.
- **Decisão unicamente automatizada**: não há. **Menores / dados sensíveis**: não há nos clientes atuais (o cliente deve informar se houver jovens aprendizes).

---

## I. Operações como Controlador (dados do próprio negócio)

| ID | Operação | Finalidade | Hipótese legal | Titulares | Dados | Retenção |
|---|---|---|---|---|---|---|
| C001 | Contratação e relacionamento com clientes | vender, cobrar e dar suporte à assinatura | Art. 7º, V (contrato) | representantes e contatos dos clientes | nome, e-mail, telefone, cargo, empresa | durante o contrato; depois, o necessário para defesa/cobrança (Art. 7º, VI) |
| C002 | Faturamento e obrigações fiscais | emitir notas e cumprir a legislação tributária | Art. 7º, II (obrigação legal) | representantes dos clientes | dados de faturamento | 5 anos (CTN, Art. 173, I e 195, parágrafo único), contados do 1º dia do exercício seguinte |
| C003 | Segurança e auditoria da própria plataforma | proteger o serviço (logs, tentativas de acesso, backups) | Art. 7º, IX (legítimo interesse; LIA em `kit-cliente/lia-modelos/seguranca-gestao.md`, adaptar) | usuários do painel, IPs | IP, navegador, eventos | ver `retention.md` |

*C001/C002 não estão no repositório (contrato, cobrança, e-mail comercial): **validação externa**.*

---

## II. Operações como Operador (em nome de cada cliente)

### O001 — Serviço StarX Kiosk (gestão de coletores e acompanhamento da operação)

| Campo | Descrição |
|---|---|
| **Controladores atendidos** | empresas clientes da assinatura (hoje: nenhuma formalizada) |
| **Instrumento contratual (Art. 39)** | Acordo de Tratamento de Dados com cada cliente: `vendors/dpa-cliente.md` (minuta) |
| **Operações executadas sob instrução** | as atividades A001–A009 de `data-map.md`: leitura da tela do SSW e acompanhamento ao vivo, indicadores e histórico de cargas, bipagens, localização dos coletores, capturas de tela, gestão dos aparelhos (MDM), autenticação do painel, trilha de ações, logs e backups |
| **Titulares** | colaboradores do cliente (operadores de coletor) e usuários do painel do cliente |
| **Categorias de dados** | conforme `data-map.md`: usuário do SSW, dados de carga e bipagens, indicadores de produtividade, última localização, capturas de tela, IMEI/serial/MAC/SSID/IPs, contas do painel |
| **Base legal** | definida **pelo cliente** (controlador); modelo proposto: legítimo interesse (`kit-cliente/bases-legais-modelo.md`) |
| **Sub-operadores** | `vendors/sub-operadores.md` |
| **Transferência internacional** | Vercel, Cloudflare, Resend → Cláusulas-Padrão da Res. 19/2024 (Anexo II), **pendentes** (`transfers/`) |
| **Medidas de segurança** | `security/`; separação entre clientes **pendente** (multiempresa) |
| **Retenção** | prazos padrão configuráveis por cliente (`retention.md`) |
| **Devolução / eliminação no encerramento** | exportação dos dados do cliente e eliminação em até 30 dias após o fim do contrato (proposta; backups expiram em 14 d) |
| **Alto risco** | provável (monitoramento individual de empregados); o RIPD é do cliente, com modelo e apoio do fornecedor |

---

## III. Resumo
- Como Controlador: 3 operações (próprio negócio) | Como Operador: 1 serviço (O001 = A001–A009)
- Legítimo interesse: C003 (próprio) e o modelo sugerido aos clientes para O001
- Menores: 0 | Sensíveis: 0
- Transferências internacionais: 3 sub-operadores, a formalizar
