BEGIN;

DROP INDEX IF EXISTS public.idx_webhook_events_event_id;
CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_events_event_id_unique
  ON public.webhook_events (event_id);

CREATE INDEX IF NOT EXISTS idx_campaign_deliveries_provider_id
  ON public.campaign_deliveries (provider_id)
  WHERE provider_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_process_webhook_event(
  p_provider text,
  p_event_id text,
  p_provider_message_id text,
  p_event_type text,
  p_new_status text,
  p_error_code text DEFAULT NULL,
  p_error_message text DEFAULT NULL,
  p_timestamp timestamptz DEFAULT now(),
  p_metadata jsonb DEFAULT '{}'::jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $function$
DECLARE
  v_delivery      record;
  v_status_order  text[] := ARRAY['pending', 'queued', 'sent', 'delivered', 'read'];
  v_terminal      text[] := ARRAY['failed', 'bounced', 'rejected'];
  v_current_idx   int;
  v_new_idx       int;
  v_is_terminal   boolean;
  v_webhook_id    uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.webhook_events
    WHERE event_id = p_event_id
  ) THEN
    RETURN jsonb_build_object('success', TRUE, 'skipped', TRUE, 'reason', 'duplicate_event');
  END IF;

  IF p_new_status IS NULL THEN
    RETURN jsonb_build_object('success', TRUE, 'skipped', TRUE, 'reason', 'unknown_event_type');
  END IF;

  SELECT d.id, d.campaign_id, d.status::text AS status
  INTO v_delivery
  FROM public.campaign_deliveries d
  WHERE d.provider_id = p_provider_message_id
  LIMIT 1
  FOR UPDATE;

  IF v_delivery IS NULL THEN
    INSERT INTO public.webhook_events (
      provider, event_id, provider_message_id, event_type,
      delivery_id, campaign_id, payload, received_at
    ) VALUES (
      p_provider, p_event_id, p_provider_message_id, p_event_type,
      NULL, NULL, p_metadata, p_timestamp
    ) ON CONFLICT (event_id) DO NOTHING;

    RETURN jsonb_build_object('success', TRUE, 'skipped', TRUE, 'reason', 'delivery_not_found');
  END IF;

  v_current_idx := array_position(v_status_order, v_delivery.status);
  v_new_idx := array_position(v_status_order, p_new_status);
  v_is_terminal := p_new_status = ANY(v_terminal);

  IF v_is_terminal OR (v_new_idx IS NOT NULL AND (v_current_idx IS NULL OR v_new_idx > v_current_idx)) THEN
    UPDATE public.campaign_deliveries
    SET status = p_new_status::public.delivery_status,
        delivered_at = CASE WHEN p_new_status = 'delivered' AND delivered_at IS NULL THEN p_timestamp ELSE delivered_at END,
        read_at = CASE WHEN p_new_status = 'read' AND read_at IS NULL THEN p_timestamp ELSE read_at END,
        failed_at = CASE WHEN p_new_status = ANY(v_terminal) AND failed_at IS NULL THEN p_timestamp ELSE failed_at END,
        error_code = CASE WHEN p_new_status = ANY(v_terminal) THEN COALESCE(p_error_code, error_code) ELSE error_code END,
        error_message = CASE WHEN p_new_status = ANY(v_terminal) THEN COALESCE(p_error_message, error_message) ELSE error_message END,
        updated_at = now()
    WHERE id = v_delivery.id;
  END IF;

  INSERT INTO public.webhook_events (
    provider, event_id, provider_message_id, event_type,
    delivery_id, campaign_id, payload, received_at
  ) VALUES (
    p_provider, p_event_id, p_provider_message_id, p_event_type,
    v_delivery.id, v_delivery.campaign_id,
    p_metadata,
    p_timestamp
  ) ON CONFLICT (event_id) DO NOTHING;

  IF NOT EXISTS (
    SELECT 1 FROM public.campaign_deliveries d
    WHERE d.campaign_id = v_delivery.campaign_id
      AND d.status IN ('pending', 'queued', 'sent')
  ) THEN
    UPDATE public.campaigns
    SET status = 'sent',
        completed_at = now()
    WHERE id = v_delivery.campaign_id
      AND status = 'sending';
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'delivery_id', v_delivery.id,
    'old_status', v_delivery.status,
    'new_status', p_new_status
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_process_webhook_event(text, text, text, text, text, text, text, timestamptz, jsonb)
  TO service_role;

COMMIT;
