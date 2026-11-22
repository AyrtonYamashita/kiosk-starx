# LIA — Monitoramento operacional (A001, A002, A003)

> **Modelo para o cliente** (controlador). O fornecedor do StarX Kiosk é operador; este documento é preenchido e validado pelo cliente. Escrito a partir do uso real em 2026-11-22.

## Identificação
- **Atividades**: A001 Acompanhamento das operações · A002 Indicadores de produtividade e histórico · A003 Bipagens
- **Controlador**: `{cliente: razão social}`
- **Data**: 2026-11-22 | **Versão**: v1 (proposta técnica) | **Próxima revisão**: 2027-05-22 ou antes de qualquer mudança de finalidade

## 1. Teste de finalidade
- **Interesse concreto**: coordenar as descargas em tempo real (quem está em qual carga, quanto falta, quando termina), rastrear volumes bipados para resolver divergências e medir o andamento das cargas.
- **Concreto e atual**: sim. Operação diária (68 cargas e 4.440 bipagens entre 18 e 22/11/2026).
- **Lícito**: sim, dentro do poder diretivo do empregador. É **ilícito** usar estes dados para fins discriminatórios (Art. 6º, IX) ou fora do trabalho.

## 2. Teste de necessidade
- **Necessários**: usuário do SSW (saber quem opera), função/placa/volumes (andamento), horários (duração e previsão), códigos bipados (rastreio do volume).
- **Alternativa menos intrusiva**:
  - **A001/A003**: não há. É preciso saber a carga e o volume.
  - **A002**: o **ritmo individual** pode ser substituído por indicadores **por carga ou por equipe** quando a finalidade for só planejamento. Manter o individual só se houver finalidade gerencial documentada.
- **Já descartado no desenho atual**: senha (nunca lida); valores de campos fora de `funcao, placa, placa_real, dominio, filial` no diagnóstico; leitura fora das páginas do SSW.

## 3. Balanceamento e legítima expectativa

| Dimensão | Análise |
|---|---|
| Relação com o titular | empregado, usando equipamento da empresa, no horário de trabalho |
| Legítima expectativa | **média**: o colaborador sabe que o SSW registra a operação, mas **não necessariamente** que o coletor transmite em tempo real e calcula o seu ritmo. Hoje **não há aviso** (gap P0) |
| Impacto | **moderado a elevado**: pressão por desempenho, uso em avaliação/disciplina, histórico de 1 ano |
| Vulnerabilidade | adultos em relação de subordinação (assimetria de poder); sem menores |
| Origem | observada (A001, A003) e inferida (A002) |
| Salvaguardas existentes | leitura passiva, sem senha; acesso ao painel com 2FA; eventos brutos apagados em 90 d; encerramento automático de carga sem sinal |

**Conclusão**: o legítimo interesse **é viável para A001 e A003** e **viável com condições para A002**, desde que as salvaguardas da seção 4 sejam implementadas. Sem transparência aos colaboradores, a legítima expectativa não se sustenta e o balanceamento pende para o titular.

## 4. Salvaguardas
- [ ] **Transparência**: aviso aos colaboradores (política interna + aviso no coletor/painel) sobre o que é lido, para quê, por quanto tempo e quem vê (P0)
- [ ] **Oposição/contestação**: canal do Encarregado; o colaborador pode contestar indicador ou registro (Art. 18, § 2º)
- [ ] **Minimização e prazo**: prazo definido para `ops_operations` com anonimização do `ssw_user` após o prazo (P1); justificar os 365 dias das bipagens
- [ ] **Sem decisão só pelo sistema**: indicadores não são fundamento único de punição/avaliação; revisão humana
- [ ] **Acesso restrito**: avaliar limitar a tela Cargas e os indicadores individuais a perfis que precisam deles
- [ ] **Perfilamento publicitário**: não se aplica (não há uso comercial)

## 5. Alto risco / RIPD
- **Critério geral**: impacto significativo em direitos (monitoramento individual contínuo no trabalho) → **presente**
- **Critério específico**: definição de perfil de desempenho (A002) → **provável**; adolescentes → não
- **Resultado**: **RIPD recomendado** (preventivo por boa prática; exigível se a ANPD pedir, Art. 10, § 3º)

## 6. Parecer
- [ ] Aprovado com as salvaguardas da seção 4
- [ ] Reprovado

**Revisado por (Encarregado / Jurídico)**: _______ — **Data**: _______
