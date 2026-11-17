-- Fase 1.3a (2FA): login em duas etapas com código por e-mail, códigos de recuperação e "confiar neste navegador".
-- Só acrescenta. Com AUTH_REQUIRE_2FA=false, o login continua como antes.

-- sessão "mfa": criada depois da senha certa, só serve para concluir o segundo fator (10 min)
ALTER TABLE sessions
    ADD COLUMN stage        text NOT NULL DEFAULT 'full' CHECK (stage IN ('full', 'mfa')),
    ADD COLUMN mfa_attempts integer NOT NULL DEFAULT 0;

-- código de uso único enviado por e-mail (só o HMAC fica guardado)
CREATE TABLE email_otps (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  uuid,
    admin_id   uuid NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    session_id uuid REFERENCES sessions(id) ON DELETE CASCADE,
    code_hash  text NOT NULL,
    attempts   integer NOT NULL DEFAULT 0,
    expires_at timestamptz NOT NULL,
    used_at    timestamptz,
    ip         text,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_otps_admin_idx ON email_otps (admin_id, created_at DESC);

-- códigos de recuperação de uso único (só o HMAC)
CREATE TABLE recovery_codes (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  uuid,
    admin_id   uuid NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    code_hash  text NOT NULL,
    used_at    timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX recovery_codes_admin_idx ON recovery_codes (admin_id);

-- "confiar neste navegador": pula o segundo fator por 30 dias (a senha continua sendo pedida)
CREATE TABLE trusted_devices (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    uuid,
    admin_id     uuid NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    token_hash   text NOT NULL UNIQUE,
    ip           text,
    user_agent   text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL
);
CREATE INDEX trusted_devices_admin_idx ON trusted_devices (admin_id);
