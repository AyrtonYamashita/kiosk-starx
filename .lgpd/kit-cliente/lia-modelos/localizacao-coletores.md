# LIA — Localização dos coletores (A004)

> **Modelo para o cliente** (controlador). O fornecedor do StarX Kiosk é operador; este documento é preenchido e validado pelo cliente. Escrito a partir do uso real em 2026-11-22.

## Identificação
- **Atividade**: A004 Localização dos coletores
- **Controlador**: `{cliente: razão social}`
- **Data**: 2026-11-22 | **Versão**: v1 (proposta técnica) | **Próxima revisão**: 2027-05-22

## 1. Teste de finalidade
- **Interesse concreto**: encontrar coletores perdidos/furtados e saber em que pátio/filial cada um está (patrimônio da empresa).
- **Concreto e atual**: sim (14 de 15 coletores enviam posição).
- **Lícito**: sim para localizar o **aparelho**. **Não é lícito** usar para acompanhar deslocamentos do colaborador, fiscalizar pausas ou localizar a pessoa fora do trabalho.

## 2. Teste de necessidade
- **Como está hoje** (`LocationTracker.kt`, `KioskConfig.kt:127`, `DeviceOwner.kt`):
  - GPS de alta precisão a cada 1 min ou 10 m;
  - em segundo plano, **ligado por padrão**;
  - localização do sistema forçada a ligada;
  - posição visível no mapa a qualquer usuário do painel.
- **Alternativas menos intrusivas, que atendem à finalidade**:
  1. **Desligado por padrão** nos perfis novos; ligar por perfil/filial quando houver necessidade (ex.: coletores que saem do pátio).
  2. **Precisão reduzida** (ex.: rede/aproximada) ou **frequência menor** (ex.: a cada 15–30 min), suficientes para "qual pátio".
  3. **Sob demanda**: posição pedida pelo painel só quando o aparelho estiver sumido (comando "localizar"), em vez de rastreio contínuo.
  4. Mostrar a posição só a perfis com essa função.
- **Observação técnica**: a localização também é usada para o Android informar o SSID (`DeviceOwner.kt:27`). Isso não exige **enviar** a posição ao servidor.

## 3. Balanceamento

| Dimensão | Análise |
|---|---|
| Relação | empregado portando equipamento da empresa |
| Legítima expectativa | **baixa** para rastreio contínuo; **média** para "a empresa sabe onde estão os seus coletores" |
| Impacto | **elevado** se contínuo (revela a rotina da pessoa); **baixo** se sob demanda/aproximado |
| Vulnerabilidade | subordinação; sem menores |
| Origem | observada, sem ação do titular |

**Conclusão**: no desenho atual, o balanceamento é **desfavorável** (os direitos do titular tendem a prevalecer), porque o rastreio é contínuo e preciso e a finalidade (achar o aparelho) não precisa disso. Com **uma** das alternativas 1–3 e transparência, o legítimo interesse fica **viável**.

## 4. Salvaguardas
- [ ] Adotar alternativa 1, 2 ou 3 (decisão de produto) (P1)
- [ ] Transparência no aviso aos colaboradores (P0)
- [ ] Sem histórico de trajetos (hoje só a última posição: manter assim)
- [ ] Acesso ao mapa restrito a quem precisa
- [ ] Proibição documentada de uso para controle de jornada/pausas

## 5. Alto risco / RIPD
- Integra o RIPD do monitoramento (A001–A005). Localização contínua de empregado → **RIPD recomendado**.

## 6. Parecer
- [ ] Aprovado com as salvaguardas
- [ ] Reprovado no desenho atual: exige mudança de arquitetura antes

**Revisado por (Encarregado / Jurídico)**: _______ — **Data**: _______
