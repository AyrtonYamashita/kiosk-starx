# LIA — Capturas de tela remotas (A005)

> **Modelo para o cliente** (controlador). O fornecedor do StarX Kiosk é operador; este documento é preenchido e validado pelo cliente. Escrito a partir do uso real em 2026-11-22.

## Identificação
- **Atividade**: A005 Capturas de tela remotas
- **Controlador**: `{cliente: razão social}`
- **Data**: 2026-11-22 | **Versão**: v1 (proposta técnica) | **Próxima revisão**: 2027-05-22

## 1. Teste de finalidade
- **Interesse**: suporte técnico remoto (ver o erro que aparece no coletor sem ir até ele).
- **Concreto**: sim (17 capturas guardadas em produção).
- **Lícito**: sim para suporte. **Não** para vigiar o que o colaborador faz.

## 2. Teste de necessidade
- A captura é feita sob comando de um administrador (não é contínua): **adequado**.
- Ficam até 10 por aparelho **sem prazo em dias**: excesso. O suporte precisa de horas ou dias, não de meses.
- Alternativa: os dados de diagnóstico do leitor (sem imagem) resolvem parte dos casos.

## 3. Balanceamento

| Dimensão | Análise |
|---|---|
| Legítima expectativa | **baixa** se o colaborador não sabe que a tela pode ser capturada |
| Impacto | **moderado**: a imagem pode mostrar dados do colaborador e de terceiros (clientes/destinatários no SSW) |
| Origem | observada |

**Conclusão**: **viável com salvaguardas**.

## 4. Salvaguardas
- [ ] **Aviso visível no coletor** no momento da captura (ex.: toast "Captura de tela enviada ao suporte")
- [ ] **Prazo curto**: apagar capturas com mais de 7 dias (sugestão; definir em `retention.md`)
- [ ] Registrar quem pediu cada captura (já existe em `commands` + `auth_events`)
- [ ] Transparência no aviso aos colaboradores

## 5. Alto risco / RIPD
- Integra o RIPD do monitoramento (A001–A005).

## 6. Parecer
- [ ] Aprovado com as salvaguardas  - [ ] Reprovado

**Revisado por (Encarregado / Jurídico)**: _______ — **Data**: _______
