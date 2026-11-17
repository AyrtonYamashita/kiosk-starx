-- Fase 1.3b: aplicativo autenticador (TOTP, RFC 6238). Opcional por conta.
-- A chave secreta fica criptografada (AES-256-GCM, chave derivada do AUTH_SECRET).
-- confirmed_at nulo: ativação iniciada e ainda não confirmada (não vale no login).
-- last_step: último passo de 30 s aceito (o mesmo código, ou um anterior, não vale de novo).
CREATE TABLE admin_totp (
  admin_id     uuid PRIMARY KEY REFERENCES admins (id) ON DELETE CASCADE,
  tenant_id    uuid,
  secret_enc   text NOT NULL,
  confirmed_at timestamptz,
  last_step    bigint,
  created_at   timestamptz NOT NULL DEFAULT now()
);
