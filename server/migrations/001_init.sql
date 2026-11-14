-- Fase 2: administradores, sessões, códigos de cadastro e aparelhos.

CREATE TABLE admins (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    username      text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- Sessão do painel: o token só existe no cookie (httpOnly) do painel; aqui fica o SHA-256.
CREATE TABLE sessions (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id     uuid NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    token_hash   text NOT NULL UNIQUE,
    created_at   timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL,
    last_used_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

-- Código de cadastro: vai no QR (ou é digitado / passado por ADB). Pode ter limite de usos e validade.
CREATE TABLE enrollment_codes (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code           text NOT NULL UNIQUE,
    name           text NOT NULL,
    -- configuração inicial do kiosk (mesmo formato do app), opcional; vai nos extras do QR
    initial_config jsonb,
    max_uses       integer,
    uses           integer NOT NULL DEFAULT 0,
    expires_at     timestamptz,
    revoked_at     timestamptz,
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE devices (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name               text NOT NULL,
    -- SHA-256 do token do aparelho (o token em si só existe no aparelho)
    token_hash         text NOT NULL UNIQUE,
    enrollment_code_id uuid REFERENCES enrollment_codes(id) ON DELETE SET NULL,
    enrolled_at        timestamptz NOT NULL DEFAULT now(),
    last_seen_at       timestamptz,
    last_ip            text,
    -- campos de busca/listagem, extraídos do info
    serial             text,
    manufacturer       text,
    model              text,
    android_version    text,
    app_version        text,
    -- último check-in (status leve) e último inventário completo
    status             jsonb,
    info               jsonb,
    info_updated_at    timestamptz,
    apps               jsonb,
    apps_hash          text,
    apps_updated_at    timestamptz,
    -- configuração do kiosk como está no aparelho (sem o hash do PIN)
    config             jsonb,
    config_revision    integer,
    config_source      text,
    config_updated_at  timestamptz
);
CREATE INDEX devices_serial_idx ON devices (serial);
