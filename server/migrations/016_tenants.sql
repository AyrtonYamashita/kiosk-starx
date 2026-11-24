-- Fase 3.1 (várias empresas, base): tabela de empresas, todos os dados atuais na primeira empresa cliente
-- ("Alt Brasil"; a PStarX é a plataforma, não uma empresa), tenant_id
-- obrigatório e chaves únicas por empresa. Não muda o comportamento: enquanto existir uma empresa só, quem grava sem
-- informar a empresa cai nela (gatilhos abaixo). A 3.2 passa a empresa em todas as gravações e tira esse atalho.
-- Desenho: docs/multiempresa.md.

CREATE TABLE tenants (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name       text NOT NULL,
    -- apelido curto (minúsculas, números e hífen): aparece em URLs e logs
    slug       text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
    status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- instalação em uso (já tem usuários): os dados são da Alt Brasil. Instalação nova: empresa genérica, renomeável.
INSERT INTO tenants (name, slug)
SELECT * FROM (VALUES ('Alt Brasil', 'altbrasil')) v WHERE EXISTS (SELECT 1 FROM admins)
UNION ALL
SELECT * FROM (VALUES ('Empresa principal', 'principal')) v WHERE NOT EXISTS (SELECT 1 FROM admins);

-- ------------------------------------------------------------------------------------------------ preenchimento
-- Empresa de uma gravação sem tenant_id: a da requisição (app.tenant_id, usado a partir da 3.3) ou, na transição, a
-- única empresa existente. Com duas empresas e nada informado, devolve NULL e a gravação falha (NOT NULL).
CREATE FUNCTION tenant_fallback() RETURNS uuid LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT COALESCE(
    NULLIF(current_setting('app.tenant_id', true), '')::uuid,
    (SELECT min(id::text)::uuid FROM tenants HAVING count(*) = 1)
  )
$$;

-- Registros filhos herdam a empresa do pai (usuário ou coletor); os de topo usam tenant_fallback().
CREATE FUNCTION tenant_fill_root() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN NEW.tenant_id := tenant_fallback(); END IF;
  RETURN NEW;
END $$;

-- usuário: o da plataforma fica sem empresa
CREATE FUNCTION tenant_fill_admin() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF NEW.tenant_id IS NULL AND NOT NEW.platform THEN NEW.tenant_id := tenant_fallback(); END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION tenant_fill_from_admin() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF NEW.tenant_id IS NULL AND NEW.admin_id IS NOT NULL THEN
    NEW.tenant_id := (SELECT tenant_id FROM admins WHERE id = NEW.admin_id);
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION tenant_fill_from_device() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN NEW.tenant_id := (SELECT tenant_id FROM devices WHERE id = NEW.device_id); END IF;
  RETURN NEW;
END $$;

-- coletor: a empresa do código de cadastro
CREATE FUNCTION tenant_fill_device() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF NEW.tenant_id IS NULL AND NEW.enrollment_code_id IS NOT NULL THEN
    NEW.tenant_id := (SELECT tenant_id FROM enrollment_codes WHERE id = NEW.enrollment_code_id);
  END IF;
  IF NEW.tenant_id IS NULL THEN NEW.tenant_id := tenant_fallback(); END IF;
  RETURN NEW;
END $$;

-- anonimização: a empresa de quem pediu
CREATE FUNCTION tenant_fill_privacy() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF NEW.tenant_id IS NULL AND NEW.created_by IS NOT NULL THEN
    NEW.tenant_id := (SELECT tenant_id FROM admins WHERE id = NEW.created_by);
  END IF;
  IF NEW.tenant_id IS NULL THEN NEW.tenant_id := tenant_fallback(); END IF;
  RETURN NEW;
END $$;

-- toda empresa nova ganha a sua linha de ajustes da leitura do SSW
CREATE FUNCTION tenant_created() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  INSERT INTO ops_settings (tenant_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;

-- ------------------------------------------------------------------------------------------------ colunas novas
ALTER TABLE admins ADD COLUMN platform boolean NOT NULL DEFAULT false;
ALTER TABLE enrollment_codes ADD COLUMN tenant_id uuid;
ALTER TABLE devices ADD COLUMN tenant_id uuid;
ALTER TABLE profiles ADD COLUMN tenant_id uuid;
ALTER TABLE commands ADD COLUMN tenant_id uuid;
ALTER TABLE screenshots ADD COLUMN tenant_id uuid;
ALTER TABLE apps ADD COLUMN tenant_id uuid;
ALTER TABLE app_versions ADD COLUMN tenant_id uuid;
ALTER TABLE push_subscriptions ADD COLUMN tenant_id uuid;
ALTER TABLE push_prefs ADD COLUMN tenant_id uuid;

-- ------------------------------------------------------------------------------------------------ dados atuais → primeira empresa
-- Usuários da plataforma (PStarX: criam as empresas e dão suporte) ficam sem empresa. Os demais vão para a primeira.
-- Para marcar outro depois: UPDATE admins SET platform = true, tenant_id = NULL WHERE ... (e as tabelas filhas).
UPDATE admins SET platform = true WHERE lower(email) IN ('ayrtonyamashita@pstarx.com');

DO $$
DECLARE
  t uuid := (SELECT id FROM tenants);
  tbl text;
BEGIN
  UPDATE admins SET tenant_id = CASE WHEN platform THEN NULL ELSE t END;
  FOREACH tbl IN ARRAY ARRAY[
    'enrollment_codes', 'devices', 'profiles', 'commands', 'screenshots', 'apps', 'app_versions', 'ops_operations',
    'ops_events', 'ops_device_state', 'ops_scans', 'ops_settings', 'privacy_erasures'
  ] LOOP
    EXECUTE format('UPDATE %I SET tenant_id = $1 WHERE tenant_id IS NULL', tbl) USING t;
  END LOOP;
  -- ligados a um usuário: a empresa dele (nenhuma para a plataforma; desafio de login sem senha e auditoria de conta
  -- inexistente também ficam sem empresa)
  FOREACH tbl IN ARRAY ARRAY[
    'sessions', 'trusted_devices', 'recovery_codes', 'admin_totp', 'webauthn_credentials', 'email_otps',
    'push_subscriptions', 'push_prefs', 'webauthn_challenges', 'auth_events'
  ] LOOP
    EXECUTE format('UPDATE %I c SET tenant_id = a.tenant_id FROM admins a WHERE a.id = c.admin_id', tbl);
  END LOOP;
END $$;

-- ------------------------------------------------------------------------------------------------ obrigatório + chaves
-- tabelas de topo: NOT NULL, FK para a empresa e (tenant_id, id) único (alvo das FKs compostas abaixo)
ALTER TABLE admins
    -- usuário de empresa tem empresa; usuário da plataforma não tem
    ADD CONSTRAINT admins_tenant_or_platform CHECK (platform = (tenant_id IS NULL)),
    ADD CONSTRAINT admins_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
    ADD CONSTRAINT admins_tenant_id_key UNIQUE (tenant_id, id),
    -- nome de usuário único por empresa, e entre os da plataforma (o e-mail continua único no sistema todo)
    DROP CONSTRAINT admins_username_key,
    ADD CONSTRAINT admins_tenant_username_key UNIQUE NULLS NOT DISTINCT (tenant_id, username);

ALTER TABLE profiles
    ALTER COLUMN tenant_id SET NOT NULL,
    ADD CONSTRAINT profiles_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
    ADD CONSTRAINT profiles_tenant_id_key UNIQUE (tenant_id, id),
    DROP CONSTRAINT profiles_name_key,
    ADD CONSTRAINT profiles_tenant_name_key UNIQUE (tenant_id, name);

ALTER TABLE enrollment_codes
    ALTER COLUMN tenant_id SET NOT NULL,
    ADD CONSTRAINT enrollment_codes_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
    ADD CONSTRAINT enrollment_codes_tenant_id_key UNIQUE (tenant_id, id),
    -- o perfil do código é da mesma empresa
    DROP CONSTRAINT enrollment_codes_profile_id_fkey,
    ADD CONSTRAINT enrollment_codes_profile_fk FOREIGN KEY (tenant_id, profile_id) REFERENCES profiles (tenant_id, id) ON DELETE SET NULL (profile_id);

ALTER TABLE devices
    ALTER COLUMN tenant_id SET NOT NULL,
    ADD CONSTRAINT devices_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
    ADD CONSTRAINT devices_tenant_id_key UNIQUE (tenant_id, id),
    -- código de cadastro e perfil da mesma empresa do coletor
    DROP CONSTRAINT devices_enrollment_code_id_fkey,
    ADD CONSTRAINT devices_enrollment_code_fk FOREIGN KEY (tenant_id, enrollment_code_id) REFERENCES enrollment_codes (tenant_id, id) ON DELETE SET NULL (enrollment_code_id),
    DROP CONSTRAINT devices_profile_id_fkey,
    ADD CONSTRAINT devices_profile_fk FOREIGN KEY (tenant_id, profile_id) REFERENCES profiles (tenant_id, id) ON DELETE SET NULL (profile_id);
CREATE INDEX devices_tenant_serial_idx ON devices (tenant_id, serial);

-- repositório de apps por empresa: chave (tenant_id, package_name)
ALTER TABLE app_versions DROP CONSTRAINT app_versions_package_name_fkey;
ALTER TABLE app_versions DROP CONSTRAINT app_versions_package_name_version_code_key;
ALTER TABLE apps
    ALTER COLUMN tenant_id SET NOT NULL,
    ADD CONSTRAINT apps_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
    DROP CONSTRAINT apps_pkey,
    ADD PRIMARY KEY (tenant_id, package_name);
ALTER TABLE app_versions
    ALTER COLUMN tenant_id SET NOT NULL,
    ADD CONSTRAINT app_versions_app_fk FOREIGN KEY (tenant_id, package_name) REFERENCES apps (tenant_id, package_name) ON DELETE CASCADE,
    ADD CONSTRAINT app_versions_tenant_package_version_key UNIQUE (tenant_id, package_name, version_code);

-- ajustes da leitura do SSW: uma linha por empresa
ALTER TABLE ops_settings DROP CONSTRAINT ops_settings_pkey;
ALTER TABLE ops_settings DROP COLUMN id;
ALTER TABLE ops_settings
    ALTER COLUMN tenant_id SET NOT NULL,
    ADD PRIMARY KEY (tenant_id),
    ADD CONSTRAINT ops_settings_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE;

ALTER TABLE privacy_erasures
    ALTER COLUMN tenant_id SET NOT NULL,
    ADD CONSTRAINT privacy_erasures_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
    DROP CONSTRAINT privacy_erasures_kind_subject_hash_key,
    ADD CONSTRAINT privacy_erasures_tenant_kind_subject_key UNIQUE (tenant_id, kind, subject_hash);

-- filhos do usuário: a empresa do usuário (vazia para a plataforma). A FK simples para admins continua; a composta
-- garante que, com empresa, é a mesma do usuário.
DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['sessions', 'trusted_devices', 'recovery_codes', 'admin_totp', 'webauthn_credentials', 'email_otps', 'push_subscriptions', 'push_prefs'] LOOP
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (tenant_id, admin_id) REFERENCES admins (tenant_id, id) ON DELETE CASCADE', tbl, tbl || '_admin_fk');
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION tenant_fill_from_admin()', tbl || '_tenant', tbl);
  END LOOP;
END $$;

-- filhos do coletor: idem com o coletor
DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['commands', 'screenshots', 'ops_operations', 'ops_events', 'ops_device_state', 'ops_scans'] LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN tenant_id SET NOT NULL', tbl);
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', tbl, tbl || '_device_id_fkey');
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (tenant_id, device_id) REFERENCES devices (tenant_id, id) ON DELETE CASCADE', tbl, tbl || '_device_fk');
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION tenant_fill_from_device()', tbl || '_tenant', tbl);
  END LOOP;
END $$;
CREATE INDEX ops_operations_tenant_started ON ops_operations (tenant_id, started_at DESC);

-- sem empresa quando não há usuário (login sem senha; conta inexistente): ficam só para a plataforma
ALTER TABLE webauthn_challenges ADD CONSTRAINT webauthn_challenges_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE;
CREATE TRIGGER webauthn_challenges_tenant BEFORE INSERT ON webauthn_challenges FOR EACH ROW EXECUTE FUNCTION tenant_fill_from_admin();
ALTER TABLE auth_events ADD CONSTRAINT auth_events_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE;
CREATE TRIGGER auth_events_tenant BEFORE INSERT ON auth_events FOR EACH ROW EXECUTE FUNCTION tenant_fill_from_admin();
CREATE INDEX auth_events_tenant_created_idx ON auth_events (tenant_id, created_at DESC);

-- gatilhos das tabelas de topo
CREATE TRIGGER admins_tenant BEFORE INSERT ON admins FOR EACH ROW EXECUTE FUNCTION tenant_fill_admin();
CREATE TRIGGER profiles_tenant BEFORE INSERT ON profiles FOR EACH ROW EXECUTE FUNCTION tenant_fill_root();
CREATE TRIGGER enrollment_codes_tenant BEFORE INSERT ON enrollment_codes FOR EACH ROW EXECUTE FUNCTION tenant_fill_root();
CREATE TRIGGER apps_tenant BEFORE INSERT ON apps FOR EACH ROW EXECUTE FUNCTION tenant_fill_root();
CREATE TRIGGER app_versions_tenant BEFORE INSERT ON app_versions FOR EACH ROW EXECUTE FUNCTION tenant_fill_root();
CREATE TRIGGER ops_settings_tenant BEFORE INSERT ON ops_settings FOR EACH ROW EXECUTE FUNCTION tenant_fill_root();
CREATE TRIGGER devices_tenant BEFORE INSERT ON devices FOR EACH ROW EXECUTE FUNCTION tenant_fill_device();
CREATE TRIGGER privacy_erasures_tenant BEFORE INSERT ON privacy_erasures FOR EACH ROW EXECUTE FUNCTION tenant_fill_privacy();
CREATE TRIGGER tenants_created AFTER INSERT ON tenants FOR EACH ROW EXECUTE FUNCTION tenant_created();
