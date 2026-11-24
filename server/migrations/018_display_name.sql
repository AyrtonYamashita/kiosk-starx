-- Nome de exibição do usuário do painel ("Ayrton Yamashita"). O nome de usuário continua sendo o login (sem espaços).
ALTER TABLE admins ADD COLUMN display_name text CHECK (display_name IS NULL OR char_length(display_name) BETWEEN 1 AND 80);
