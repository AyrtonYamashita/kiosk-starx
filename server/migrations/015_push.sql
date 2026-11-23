-- Notificações no celular (Web Push): cada aparelho/navegador inscrito por um usuário do painel. O endpoint é o
-- endereço do serviço de push do navegador (Google, Apple, Mozilla...); p256dh e auth cifram o conteúdo para ele.
CREATE TABLE push_subscriptions (
  id           bigserial PRIMARY KEY,
  admin_id     uuid NOT NULL REFERENCES admins (id) ON DELETE CASCADE,
  endpoint     text NOT NULL UNIQUE,
  p256dh       text NOT NULL,
  auth         text NOT NULL,
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_sent_at timestamptz,
  failures     integer NOT NULL DEFAULT 0
);
CREATE INDEX push_subscriptions_admin_idx ON push_subscriptions (admin_id);

-- Eventos que cada usuário quer receber (vale para todos os aparelhos dele). Sem linha: os três.
CREATE TABLE push_prefs (
  admin_id   uuid PRIMARY KEY REFERENCES admins (id) ON DELETE CASCADE,
  events     text[] NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
