# Direitos dos titulares — fluxo operacional (F10, 2026-11-22)

**Regime**: controlador padrão (Art. 19 LGPD): **confirmação/acesso simplificado imediato**; **declaração completa em até 15 dias corridos**; correção/eliminação sem demora injustificada (meta ≤ 15 dias; comunicar impossibilidade, Art. 18, § 4º). Não há consentimento, então não há revogação (Art. 18, IX).

## Quem pede e por onde

| Titular | Acessa o sistema? | Canal | Verificação de identidade (proporcional, Art. 6º, III) |
|---|---|---|---|
| **Colaborador** (operador de coletor, identificado pelo `ssw_user`) | **não** (só o coletor) | canal do Encarregado (`encarregado.md`, **pendente**); RH/gestor também recebem e **encaminham no mesmo dia** | pelos registros que a empresa já tem (matrícula, RH). **Nunca** pedir documento/selfie que o sistema não tinha |
| **Ex-colaborador** | não | mesmo canal | idem, pelos registros de RH |
| **Usuário do painel** | sim | menu Conta (self-service a implementar) ou canal do Encarregado | sessão autenticada + 2FA |

**Canais informais**: pedido feito ao gestor, no RH, no WhatsApp da empresa etc. **vale**. O prazo corre da data em que a empresa recebeu. Treinar gestores e RH para registrar e encaminhar ao Encarregado.

## Direitos e como atender (estado atual → proposta)

| Direito | Colaborador | Usuário do painel |
|---|---|---|
| Confirmação (Art. 18, I) | **hoje: manual** (consulta ao banco). Proposta: relatório por `ssw_user` no painel | proposta: tela em Conta |
| Acesso / declaração completa (II; Art. 19, II) | proposta: **exportação por `ssw_user`** (cargas, bipagens, períodos, finalidades, origem, destinatários) em PDF/JSON | proposta: exportação em Conta (perfil, sessões, eventos de login, fatores sem segredos) |
| Correção (III) | o usuário do SSW vem do SSW: corrigir na origem; registros de carga errados podem ser anotados/contestados | e-mail e usuário: pelo administrador (já existe) |
| Anonimização/bloqueio/eliminação de excesso (IV) | anonimizar `ssw_user` (ver `retention.md` §2), salvo bloqueio jurídico | anonimizar a conta |
| Portabilidade (V) | JSON/CSV da exportação | JSON da exportação |
| Eliminação (VI) | idem IV (a base é legítimo interesse; avaliar oposição, Art. 18, § 2º) | idem |
| Informação sobre compartilhamento (VII) | política/aviso (L13): VPS, Vercel, Cloudflare, Resend | idem |
| Oposição (§ 2º) | análise caso a caso pelo Encarregado contra a LIA | idem |
| Revisão de decisão automatizada (Art. 20) | **não há** decisão unicamente automatizada. Manter assim: indicadores não decidem punição/avaliação sozinhos | — |

## Cuidados no atendimento ao colaborador
- **Dados de terceiros**: a exportação de um colaborador **não** deve trazer o usuário de outros colegas. Em cargas trocadas, mostrar só os registros vinculados ao `ssw_user` dele.
- **Capturas de tela**: não estão ligadas a `ssw_user`. Informar que existem (prazo de 7 dias proposto) e entregar as do período, se pedido, revisando a imagem para dados de terceiros.
- **Pedido de eliminação durante o contrato de trabalho**: o monitoramento operacional se baseia em legítimo interesse. A oposição é analisada contra a LIA. Recusa parcial precisa de fundamento escrito (Art. 18, § 4º).

## Registro do atendimento
Registrar recebimento, verificação, entrega e recusa (com fundamento) sem copiar o conteúdo entregue. Guardar **3 a 5 anos** (Art. 6º, X e Art. 7º, VI; janela de reincidência da Res. CD/ANPD nº 4/2023). **Não** usar o Art. 10 da Res. 15/2024 (esse é para incidentes).
