-- Fase 3.3 (várias empresas, RLS): segunda barreira, no banco, por baixo do filtro da API (3.2).
--
-- As requisições rodam com o papel restrito kiosk_app (SET ROLE na conexão; sem superusuário e sem BYPASSRLS) e com
-- a empresa da requisição em app.tenant_id. Nas tabelas de dados das empresas, a política só deixa ler e gravar
-- linhas dessa empresa: se faltar um "WHERE tenant_id = ..." numa consulta, o banco devolve só o da empresa (ou nada,
-- sem empresa) em vez de dados de outra. O papel dono (superusuário do contêiner) continua vendo tudo e é usado só
-- pelo "sistema": migrações, jobs de fundo, busca do coletor pelo token e rotas da plataforma (src/db.ts).
--
-- Fora do RLS (já presas ao usuário/sessão pelas rotas, e lidas antes de se saber a empresa no login): admins,
-- sessions, 2FA, passkeys, auth_events, auth_lockouts, upload_tokens, push_* e tenants.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kiosk_app') THEN
    CREATE ROLE kiosk_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
  END IF;
  -- quem conecta (o dono) precisa poder assumir o papel (superusuário já pode; um dono comum, não)
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    EXECUTE format('GRANT kiosk_app TO %I', current_user);
  END IF;
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO kiosk_app', current_schema());
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO kiosk_app', current_schema());
  EXECUTE format('GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA %I TO kiosk_app', current_schema());
  -- tabelas e sequências criadas por migrações futuras
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO kiosk_app', current_schema());
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO kiosk_app', current_schema());
  -- o controle de migrações é só do dono
  EXECUTE format('REVOKE ALL ON %I.schema_migrations FROM kiosk_app', current_schema());
END $$;

DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'devices', 'enrollment_codes', 'profiles', 'commands', 'screenshots', 'apps', 'app_versions',
    'ops_operations', 'ops_events', 'ops_device_state', 'ops_scans', 'ops_settings', 'privacy_erasures'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I TO kiosk_app
         USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)
         WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
      tbl);
  END LOOP;
END $$;
