# RIPD — Monitoramento de colaboradores pelo StarX Kiosk (modelo para o cliente)

> **Modelo**: o RIPD é documento **do controlador** (Art. 38), ou seja, do **cliente** que usa o StarX Kiosk com os seus colaboradores. Foi preparado pelo **fornecedor** (operador) com o funcionamento real do sistema em 2026-11-22 e com o uso de referência medido em produção (15 coletores, 11 colaboradores, 68 cargas e 4.440 bipagens entre 18 e 22/11/2026). O cliente ajusta ao seu caso, e o Encarregado dele dá o parecer.

## 1. Identificação e natureza
- **Controlador**: `{cliente: razão social, CNPJ}` | **Encarregado**: `{nome e contato}`
- **Operador**: `{fornecedor: razão social do MEI}` (StarX Kiosk) | **Versão**: v0.9 (modelo) | **Data**: 2026-11-22
- **Atividades cobertas** (`data-map.md`): A001 acompanhamento das operações · A002 indicadores e histórico · A003 bipagens · A004 localização dos coletores · A005 capturas de tela
- **Classificação**: **alto risco provável** pelo teste cumulativo da Res. CD/ANPD nº 2/2022, Art. 4º:
  - **critério geral II**: possível afetação significativa de direitos (monitoramento individual e contínuo no trabalho, com uso potencial em avaliação e disciplina);
  - **critério específico III**: definição de perfil de desempenho (ritmo, tempo na função). **Não há** decisão unicamente automatizada. O enquadramento em "inclusive definição de perfis" é interpretativo: **confirmar com o jurídico**.
  - **Exigível a qualquer tempo pela ANPD**, porque a base é legítimo interesse (Art. 10, § 3º). Mesmo que o jurídico afaste o alto risco, recomenda-se manter como RIPD preventivo.

## 2. Contexto, finalidade e necessidade
- **Finalidades**:
  - coordenar descargas em tempo real;
  - rastrear volumes e resolver divergências;
  - planejar a operação com base no andamento das cargas;
  - localizar coletores perdidos;
  - dar suporte técnico remoto.
- **Volume** (multifatorial): poucos titulares por cliente (dezenas); tratamento **contínuo** durante a jornada; um ou poucos locais; histórico de até 1 ano. Não há larga escala no uso de referência.
- **Alternativas menos intrusivas avaliadas**:

| Tratamento | Alternativa | Decisão sugerida |
|---|---|---|
| Ritmo individual (A002) | indicadores por carga ou por equipe | manter o individual só se houver finalidade gerencial documentada; restringir quem vê (R13) |
| Localização contínua (A004) | desligada por padrão, aproximada ou sob demanda | **adotar** (R5) |
| Capturas de tela (A005) | diagnóstico sem imagem | manter sob demanda, com aviso e prazo de 7 d (R12, R6) |
| Leitura do SSW (A001/A003) | nenhuma que atenda à finalidade | manter, passiva e sem senha |

## 3. Fluxo dos dados e papéis
1. **Coleta**: o app no coletor lê a tela do SSW (sem senha), mede bipagens e, se ligado, obtém a posição; captura a tela só sob comando.
2. **Envio**: lotes assinados → Cloudflare (sub-operador) → API na VPS (sub-operador).
3. **Armazenamento**: Postgres na VPS; backups diários (14 d).
4. **Uso**: painel na Vercel (sub-operador) para gestores autorizados pelo cliente; indicadores calculados pela API.
5. **Retenção/eliminação**: eventos 90 d; bipagens 365 d; cargas identificadas 365 d e depois anonimizadas (R6); capturas 7 d (R6); localização só a última.

**Papéis**: cliente = controlador · fornecedor = operador · VPS, Vercel, Cloudflare, Resend = sub-operadores (`vendors/sub-operadores.md`) · OpenFreeMap = terceiro (imagens do mapa).

## 4. Base legal e direitos
- **Base**: Art. 7º, IX (legítimo interesse), com LIAs em `kit-cliente/lia-modelos/`. Consentimento não é adequado na relação de emprego.
- **Direitos**: acesso, cópia, correção, anonimização e oposição pelo canal do Encarregado do cliente, com exportação e anonimização por colaborador no painel (R7). Sem decisão unicamente automatizada (Art. 20 não aplicável), mantido o compromisso de revisão humana.
- **Menores**: não há no uso de referência. O cliente declara se houver aprendizes (14–17 anos); nesse caso, refazer este RIPD com o teste de melhor interesse (Art. 14).

## 5. Ameaças de privacidade (LINDDUN)

| Ameaça | Cenário concreto | Controles existentes | Controles a adotar |
|---|---|---|---|
| **Linking / Identifying** | cruzar o usuário do SSW, a localização e o horário para reconstituir a rotina de uma pessoa | só a última posição; eventos brutos 90 d | localização desligada por padrão (R5); anonimização das cargas antigas (R6) |
| **Detecting / inferência** | inferir saúde, cansaço ou pausas a partir do ritmo e dos intervalos de bipagem | — | proibir esse uso no aviso e na política interna; restringir a visão dos indicadores (R13) |
| **Data disclosure** | vazamento da VPS, de backups ou de logs; acesso indevido ao painel | HTTPS; 2FA; Argon2id; tokens em hash | backups cifrados e externos (R1); rotação de logs (R2); separação entre clientes (R8); registro de consultas (R11) |
| **Non-repudiation** | colaborador não consegue contestar um registro errado de carga | trilha de ações do painel | canal de contestação; exportação por colaborador (R7) |
| **Unawareness** | o colaborador não sabe que o coletor transmite o seu ritmo e a posição | — | **aviso no coletor (R4)** + aviso formal (`kit-cliente/aviso-colaboradores-modelo.md`) |
| **Non-compliance / desvio de finalidade** | usar indicadores para punição automática, controle de jornada ou fora do trabalho | não há decisão automatizada | regra escrita: nenhuma punição só pelos números; localização não serve para controle de pausas |

**IA**: o StarX Kiosk **não** usa IA, modelos de linguagem nem perfilamento automatizado além de médias aritméticas.

## 6. Matriz de risco (probabilidade × impacto)

| # | Risco | Prob. hoje | Impacto | Risco hoje | Mitigação (roadmap) | Risco residual |
|---|---|---|---|---|---|---|
| R-1 | Colaborador desconhece o monitoramento | alta | alto | **alto** | R4 + aviso formal | baixo |
| R-2 | Rastreio de rotina pela localização contínua | média | alto | **alto** | R5 | baixo |
| R-3 | Uso disciplinar só pelos indicadores | média | alto | **alto** | regra interna + R13 | médio |
| R-4 | Vazamento por backup em claro / VPS | baixa | alto | médio | R1, R2, contrato com a VPS | baixo |
| R-5 | Retenção indefinida do histórico identificado | alta | médio | médio | R6 | baixo |
| R-6 | Acesso de um cliente a dados de outro | baixa hoje (1 cliente) | alto | médio ao crescer | R8 (antes do 2º cliente) | baixo |
| R-7 | Captura de tela expõe dados de terceiros | baixa | médio | baixo | R12, prazo 7 d | baixo |
| R-8 | Transferência internacional sem garantia formal | média | médio | médio | Cláusulas-Padrão (Res. 19/2024) com Vercel, Cloudflare, Resend | baixo |

**Conclusão**: com a Fase 1 do `roadmap-produto.md` e as regras internas do cliente (aviso, sem punição automática, localização restrita), o risco residual fica **aceitável**, exceto R-3 (médio), que depende de como o cliente usa os indicadores.

## 7. Parecer e aprovação (⏸ cliente)
- [ ] Parecer do Encarregado do cliente: `{texto}` — `{data}`
- [ ] Aprovação da diretoria do cliente — `{data}`
- [ ] Revisão programada: a cada 12 meses ou a cada mudança relevante (nova função de monitoramento, IA, novo uso dos indicadores)
