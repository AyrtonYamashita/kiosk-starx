-- Carga (carregamento) de manifesto, coleta e romaneio, além das descargas (achado no piloto: "Carga de Manifesto").
ALTER TABLE ops_operations DROP CONSTRAINT IF EXISTS ops_operations_fn_check;
ALTER TABLE ops_operations ADD CONSTRAINT ops_operations_fn_check
  CHECK (fn IN ('manifesto', 'coleta', 'romaneio', 'carga_manifesto', 'carga_coleta', 'carga_romaneio'));
