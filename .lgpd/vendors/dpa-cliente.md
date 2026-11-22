# Acordo de Tratamento de Dados Pessoais — StarX Kiosk (minuta para clientes)

> ⚠️ **Minuta técnica para revisão jurídica antes de usar.** Preenchida com o funcionamento real do StarX Kiosk (2026-11-22). Os itens entre `{}` dependem do contrato comercial. A LGPD não impõe formulário fixo para este acordo; as 12 cláusulas seguem boas práticas (Arts. 39, 42, 46 e 48), salvo as Cláusulas-Padrão de transferência internacional (Res. CD/ANPD nº 19/2024), que se usam sem alteração.

**Anexo ao Contrato de Assinatura nº `{nº}`**, entre:
- **CONTROLADOR (Cliente)**: `{razão social}`, CNPJ `{nº}`;
- **OPERADOR (Fornecedor)**: `{razão social do MEI}`, CNPJ `{nº}`, que fornece o serviço StarX Kiosk.

## Cláusula 1 — Papéis
O Cliente decide usar o StarX Kiosk com os seus colaboradores e define as finalidades: é o **Controlador**. O Fornecedor trata os dados **em nome do Cliente e segundo as suas instruções** (Art. 39): é o **Operador**. Não usa os dados para finalidades próprias, não os vende e não os usa para treinar modelos nem para estatística própria, salvo de forma **anonimizada** e com autorização escrita do Cliente.

## Cláusula 2 — Objeto e escopo
O Fornecedor trata dados pessoais apenas para prestar o serviço StarX Kiosk:
- gestão dos coletores (modo kiosk, apps, comandos);
- leitura da tela do SSW para o acompanhamento ao vivo das cargas;
- indicadores e histórico de cargas e bipagens;
- localização dos coletores (se ativada pelo Cliente);
- capturas de tela sob demanda;
- acesso ao painel.

- **Titulares**: colaboradores do Cliente que operam os coletores; usuários do painel indicados pelo Cliente.
- **Dados**:
  - usuário do SSW, domínio e filial;
  - dados das cargas (função, placa, volumes, peso, valor, horários) e indicadores calculados;
  - códigos de barras bipados;
  - última localização do coletor;
  - imagens de tela;
  - identificadores do aparelho (IMEI, serial, MAC, rede, IPs, apps instalados);
  - contas do painel (usuário, e-mail, credenciais protegidas por hash, registros de acesso).
- **Dados sensíveis ou de menores**: o serviço não é projetado para eles. O Cliente informará se houver colaboradores menores de 18 anos (ex.: jovens aprendizes) operando coletores.
- **Duração**: a do Contrato de Assinatura, observada a Cláusula 9.

## Cláusula 3 — Instruções do Controlador
As instruções do Cliente são este Acordo, o Contrato e as **configurações que o Cliente faz no painel**: quais coletores leem o SSW, se a localização está ligada, quem tem acesso e os prazos de guarda. O Fornecedor avisa o Cliente se entender que uma instrução viola a LGPD.

## Cláusula 4 — Confidencialidade
Só acessam dados do Cliente as pessoas do Fornecedor que precisam disso para manter o serviço, sob dever de sigilo. O acesso de suporte aos dados do Cliente ocorre apenas para resolver chamados e fica registrado.

## Cláusula 5 — Segurança (Art. 46)
Medidas descritas no **Anexo I**.

## Cláusula 6 — Sub-operadores
O Cliente autoriza os sub-operadores do **Anexo II**. O Fornecedor avisará com **`{30}` dias** de antecedência a inclusão ou troca de sub-operador, e o Cliente poderá se opor de forma justificada. O Fornecedor exige dos sub-operadores obrigações equivalentes e responde perante o Cliente por eles.

## Cláusula 7 — Direitos dos titulares
- O Fornecedor oferece ao Cliente, no painel ou por solicitação, os meios para atender os seus colaboradores: consultar, exportar e anonimizar os dados de um colaborador (pelo usuário do SSW) e de usuários do painel.
- Pedido recebido diretamente de um titular é encaminhado ao Cliente em até **`{2}` dias úteis**, sem resposta de mérito pelo Fornecedor.

## Cláusula 8 — Incidentes
O Fornecedor comunica ao Cliente incidente confirmado ou razoavelmente suspeito que afete dados do Cliente **em até `{24}` horas** da ciência, com as informações técnicas disponíveis (o que, quando, quais dados e titulares, medidas tomadas). Isso permite ao Cliente comunicar a ANPD e os titulares no prazo da Res. CD/ANPD nº 15/2024. A comunicação à ANPD e aos titulares cabe ao Cliente.

## Cláusula 9 — Fim do contrato
- Encerrado o contrato, o Fornecedor disponibiliza a **exportação** dos dados do Cliente por **`{30}` dias**.
- Depois, **elimina** os dados do Cliente da base. As cópias de segurança expiram em até 14 dias (ou 30, se houver cópia externa).
- O Fornecedor emite uma declaração de eliminação, se pedida.

## Cláusula 10 — Demonstração de conformidade
Por ser de pequeno porte, o Fornecedor não possui certificações (ISO/SOC). Demonstra conformidade por:
- **questionário de segurança** respondido;
- **descrição técnica** do Anexo I;
- **registro de operações** (Art. 37);
- **auditoria documental** mediante aviso de `{15}` dias, preservado o sigilo de outros clientes.

## Cláusula 11 — Responsabilidade
Regida pelos Arts. 42 a 45 da LGPD. O Fornecedor responde solidariamente quando descumprir a LGPD ou as instruções lícitas do Cliente (Art. 42, § 1º, I), com direito de regresso. `{Limites entre as partes: definir com o jurídico.}`

## Cláusula 12 — Transferência internacional
Alguns sub-operadores (Anexo II) podem processar ou acessar dados fora do Brasil. Para destinos sem decisão de adequação (ex.: EUA), aplicam-se as **Cláusulas-Padrão Contratuais da Res. CD/ANPD nº 19/2024 (Anexo II)**, que integram o **Anexo III**. Para a UE/EEE, a decisão de adequação da Res. CD/ANPD nº 32/2026 (Art. 33, I).

---

## Anexo I — Medidas de segurança (estado em 2026-11-22)
**Já implementadas**:
- **Comunicação**: HTTPS em toda a comunicação; lotes enviados pelos coletores com assinatura criptográfica e proteção contra repetição.
- **Credenciais**: senhas com Argon2id; tokens, sessões e códigos guardados só como hash; segredo do app autenticador cifrado (AES-256-GCM).
- **Acesso ao painel**: 2FA (e-mail, app autenticador ou passkey); bloqueio progressivo de tentativas; papéis administrador/operador; registro de ações.
- **Leitura do SSW**: passiva; não lê a senha; ligável por coletor.
- **Retenção e backups**: eventos brutos apagados em 90 dias e bipagens em 365 dias; backup diário com 14 dias de guarda.

**Em implementação** (`roadmap-produto.md`):
- backups cifrados e com cópia externa;
- prazos de guarda configuráveis;
- exportação e anonimização por colaborador;
- separação entre clientes (multiempresa);
- aviso de privacidade no coletor.

## Anexo II — Sub-operadores
Ver `sub-operadores.md` (lista atual com país e garantia).

## Anexo III — Transferência internacional
Texto integral das Cláusulas-Padrão da Res. CD/ANPD nº 19/2024 (Anexo II), preenchidas para Vercel, Cloudflare e Resend (conforme `transfers/`).

---
Controlador: ______________________  Data: ___/___/______
Operador:    ______________________  Data: ___/___/______
