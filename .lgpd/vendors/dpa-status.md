# Contratos com operadores (DPA, Art. 39) — situação em 2026-11-22

Checklist de 12 cláusulas (boa prática, não lista legal taxativa): ver `dpa-template.md`. Para provedores globais com DPA público, **não** é preciso negociar contrato próprio. Basta confirmar o aceite e se o adendo cobre os 12 pontos, e anexar as Cláusulas-Padrão do Anexo II da Res. 19/2024 quando houver transferência para os EUA.

| Operador | Instrumento esperado | DPA vigente? | Anexo II (Res. 19/2024) | Ação |
|---|---|---|---|---|
| Provedor da VPS (crítico) | contrato de hospedagem com cláusulas de proteção de dados; usar `dpa-template.md` se o contrato padrão não cobrir | **desconhecido** | N/A se 100% Brasil | **1ª prioridade**: identificar o provedor e verificar os termos; se não houver cláusulas, negociar adendo ou migrar para provedor que ofereça |
| Vercel | DPA público incorporado aos termos | a confirmar (aceite no plano usado) | necessário (acesso dos EUA) | confirmar o aceite; formalizar o Anexo II |
| Cloudflare | DPA público (Customer DPA) | a confirmar | necessário | confirmar o aceite; formalizar o Anexo II |
| Resend | DPA público | a confirmar | se a região for EUA | verificar a região; confirmar o aceite; Anexo II se EUA |

**Controladores independentes/conjuntos**: OpenFreeMap (terceiro independente, sem contrato possível) → tratar por minimização/transparência, não por DPA.

**Contagem**: 4 operadores avaliados · 0 com DPA confirmado · 0 controladores independentes que exijam cláusula de compartilhamento · 4 pendências contratuais (em `gaps.md`).

**Cenário multiempresa** (`docs/multiempresa.md`): se o StarX Kiosk for oferecido a outras empresas, quem mantém a plataforma passa a ser **operador** de cada cliente. Será preciso um DPA (este template) entre a plataforma e cada cliente, e os operadores acima passam a ser **sub-operadores** (cláusula 6).
