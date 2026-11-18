-- Fase 2.4: piloto da leitura do SSW. Só os coletores marcados no painel leem a tela e mandam eventos.
ALTER TABLE devices ADD COLUMN ops_reader boolean NOT NULL DEFAULT false;
