-- Códigos de barras bipados (0.5.2): um registro por código lido na tela de bipagem, guardado 1 ano.
-- kind: lido (aumentou "Lidos"), outra ("Outras": volume de outra carga), nao_contou (repetido, erro...).
CREATE TABLE ops_scans (
  id           bigserial PRIMARY KEY,
  tenant_id    uuid,
  device_id    uuid NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
  operation_id uuid REFERENCES ops_operations (id) ON DELETE CASCADE,
  scan_id      text NOT NULL,
  at           timestamptz NOT NULL,
  code         text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('lido', 'outra', 'nao_contou')),
  read_qty     numeric,
  UNIQUE (device_id, scan_id)
);
CREATE INDEX ops_scans_code ON ops_scans (code text_pattern_ops);
CREATE INDEX ops_scans_operation ON ops_scans (operation_id, at);
CREATE INDEX ops_scans_at ON ops_scans (at);
