-- Fase 4: comandos remotos, capturas de tela e repositório de apps.

-- Comando para um aparelho. Vai na resposta do check-in até o aparelho devolver o resultado (ou expirar).
CREATE TABLE commands (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id   uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    type        text NOT NULL,
    payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- pending: ainda não entregue · sent: entregue, sem resultado · ok/failed: resultado do aparelho ·
    -- expired: não foi entregue/concluído a tempo · canceled: cancelado no painel antes da entrega
    status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'ok', 'failed', 'expired', 'canceled')),
    message     text,
    output      jsonb,
    created_by  text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    sent_at     timestamptz,
    done_at     timestamptz,
    expires_at  timestamptz NOT NULL
);
CREATE INDEX commands_device_idx ON commands (device_id, created_at DESC);
CREATE INDEX commands_open_idx ON commands (device_id) WHERE status IN ('pending', 'sent');

-- Captura de tela enviada pelo aparelho (JPEG). Ficam só as últimas de cada aparelho.
CREATE TABLE screenshots (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id   uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    command_id  uuid REFERENCES commands(id) ON DELETE SET NULL,
    mime        text NOT NULL,
    width       integer,
    height      integer,
    data        bytea NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX screenshots_device_idx ON screenshots (device_id, created_at DESC);

-- Repositório de apps: um app (pacote) com várias versões. O APK fica em disco (APPS_DIR/<sha256>.apk).
CREATE TABLE apps (
    package_name        text PRIMARY KEY,
    label               text NOT NULL,
    -- todas as versões têm de ter a mesma assinatura (o Android recusa atualizar com outra)
    signing_cert_sha256 text NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_versions (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    package_name  text NOT NULL REFERENCES apps(package_name) ON DELETE CASCADE,
    version_code  bigint NOT NULL,
    version_name  text,
    min_sdk       integer,
    sha256        text NOT NULL,
    size_bytes    bigint NOT NULL,
    uploaded_by   text,
    uploaded_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (package_name, version_code)
);

-- Envio de APK direto do navegador para a API (o painel na Vercel não aceita arquivos grandes):
-- o painel pede um token de uso único e curto; o navegador manda o arquivo com ele.
CREATE TABLE upload_tokens (
    token_hash  text PRIMARY KEY,
    admin_id    uuid NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    expires_at  timestamptz NOT NULL,
    used_at     timestamptz
);

-- Apps que o perfil mantém instalados (sempre a versão mais nova do repositório): ["com.exemplo.app", ...]
ALTER TABLE profiles ADD COLUMN managed_apps jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE devices
    ADD COLUMN app_version_code integer,
    -- situação dos apps gerenciados informada pelo aparelho: {"com.x": {"versionCode": 5, "error": "...", "at": "..."}}
    ADD COLUMN managed_status   jsonb,
    -- última captura de tela
    ADD COLUMN last_screenshot_at timestamptz;
