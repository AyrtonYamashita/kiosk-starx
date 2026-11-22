-- Ciência do aviso de privacidade no coletor (app 0.5.4): quem tocou em "Entendi", quando e em qual versão do texto
-- (HMAC/hash do texto). Prova para o cliente (controlador) de que informou os colaboradores. Guardado 1 ano.
CREATE TABLE privacy_acks (
  id              bigserial PRIMARY KEY,
  tenant_id       uuid,
  device_id       uuid NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
  notice_hash     text NOT NULL,
  -- usuário do SSW no coletor naquele momento (com a leitura do SSW ligada); NULL se desconhecido
  ssw_user        text,
  acknowledged_at timestamptz NOT NULL,
  received_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (device_id, notice_hash)
);
CREATE INDEX privacy_acks_user ON privacy_acks (ssw_user) WHERE ssw_user IS NOT NULL;
