-- Fase 3.4 (painel da plataforma): "entrar como". A sessão de um usuário da plataforma guarda a empresa que ele está
-- vendo (suporte). A empresa da sessão (tenant_id) continua sendo a do usuário (nenhuma, para a plataforma).
ALTER TABLE sessions ADD COLUMN acting_tenant_id uuid REFERENCES tenants (id) ON DELETE SET NULL;
