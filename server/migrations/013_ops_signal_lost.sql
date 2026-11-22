-- Carga encerrada pela API porque o coletor ficou sem sinal (desligado, sem bateria, fora da rede) com ela aberta.
ALTER TABLE ops_operations DROP CONSTRAINT IF EXISTS ops_operations_end_reason_check;
ALTER TABLE ops_operations ADD CONSTRAINT ops_operations_end_reason_check
  CHECK (end_reason IN ('concluded', 'interrupted', 'left', 'replaced', 'signal_lost'));

-- histórico de cargas: lista do mais novo para o mais antigo, com filtros por placa e usuário
CREATE INDEX IF NOT EXISTS ops_operations_started ON ops_operations (started_at DESC);
CREATE INDEX IF NOT EXISTS ops_operations_plate ON ops_operations (upper(plate) text_pattern_ops);
