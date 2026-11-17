-- Fase 1.3c: passkeys (WebAuthn). Opcional por conta; várias por pessoa.
-- Só a chave pública é guardada. counter: contador do autenticador (voltar para trás = possível clone).
CREATE TABLE webauthn_credentials (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid,
  admin_id      uuid NOT NULL REFERENCES admins (id) ON DELETE CASCADE,
  credential_id text NOT NULL UNIQUE,
  public_key    bytea NOT NULL,
  counter       bigint NOT NULL DEFAULT 0,
  transports    text[],
  device_type   text,
  backed_up     boolean NOT NULL DEFAULT false,
  name          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz
);
CREATE INDEX webauthn_credentials_admin ON webauthn_credentials (admin_id);

-- Desafios de uso único (5 min). purpose: register (Conta), login (sem senha), mfa (etapa 2 do login).
CREATE TABLE webauthn_challenges (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid,
  purpose    text NOT NULL CHECK (purpose IN ('register', 'login', 'mfa')),
  admin_id   uuid REFERENCES admins (id) ON DELETE CASCADE,
  session_id uuid REFERENCES sessions (id) ON DELETE CASCADE,
  challenge  text NOT NULL,
  ip         text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX webauthn_challenges_expires ON webauthn_challenges (expires_at);
