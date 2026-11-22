# Política de Privacidade — StarX Kiosk

> **Minuta v1 (2026-11-22). Não publicar antes da revisão jurídica.** Página prevista: `/privacidade` (pública, sem login). Campos `{}` a preencher. Ao final, as divergências entre o texto e o sistema atual.

**Versão 1.0** · vigente desde `{data de publicação}`

## 1. Quem somos
O StarX Kiosk é um serviço por assinatura para empresas de logística. Ele gerencia coletores de dados (modo quiosque, apps e atualizações) e permite acompanhar a operação de descarga em tempo real. É fornecido por **`{razão social}`**, CNPJ **`{nº}`**, `{endereço}` ("nós").

## 2. Dois papéis diferentes
- **Como controlador**: tratamos os dados do nosso próprio negócio, como os contatos das empresas que contratam o serviço, a cobrança e a segurança da plataforma. As seções 3 a 9 tratam disso.
- **Como operador**: tratamos os dados que **cada empresa cliente** coloca no StarX Kiosk (dados dos colaboradores que usam os coletores e dos usuários do painel) **em nome dela e segundo as instruções dela**. Nesses casos, a empresa cliente é a controladora e decide para que os dados são usados. A seção 10 explica.

## 3. Dados que tratamos como controlador, para quê e com qual base legal

| Para quê | Dados | Base legal (LGPD) | Por quanto tempo |
|---|---|---|---|
| Contratar, cobrar e dar suporte à assinatura | nome, e-mail, telefone, cargo e empresa dos representantes e contatos dos clientes | execução de contrato (Art. 7º, V) | durante o contrato; depois, o necessário para cobrança ou defesa de direitos (Art. 7º, VI) |
| Emitir notas fiscais e cumprir obrigações tributárias | dados de faturamento | obrigação legal (Art. 7º, II) | 5 anos, contados do 1º dia do ano seguinte (CTN, Arts. 173 e 195) |
| Proteger a plataforma (tentativas de acesso, registros técnicos, cópias de segurança) | endereço IP, navegador, data e hora, eventos de acesso | legítimo interesse em segurança (Art. 7º, IX) | registros de acesso até 1 ano; registros técnicos até 30 dias; cópias de segurança até 14 dias |

Não tratamos dados sensíveis e não vendemos dados pessoais.

## 4. Com quem compartilhamos
Usamos fornecedores que tratam dados em nosso nome (operadores), apenas para prestar o serviço:

| Fornecedor | Para quê | Onde |
|---|---|---|
| `{provedor do servidor}` | hospedagem do sistema e das cópias de segurança | `{Brasil}` |
| Vercel Inc. | hospedagem do painel web | processamento em São Paulo; empresa nos EUA |
| Cloudflare, Inc. | proteção e entrega das conexões | rede global |
| Resend | envio do código de acesso por e-mail | `{região}` |

Quem usa o painel também carrega imagens de mapa da **OpenFreeMap**, serviço público que recebe a região consultada e o endereço IP de quem consulta.

Também podemos compartilhar dados quando a lei ou uma autoridade exigir.

## 5. Transferência para outros países
Alguns fornecedores processam ou acessam dados fora do Brasil, principalmente nos **EUA**. Nesses casos usamos as **Cláusulas-Padrão Contratuais aprovadas pela ANPD (Resolução CD/ANPD nº 19/2024)**. Para a União Europeia e o EEE, vale a decisão de adequação da ANPD (Resolução CD/ANPD nº 32/2026). `{Ajustar conforme a formalização com cada fornecedor.}`

## 6. Cookies
O painel usa **apenas cookies estritamente necessários**: o de sessão (mantém você conectado), o da etapa de verificação em duas etapas e, se você escolher, o de "confiar neste navegador" por 30 dias. A preferência de tema claro/escuro fica no seu navegador. **Não usamos** cookies de publicidade, analytics ou rastreamento.

## 7. Segurança
Usamos conexões cifradas (HTTPS), senhas protegidas com Argon2id, códigos e tokens guardados apenas em forma irreversível, verificação em duas etapas no painel, bloqueio de tentativas repetidas, controle de acesso por perfil e registro das ações administrativas. `{Acrescentar "cópias de segurança cifradas" quando implementado.}`

## 8. Seus direitos
Pelo Art. 18 da LGPD você pode pedir, de graça:
- confirmação de que tratamos seus dados;
- acesso e cópia;
- correção;
- anonimização, bloqueio ou eliminação do que for desnecessário;
- portabilidade;
- informação sobre com quem compartilhamos;
- eliminação, quando cabível;
- oposição, quando o tratamento descumprir a lei.

**Prazos**: a confirmação simplificada sai na hora; a resposta completa, em até **15 dias**. Se não pudermos atender, explicaremos o motivo.

## 9. Contato
**Canal de privacidade**: `{privacidade@dominio}` `{Encarregado: nome / empresa e responsável, se designado}`.
Você também pode reclamar à ANPD (www.gov.br/anpd).

## 10. Dados que tratamos em nome das empresas clientes
Se você é **colaborador** de uma empresa que usa o StarX Kiosk, ou **usuário do painel** dessa empresa, quem decide sobre seus dados é a **sua empresa**. Por exemplo: leitura da tela do sistema SSW no coletor, cargas e volumes bipados, indicadores de andamento, última localização do coletor (se ligada), imagens de tela pedidas pelo suporte, dados do aparelho e da sua conta no painel.
- Para saber as finalidades, a base legal, os prazos ou para exercer seus direitos, **procure o canal de privacidade da sua empresa**.
- Se o pedido chegar a nós, **encaminhamos à sua empresa** em até 2 dias úteis.
- Tratamos esses dados só para prestar o serviço contratado, com as proteções da seção 7. Não os usamos para fins próprios.

## 11. Crianças e adolescentes
O StarX Kiosk é um serviço para empresas e não é direcionado a menores de 18 anos.

## 12. Alterações
Mudanças relevantes serão informadas nesta página e, para os clientes, também por e-mail. As versões anteriores ficam disponíveis mediante pedido.

---

## Divergências entre a minuta e o sistema atual (resolver antes de publicar)

| Item da política | Situação no sistema | Ação |
|---|---|---|
| §3 registros de acesso até 1 ano; técnicos até 30 dias | trilha de login **sem prazo**; logs da API **sem limite** | implementar R2 e R6 (`roadmap-produto.md`) antes de publicar, ou ajustar o texto |
| §3 / §10 prazos dos dados dos clientes | cargas identificadas e capturas **sem prazo** hoje | R6 |
| §5 Cláusulas-Padrão "usamos" | **não formalizadas** | formalizar com Vercel, Cloudflare e Resend ou mudar para "estamos formalizando" |
| §4 provedor do servidor e região da Resend | **não identificados** | preencher |
| §7 cópias de segurança cifradas | **em claro** hoje | só incluir depois do R1 |
| §9 canal de privacidade | **inexistente** | criar a caixa de e-mail |
| §10 encaminhamento em 2 dias úteis | sem processo definido | definir quem lê o canal |
| Página `/privacidade` pública | **não existe** (todo o painel exige login) | R3 |
