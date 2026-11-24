-- Fase 3.2 (várias empresas, filtro na aplicação): a API passa a empresa em toda gravação. Sai o atalho da 3.1
-- ("sem empresa informada, vale a única que existe"): gravação sem empresa agora falha, mesmo com uma empresa só.
CREATE OR REPLACE FUNCTION tenant_fallback() RETURNS uuid LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

-- Coletor cadastrado com o código de outra empresa: vira um registro novo lá; o daqui fica marcado e o token antigo
-- deixa de valer (sem isso, o código de uma empresa "tomaria" o coletor de outra pelo serial).
ALTER TABLE devices ADD COLUMN transferred_at timestamptz;
