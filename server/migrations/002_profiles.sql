-- Fase 3: perfis de configuração e configuração desejada por aparelho.

CREATE TABLE profiles (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL UNIQUE,
    description text NOT NULL DEFAULT '',
    -- mesmo formato da configuração do app (docs/configuracao.md); PIN só como hash
    config      jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE devices
    ADD COLUMN profile_id       uuid REFERENCES profiles(id) ON DELETE SET NULL,
    -- ajustes só deste aparelho, mesclados por cima do perfil
    ADD COLUMN config_overrides jsonb,
    -- "reaplicar": muda o hash desejado mesmo sem mudar a configuração
    ADD COLUMN config_nonce     integer NOT NULL DEFAULT 0,
    -- resultado da última aplicação no aparelho
    ADD COLUMN applied_hash     text,
    ADD COLUMN apply_error      text,
    -- hash que falhou ao aplicar: não é reenviado (até mudar a configuração ou "reaplicar")
    ADD COLUMN failed_hash      text,
    ADD COLUMN apply_warnings   jsonb,
    ADD COLUMN applied_at       timestamptz;

CREATE INDEX devices_profile_idx ON devices (profile_id);

-- o código de cadastro pode levar um perfil: o aparelho cadastrado já recebe a configuração
ALTER TABLE enrollment_codes
    ADD COLUMN profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL;
