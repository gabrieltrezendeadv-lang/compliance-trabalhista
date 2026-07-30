
-- Webhook Events — audit trail de todos os webhooks recebidos
CREATE TABLE IF NOT EXISTS public.webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  event_id text NOT NULL,
  provider_message_id text,
  event_type text NOT NULL,
  delivery_id uuid REFERENCES public.campaign_deliveries(id),
  campaign_id uuid REFERENCES public.campaigns(id),
  payload jsonb NOT NULL DEFAULT '{}',
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Índices para busca
CREATE INDEX idx_webhook_events_provider ON public.webhook_events(provider);
CREATE INDEX idx_webhook_events_delivery_id ON public.webhook_events(delivery_id);
CREATE INDEX idx_webhook_events_event_id ON public.webhook_events(event_id);
CREATE INDEX idx_webhook_events_received_at ON public.webhook_events(received_at);

-- RLS: apenas service role acessa (webhooks são processados server-side)
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

-- Comentário
COMMENT ON TABLE public.webhook_events IS 'Audit trail de webhooks recebidos dos provedores de envio (Resend, WhatsApp). Acessível apenas via service role.';
