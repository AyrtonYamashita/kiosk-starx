# Lista de sub-operadores do StarX Kiosk

Documento para entregar ao cliente (anexo do Acordo de Tratamento de Dados). **Atualizado**: 2026-11-22. Avisar os clientes antes de incluir ou trocar sub-operador (cláusula de sub-operadores do `dpa-cliente.md`).

| Sub-operador | Serviço | Dados tratados | Local do processamento | Garantia para transferência internacional | Situação |
|---|---|---|---|---|---|
| Provedor da VPS (**a identificar**) | hospedagem da API, banco e backups | todos os dados do serviço | provável Brasil (**a confirmar**) | não se aplica se 100% no Brasil | contrato de hospedagem a verificar |
| Vercel Inc. | hospedagem do painel web | dados exibidos no painel, sessões | funções em São Paulo (gru1); empresa e suporte nos EUA | Cláusulas-Padrão Res. CD/ANPD nº 19/2024 (Anexo II) | a formalizar |
| Cloudflare, Inc. | proxy, DNS e HTTPS da API | tráfego da API (eventos, check-ins, IPs) | rede global | Cláusulas-Padrão (Anexo II) | a formalizar |
| Resend | e-mail do código de login (2FA) | e-mail e usuário do painel | região a verificar | Anexo II se EUA; Art. 33, I (Res. 32/2026) se UE | a formalizar |

**Não são sub-operadores** (informar por transparência): OpenFreeMap. O navegador de quem usa o painel baixa dele as imagens do mapa da região do coletor (o serviço vê a região e o IP de quem consulta). Substituível por mapa próprio (`roadmap-produto.md`).
