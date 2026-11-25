-- Carga encerrada por falta de sinal (signal_lost, agora depois de 3 min): o motivo que o coletor avisou antes de
-- calar. 'tela_apagada' = o colaborador apagou a tela; 'desligado' = o coletor foi desligado; NULL = sem aviso
-- (queda de rede, bateria acabou, app travado).
ALTER TABLE ops_operations ADD COLUMN end_detail text CHECK (end_detail IS NULL OR end_detail IN ('tela_apagada', 'desligado'));
