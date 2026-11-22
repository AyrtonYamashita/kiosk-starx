# Bases Legais por Atividade de Tratamento — StarX Kiosk

> **Modelo para o cliente** (controlador). O fornecedor do StarX Kiosk é operador; este documento é preenchido e validado pelo cliente. Escrito a partir do uso real em 2026-11-22.

**Última atualização**: 2026-11-22 | **Status**: **proposta técnica, pendente de validação jurídica**
**Controlador**: `{cliente: razão social}`. Titulares principais: colaboradores com vínculo de emprego.

## Premissas
- **Nenhum dado sensível** (Art. 5º, II) é tratado de propósito, então só o Art. 7º se aplica. Capturas de tela podem conter qualquer conteúdo: tratadas em A005.
- **Consentimento (Art. 7º, I) não é proposto para nenhuma atividade.** Na relação de emprego, o colaborador não tem liberdade real de recusar o uso do coletor no trabalho, e a revogação (Art. 8º, § 5º) inviabilizaria a operação. Por isso o `lgpd-consent-schema` (F5) **não se aplica**.
- **Execução de contrato (Art. 7º, V)** foi considerada para o monitoramento e **descartada como base principal**: o contrato de trabalho não depende de medir o ritmo individual nem de localizar o colaborador. O fundamento é o interesse do empregador em organizar e controlar a operação (poder diretivo), que corresponde ao **legítimo interesse (Art. 7º, IX)** e exige LIA (Art. 10).
- **Menores**: não há (sem jovens aprendizes nos coletores; confirmado em 2026-11-22). Se isso mudar, as LIAs de A001–A005 precisam do teste reforçado de melhor interesse (Art. 14 + Enunciado CD/ANPD nº 1/2023).
- **Oposição (Art. 18, § 2º)**: nas atividades com legítimo interesse, o titular pode se opor quando houver descumprimento da LGPD. O canal é o do Encarregado (L4).

## A001 — Acompanhamento das operações (leitura do SSW)
- **Finalidade**: coordenar em tempo real as descargas e saber quem opera cada coletor.
- **Dados**: usuário/domínio/filial do SSW, tela, função, placa, volumes, peso, valor, horários.
- **Sensíveis?** Não. **Menores?** Não.
- **Base legal**: **Art. 7º, IX** (legítimo interesse do controlador: organização e controle da operação logística).
- **Justificativa**: interesse concreto e atual (operação diária com 15 coletores); dados restritos ao que aparece na tela de trabalho; leitura passiva; sem senha.
- **LIA**: `.lgpd/kit-cliente/lia-modelos/monitoramento-operacional.md` (A001–A003)
- **Oposição**: Art. 18, § 2º, pelo canal do Encarregado.

## A002 — Indicadores individuais de produtividade e histórico de cargas
- **Finalidade**: medir andamento e ritmo por colaborador e manter histórico por placa/colaborador.
- **Dados**: métricas inferidas (ritmo, tempo na função, previsão de término), motivo de encerramento, histórico.
- **Base legal**: **Art. 7º, IX**, com **escrutínio reforçado**. É a atividade de maior impacto (perfil de desempenho).
- **Condição para a base valer**: os indicadores **não podem ser o único fundamento** de punição ou avaliação. Qualquer decisão sobre o colaborador deve ter análise humana e permitir que ele se manifeste (Art. 20 por analogia; boa prática).
- **LIA**: `.lgpd/kit-cliente/lia-modelos/monitoramento-operacional.md`

## A003 — Registro de bipagens e consulta por código de barras
- **Finalidade**: rastrear volumes (qual carga, coletor, hora e colaborador) para resolver divergências.
- **Base legal**: **Art. 7º, IX**. Para a parte usada em disputa com cliente ou transportadora, também **Art. 7º, VI** (exercício regular de direitos), quando houver processo ou reclamação concreta.
- **Prazo**: 365 dias. Precisa de justificativa documentada (ex.: prazo de reclamação de avaria/extravio com clientes; **validação jurídica**).
- **LIA**: `.lgpd/kit-cliente/lia-modelos/monitoramento-operacional.md`

## A004 — Localização dos coletores
- **Finalidade**: localizar o aparelho (perda, furto, conferir pátio/filial).
- **Base legal**: **Art. 7º, IX**, **condicionada à minimização** (ver LIA). No desenho atual (GPS a cada 1 min, em segundo plano, ligado por padrão, visível a qualquer usuário do painel), o balanceamento **é frágil**.
- **LIA**: `.lgpd/kit-cliente/lia-modelos/localizacao-coletores.md`

## A005 — Capturas de tela remotas
- **Finalidade**: suporte técnico remoto.
- **Base legal**: **Art. 7º, IX**, com salvaguardas: aviso visível no coletor no momento da captura, acesso restrito e prazo curto.
- **LIA**: `.lgpd/kit-cliente/lia-modelos/capturas-tela.md`

## A006 — Gestão dos aparelhos (MDM)
- **Finalidade**: manter e proteger os coletores da empresa (kiosk, apps, atualizações, comandos).
- **Dados**: identificadores do aparelho (IMEI, serial, MAC, SSID, IPs), apps, bateria.
- **Base legal**: **Art. 7º, IX** (gestão e segurança de ativos da empresa). O vínculo com a pessoa é indireto.
- **LIA**: `.lgpd/kit-cliente/lia-modelos/seguranca-gestao.md` (A006–A009)

## A007 — Autenticação e segurança do painel
- **Finalidade**: controlar o acesso e proteger as contas.
- **Base legal**: **Art. 7º, IX** (segurança do sistema, ligada ao dever de segurança do Art. 46). O e-mail para o código de 2º fator é indispensável ao serviço de acesso.
- **Observação**: o **identificador digitado em tentativas de login de contas inexistentes** é retido sem prazo. A base se sustenta só com **prazo curto** (gap P1).
- **LIA**: `.lgpd/kit-cliente/lia-modelos/seguranca-gestao.md`

## A008 — Registro de ações administrativas
- **Finalidade**: responsabilização de quem opera o painel (Art. 6º, X).
- **Base legal**: **Art. 7º, IX**; e **Art. 7º, VI** quando usado em apuração ou processo.
- **LIA**: `.lgpd/kit-cliente/lia-modelos/seguranca-gestao.md`

## A009 — Logs técnicos e backups
- **Finalidade**: operação, diagnóstico e recuperação de desastre.
- **Base legal**: **Art. 7º, IX** (continuidade e segurança, Art. 46).
- **LIA**: `.lgpd/kit-cliente/lia-modelos/seguranca-gestao.md`

## Resumo

| Atividade | Base | LIA |
|---|---|---|
| A001 Acompanhamento | Art. 7º, IX | monitoramento-operacional |
| A002 Produtividade/histórico | Art. 7º, IX (reforçado) | monitoramento-operacional |
| A003 Bipagens | Art. 7º, IX (+ VI em disputas) | monitoramento-operacional |
| A004 Localização | Art. 7º, IX (condicionada à minimização) | localizacao-coletores |
| A005 Capturas de tela | Art. 7º, IX (com salvaguardas) | capturas-tela |
| A006 MDM | Art. 7º, IX | seguranca-gestao |
| A007 Autenticação | Art. 7º, IX (Art. 46) | seguranca-gestao |
| A008 Auditoria | Art. 7º, IX (+ VI) | seguranca-gestao |
| A009 Logs/backups | Art. 7º, IX (Art. 46) | seguranca-gestao |

**Consequência**: todas as atividades usam legítimo interesse, então a ANPD pode pedir RIPD (Art. 10, § 3º). Isso reforça a recomendação de RIPD para A001–A005 (L12).
