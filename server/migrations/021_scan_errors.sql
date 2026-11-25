-- Erros de bipagem: a mensagem que o SSW mostrou na tela (janela "errormsg") quando recusou o código.
--   kind 'erro'  = o SSW recusou e mostrou uma mensagem (guardada em `error`, como apareceu);
--   error_key    = a mensagem normalizada (sem acento, minúsculas, números trocados por #): agrupa e filtra o mesmo
--                  tipo de erro mesmo quando o texto traz o número do CTRC, da nota etc.
ALTER TABLE ops_scans DROP CONSTRAINT ops_scans_kind_check;
ALTER TABLE ops_scans ADD CONSTRAINT ops_scans_kind_check CHECK (kind IN ('lido', 'outra', 'nao_contou', 'erro'));
ALTER TABLE ops_scans ADD COLUMN error text CHECK (error IS NULL OR length(error) BETWEEN 1 AND 300);
ALTER TABLE ops_scans ADD COLUMN error_key text CHECK (error_key IS NULL OR length(error_key) BETWEEN 1 AND 160);
CREATE INDEX ops_scans_errors ON ops_scans (tenant_id, at DESC) WHERE kind = 'erro';
CREATE INDEX ops_scans_error_key ON ops_scans (tenant_id, error_key, at DESC) WHERE kind = 'erro';

-- quantos erros a carga teve (card ao vivo, histórico)
ALTER TABLE ops_operations ADD COLUMN scan_errors integer NOT NULL DEFAULT 0;
