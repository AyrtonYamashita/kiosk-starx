-- Fase 1.1 (login robusto): contas com e-mail e papel, sessões com IP/aparelho, auditoria e bloqueio progressivo.
-- Só acrescenta: o administrador atual continua entrando como antes.

ALTER TABLE admins
    ADD COLUMN email               text,
    -- admin: tudo (inclusive usuários e segurança) · operator: operação (aparelhos, comandos, acompanhamento)
    ADD COLUMN role                text NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'operator')),
    -- multi-tenant (futuro): null = sem tenant
    ADD COLUMN tenant_id           uuid,
    ADD COLUMN disabled_at         timestamptz,
    ADD COLUMN password_changed_at timestamptz;

CREATE UNIQUE INDEX admins_email_key ON admins (lower(email)) WHERE email IS NOT NULL;

ALTER TABLE sessions
    ADD COLUMN ip         text,
    ADD COLUMN user_agent text,
    ADD COLUMN tenant_id  uuid;

-- Trilha de auditoria de autenticação (login, falha, bloqueio, sessão, usuário, fator).
CREATE TABLE auth_events (
    id         bigserial PRIMARY KEY,
    tenant_id  uuid,
    admin_id   uuid REFERENCES admins(id) ON DELETE SET NULL,
    -- o que foi digitado no login (usuário/e-mail), mesmo que a conta não exista
    identifier text,
    event      text NOT NULL,
    ip         text,
    user_agent text,
    details    jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_events_created_idx ON auth_events (created_at DESC);
CREATE INDEX auth_events_admin_idx ON auth_events (admin_id, created_at DESC);

-- Bloqueio temporário e progressivo: por IP e por conta (o identificador digitado, exista a conta ou não).
CREATE TABLE auth_lockouts (
    kind            text NOT NULL CHECK (kind IN ('ip', 'account')),
    key             text NOT NULL,
    -- falhas desde o último bloqueio
    failures        integer NOT NULL DEFAULT 0,
    -- quantos bloqueios seguidos (define a duração do próximo)
    level           integer NOT NULL DEFAULT 0,
    locked_until    timestamptz,
    last_failure_at timestamptz,
    PRIMARY KEY (kind, key)
);
