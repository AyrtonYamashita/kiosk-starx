-- Anonimizações feitas a pedido do titular (LGPD, Art. 18). Guarda só o HMAC do identificador, nunca o identificador:
-- serve para reaplicar a anonimização se um backup anterior for restaurado (.lgpd/retention.md §3).
CREATE TABLE privacy_erasures (
  id           bigserial PRIMARY KEY,
  tenant_id    uuid,
  kind         text NOT NULL CHECK (kind IN ('ssw_user')),
  subject_hash text NOT NULL,
  created_by   uuid REFERENCES admins (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, subject_hash)
);
