# Runbook de incidente de segurança com dados pessoais — StarX Kiosk

**Modo**: preparatório (2026-11-22). **Regime**: controlador padrão → **3 dias úteis** para comunicar à ANPD e aos titulares (Res. CD/ANPD nº 15/2024, Arts. 6º e 9º), contados da ciência de que o incidente afetou dados pessoais.
**Encarregado**: **PENDENTE**. Sem ele, ninguém está formalmente designado para conduzir a comunicação. Resolver antes de precisar (`encarregado.md`).

## Contatos (preencher)
| Papel | Nome | Contato |
|---|---|---|
| Encarregado | PENDENTE | |
| Responsável técnico (StarX Kiosk) | | |
| Jurídico | | |
| Provedor da VPS (suporte/abuso) | | |
| Vercel / Cloudflare / Resend | | portais de suporte |

## Fase 1 — T+0: ciência
- Anotar **data e hora com fuso** em que se soube que **dados pessoais** foram afetados (`log.md`).
- Acionar Encarregado, responsável técnico e jurídico.

## Fase 2 — T+0 a T+4h: contenção e preservação (específico do StarX Kiosk)
**Preservar primeiro, depois mexer**: antes de reiniciar ou trocar algo, copiar as evidências para fora da VPS:
- `docker compose logs api > incidente-api-<data>.log`;
- `docker compose logs postgres`;
- logs do Caddy;
- logs/analytics da Cloudflare e da Vercel do período;
- `auth_events` exportado: `SELECT … WHERE created_at > <início>`.

Conforme o vetor:

| Cenário | Contenção |
|---|---|
| Sessão/conta do painel comprometida | desativar o usuário no painel; `DELETE FROM sessions` (derruba todas as sessões); revisar `auth_events`; trocar a senha e os fatores de 2FA |
| Vazamento de segredos do servidor (`.env`) | trocar `PANEL_SECRET` (API e Vercel juntos), `POSTGRES_PASSWORD`, `RESEND_API_KEY`. **`AUTH_SECRET`**: trocar invalida todas as sessões **e torna ilegíveis os segredos TOTP cifrados com ele** (os usuários precisam recadastrar o app autenticador). Decidir conscientemente |
| Acesso indevido à VPS | revogar as chaves SSH, trocar a senha do Postgres, avaliar subir em servidor limpo a partir do backup (cifrado/externo, quando existir) |
| Coletor perdido/roubado | bloquear pelo painel; remover do painel (invalida o token do aparelho); se o modo kiosk ainda atende, comando de bloqueio |
| Token de aparelho vazado | remover o aparelho do painel e recadastrar (token novo) |
| Backup exposto | tratar como vazamento do **banco inteiro** (todas as atividades A001–A009) |
| Incidente em operador (Vercel/Cloudflare/Resend/VPS) | pedir relatório técnico ao operador (cláusula do DPA, `vendors/dpa-status.md`) |

## Fase 3 — T+4h a T+24h: escopo e triagem (⏸ decisão do Encarregado + jurídico)
1. Quais tabelas/arquivos foram expostos? (mapa: `data-map.md`)
2. Quantos titulares? Hoje: ~11 colaboradores, 1 usuário do painel (crescerá). **Não há menores.**
3. **Teste do Art. 5º da Res. 15/2024 (cumulativo)**:
   - **A, risco relevante**: monitoramento de produtividade e localização expostos podem causar dano moral, assédio ou discriminação. **Provável sim** se as tabelas `ops_*` vazarem.
   - **B, categoria**: **IV, dados de autenticação** (hashes Argon2id, segredos TOTP cifrados, tokens em hash) se `admins`/`sessions`/`admin_totp` vazarem. Sensíveis, menores e financeiros: não. Larga escala: não, no volume atual.
   - Se **A e B** → **comunicar**. Se não → registrar mesmo assim (Art. 10) com o motivo.
4. Os dados vazados estavam protegidos? (senhas Argon2id e TOTP AES-GCM reduzem o risco; `ops_*`, IMEI e e-mails estão em claro.)

## Fase 4 — até 3 dias úteis: comunicações (⏸ checkpoint)
- ANPD: `notification-anpd.md` (12 itens, Art. 6º, § 2º) pelo peticionamento eletrônico da ANPD.
- Titulares: `notification-subject.md` (7 itens, Art. 9º), em linguagem simples. Para colaboradores: comunicado individual pelos canais internos (RH/gestor/e-mail corporativo).
- Comunicação preliminar pode ser complementada em até **20 dias úteis**.

## Fase 5 — pós-incidente
Causa raiz, correção, registro em `log.md` (guardar **≥ 5 anos**, Art. 10) e atualização deste runbook.

## Exercício (mínimo anual)
Cenários sugeridos:
1. `.env` da VPS exposto;
2. backup `.sql.gz` copiado por terceiro;
3. conta do painel invadida (sessão roubada);
4. coletor roubado com o SSW aberto.
