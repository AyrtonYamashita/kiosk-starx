-- Fase 2.2: acompanhamento de operações (leitura do SSW no coletor).
-- Eventos brutos (90 dias), operações (resumo, guardado sem prazo) e estado atual por coletor.

-- Último lote aceito (hora do aparelho corrigida): um lote só entra se for mais novo (reenvio capturado não entra).
ALTER TABLE devices ADD COLUMN ops_last_ts bigint NOT NULL DEFAULT 0;

-- Operação = uma descarga (função + placa) num coletor, do início ao fim.
CREATE TABLE ops_operations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid,
  device_id           uuid NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
  fn                  text NOT NULL CHECK (fn IN ('manifesto', 'coleta', 'romaneio')),
  plate               text NOT NULL,
  real_plate          text,
  units               text[] NOT NULL DEFAULT '{}',
  ssw_user            text,
  domain              text,
  branch              text,
  started_at          timestamptz NOT NULL,
  ended_at            timestamptz,
  end_reason          text CHECK (end_reason IN ('concluded', 'interrupted', 'left', 'replaced')),
  total_qty           numeric NOT NULL DEFAULT 0,
  total_kg            numeric NOT NULL DEFAULT 0,
  total_value         numeric NOT NULL DEFAULT 0,
  read_qty            numeric NOT NULL DEFAULT 0,
  read_kg             numeric NOT NULL DEFAULT 0,
  read_value          numeric NOT NULL DEFAULT 0,
  -- volumes bipados nesta sessão e intervalos entre bipagens (para o tempo médio por volume)
  scans               integer NOT NULL DEFAULT 0,
  first_scan_at       timestamptz,
  last_scan_at        timestamptz,
  scan_interval_sum_ms bigint NOT NULL DEFAULT 0,
  scan_interval_count integer NOT NULL DEFAULT 0,
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ops_operations_device ON ops_operations (device_id, started_at DESC);
CREATE UNIQUE INDEX ops_operations_open ON ops_operations (device_id) WHERE ended_at IS NULL;
CREATE INDEX ops_operations_started ON ops_operations (started_at DESC);

-- Eventos como chegaram (id gerado no coletor: o mesmo evento reenviado não entra duas vezes).
CREATE TABLE ops_events (
  id           uuid PRIMARY KEY,
  tenant_id    uuid,
  device_id    uuid NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
  operation_id uuid REFERENCES ops_operations (id) ON DELETE SET NULL,
  type         text NOT NULL,
  at           timestamptz NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now(),
  data         jsonb NOT NULL
);
CREATE INDEX ops_events_device_at ON ops_events (device_id, at);
CREATE INDEX ops_events_operation ON ops_events (operation_id, at) WHERE operation_id IS NOT NULL;
CREATE INDEX ops_events_received ON ops_events (received_at);

-- O que cada coletor está fazendo agora (os cards).
CREATE TABLE ops_device_state (
  device_id         uuid PRIMARY KEY REFERENCES devices (id) ON DELETE CASCADE,
  tenant_id         uuid,
  ssw_user          text,
  domain            text,
  branch            text,
  screen            text,
  operation_id      uuid REFERENCES ops_operations (id) ON DELETE SET NULL,
  last_event_at     timestamptz,
  last_heartbeat_at timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now()
);
