-- 1. Captura da tela com o alerta de erro grave na bipagem (app 0.5.6+): uma por bipagem (o mesmo scan_id do
--    registro em ops_scans, que pode chegar antes ou depois da imagem).
CREATE TABLE ops_scan_shots (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL,
  device_id  uuid NOT NULL,
  scan_id    text NOT NULL CHECK (scan_id ~ '^[a-z0-9]{6,40}$'),
  mime       text NOT NULL,
  width      integer,
  height     integer,
  data       bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (device_id, scan_id),
  CONSTRAINT ops_scan_shots_device_fk FOREIGN KEY (tenant_id, device_id) REFERENCES devices (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX ops_scan_shots_created ON ops_scan_shots (created_at);
CREATE TRIGGER ops_scan_shots_tenant BEFORE INSERT ON ops_scan_shots FOR EACH ROW EXECUTE FUNCTION tenant_fill_from_device();
ALTER TABLE ops_scan_shots ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ops_scan_shots TO kiosk_app
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- 2. Coletor piloto: recebe primeiro as versões novas do app do kiosk e do leitor do SSW.
ALTER TABLE devices ADD COLUMN pilot boolean NOT NULL DEFAULT false;

-- 3. Versões do app do kiosk (um app só para todas as empresas: tabelas da plataforma, sem empresa). Notas e
--    "pode voltar" vêm do próprio APK (assets/release-notes.json).
CREATE TABLE kiosk_versions (
  version_code       integer PRIMARY KEY,
  version_name       text NOT NULL,
  file               text NOT NULL,
  sha256             text NOT NULL,
  size_bytes         bigint NOT NULL,
  signature_checksum text NOT NULL,
  notes              jsonb NOT NULL DEFAULT '[]'::jsonb,
  reversible         boolean,
  reversible_note    text,
  uploaded_by        text,
  uploaded_at        timestamptz NOT NULL DEFAULT now()
);

-- leitores do SSW que a API já trouxe (cada deploy pode trazer um novo; ele só chega aos coletores ao ser publicado)
CREATE TABLE reader_versions (
  sha256        text PRIMARY KEY,
  version       text,
  body          text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now()
);

-- o que cada grupo recebe: "all" (todos) e "pilot" (só os pilotos; sem linha = os pilotos seguem "all")
CREATE TABLE release_channels (
  kind       text NOT NULL CHECK (kind IN ('kiosk', 'reader')),
  channel    text NOT NULL CHECK (channel IN ('pilot', 'all')),
  ref        text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  PRIMARY KEY (kind, channel)
);

-- publicações agendadas (aplicadas pela API na hora marcada)
CREATE TABLE release_schedules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL CHECK (kind IN ('kiosk', 'reader')),
  channel     text NOT NULL CHECK (channel IN ('pilot', 'all')),
  ref         text NOT NULL,
  run_at      timestamptz NOT NULL,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  done_at     timestamptz,
  canceled_at timestamptz,
  result      text
);
CREATE INDEX release_schedules_due ON release_schedules (run_at) WHERE done_at IS NULL AND canceled_at IS NULL;
