# LIA — Gestão de aparelhos, segurança do painel, auditoria, logs e backups (A006–A009)

> **Modelo para o cliente** (controlador). O fornecedor do StarX Kiosk é operador; este documento é preenchido e validado pelo cliente. Escrito a partir do uso real em 2026-11-22.

## Identificação
- **Atividades**: A006 MDM · A007 Autenticação do painel · A008 Auditoria administrativa · A009 Logs e backups
- **Controlador**: `{cliente: razão social}`
- **Data**: 2026-11-22 | **Versão**: v1 (proposta técnica) | **Próxima revisão**: 2027-11-22

## 1. Teste de finalidade
- **Interesse**:
  - manter e proteger os coletores (A006);
  - impedir acesso indevido ao painel (A007);
  - responsabilizar quem opera o painel (A008);
  - operar e recuperar o sistema (A009).
  O dever de segurança do Art. 46 reforça todos eles.
- **Concreto e lícito**: sim.

## 2. Teste de necessidade
- **A006**:
  - IMEI, serial e MAC identificam o aparelho, o que é necessário ao MDM.
  - SSID e IPs servem ao diagnóstico de rede.
  - A lista de apps instalados é necessária para o kiosk.
  - Não há vínculo direto com o colaborador no banco.
- **A007**:
  - Senha (hash), e-mail (envio do 2º fator), IP e navegador (detecção de abuso, bloqueio progressivo) são necessários.
  - **Excesso**: guardar sem prazo o identificador digitado em tentativas de contas inexistentes.
- **A008**: quem/quando/o quê é necessário. Os detalhes devem evitar copiar dados pessoais de terceiros.
- **A009**:
  - Logs com IP/URL são necessários por um prazo curto.
  - Backups completos são necessários para recuperação.
  - **Excesso**: logs sem limite e backups sem criptografia.

## 3. Balanceamento

| Dimensão | Análise |
|---|---|
| Legítima expectativa | **alta**: qualquer sistema corporativo registra login, sessões e ações |
| Impacto | **baixo** com prazos definidos; moderado se a retenção for indefinida |
| Titulares | usuários do painel (1 hoje) e, indiretamente, colaboradores (aparelho) |

**Conclusão**: **viável**, condicionado a prazos de retenção (seção 4).

## 4. Salvaguardas
- [ ] Prazo para `auth_events` (sugestão de 6 meses a 1 ano, a definir); apagar antes as tentativas de contas inexistentes
- [ ] Anonimizar usuários do painel desativados após um prazo
- [ ] Rotação dos logs Docker (`max-size`/`max-file`)
- [ ] Backups criptografados e com cópia fora da VPS
- [ ] Transparência (política de privacidade do painel)

## 5. Alto risco / RIPD
- Não configura alto risco cumulativo.

## 6. Parecer
- [ ] Aprovado com as salvaguardas  - [ ] Reprovado

**Revisado por (Encarregado / Jurídico)**: _______ — **Data**: _______
