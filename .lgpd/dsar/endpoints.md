# Direitos dos titulares — proposta técnica (F10, 2026-11-22)

Não implementado. Para aprovação. A referência da skill (Next.js + Better Auth com `/api/me`) não se aplica como está: os colaboradores **não têm login**, então o atendimento é **assistido** (o Encarregado ou um admin gera o pacote).

## API (Fastify, `server/src/routes`) — só para administradores

| Rota | Direito | O que faz |
|---|---|---|
| `GET /v1/admin/privacy/subjects?ssw_user=` | I (confirmação) | se há dados do colaborador: nº de cargas, período, nº de bipagens, se há estado atual |
| `GET /v1/admin/privacy/subjects/:ssw_user/export?format=json\|csv` | II, V | pacote completo: cargas (sem outros colaboradores), bipagens das cargas dele, eventos ainda retidos, + bloco descritivo fixo (finalidades, origem "leitura da tela do SSW no coletor", destinatários/operadores, prazos) |
| `POST /v1/admin/privacy/subjects/:ssw_user/anonymize` | IV, VI | substitui o `ssw_user` por um pseudônimo irreversível em `ops_operations`/`ops_device_state`; registra a eliminação na lista de reaplicação pós-restore (`retention.md` §3); exige papel admin + 2FA recente |
| `GET /v1/admin/me/export` | II, V (usuário do painel) | perfil, sessões, eventos de login, fatores (sem segredos) |
| `POST /v1/admin/users/:id/anonymize` | VI (usuário do painel) | anonimiza usuário/e-mail, apaga sessões/fatores |

Toda chamada gera um evento de auditoria (`dsar_export`, `dsar_anonymize`) sem copiar o conteúdo.

## Painel
- Tela **Privacidade** (só admin): buscar colaborador, ver confirmação, exportar, anonimizar (com o popup de confirmação do painel).
- Em **Conta**: "Baixar meus dados".

## Prazos
SLA calculado a partir da data de recebimento registrada pelo Encarregado: simplificado no ato; completo em até 15 dias corridos.
