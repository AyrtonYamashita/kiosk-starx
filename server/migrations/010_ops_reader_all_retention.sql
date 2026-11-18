-- Leitura do SSW em todos os coletores (chave geral) e limpeza dos eventos antigos (fase 2.5).

-- Chave geral: uma linha por instalação (na fase 3, uma por tenant).
CREATE TABLE ops_settings (
  id          boolean PRIMARY KEY DEFAULT true CHECK (id),
  tenant_id   uuid,
  reader_all  boolean NOT NULL DEFAULT false,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO ops_settings DEFAULT VALUES;

-- Por coletor: NULL = segue a chave geral; true/false = escolhido no próprio coletor.
-- O "false" da 2.4 era só o padrão (ninguém escolheu), então passa a seguir a chave geral.
ALTER TABLE devices ALTER COLUMN ops_reader DROP NOT NULL, ALTER COLUMN ops_reader DROP DEFAULT;
UPDATE devices SET ops_reader = NULL WHERE ops_reader = false;

-- Gráfico das bipagens guardado na carga antes de apagar os eventos dela: [[at_ms, lidos], ...]
ALTER TABLE ops_operations ADD COLUMN scan_curve jsonb;
