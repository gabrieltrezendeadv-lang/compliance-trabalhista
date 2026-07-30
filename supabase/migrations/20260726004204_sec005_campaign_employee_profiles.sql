BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_campaign_recipients_campaign_user_channel'
  ) THEN
    ALTER TABLE public.campaign_recipients
      ADD CONSTRAINT uq_campaign_recipients_campaign_user_channel
      UNIQUE (campaign_id, user_id, channel);
  END IF;
EXCEPTION WHEN others THEN
  NULL;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_recipients_dedup
  ON public.campaign_recipients (campaign_id, user_id, channel)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_recipients_dedup_email
  ON public.campaign_recipients (campaign_id, email, channel)
  WHERE user_id IS NULL AND email IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_prepare_campaign_send(p_campaign_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $function$
DECLARE
  v_campaign    record;
  v_count       int := 0;
  v_lock_key    bigint;
  v_scope_keys  text[];
  v_valid_keys  text[] := ARRAY['establishment_ids', 'department_ids', 'roles'];
  v_key         text;
BEGIN
  v_lock_key := ('x' || left(replace(p_campaign_id::text, '-', ''), 15))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT c.id, c.tenant_id, c.status, c.channel, c.target_scope
  INTO v_campaign
  FROM public.campaigns c
  WHERE c.id = p_campaign_id AND c.deleted_at IS NULL;

  IF v_campaign IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'campaign_not_found');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.tenant_id = v_campaign.tenant_id
      AND om.user_id = auth.uid()
      AND om.role IN ('owner', 'admin', 'manager')
      AND om.deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'forbidden');
  END IF;

  IF v_campaign.status NOT IN ('draft', 'scheduled') THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_status');
  END IF;

  IF v_campaign.target_scope IS NOT NULL THEN
    SELECT array_agg(k) INTO v_scope_keys
    FROM jsonb_object_keys(v_campaign.target_scope) k;

    IF v_scope_keys IS NOT NULL THEN
      FOREACH v_key IN ARRAY v_scope_keys
      LOOP
        IF NOT (v_key = ANY(v_valid_keys)) THEN
          RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_target_scope_key',
                                   'detail', 'Unknown key: ' || v_key);
        END IF;
      END LOOP;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM public.campaign_recipients WHERE campaign_id = p_campaign_id LIMIT 1) THEN
    NULL;
  ELSE
    INSERT INTO public.campaign_recipients (
      campaign_id, tenant_id, user_id,
      full_name, email, phone,
      establishment_id, department_id,
      channel
    )
    SELECT
      p_campaign_id,
      ep.tenant_id,
      ep.user_id,
      ep.full_name,
      ep.email,
      ep.phone,
      ep.establishment_id,
      ep.department_id,
      v_campaign.channel
    FROM public.employee_profiles ep
    WHERE ep.tenant_id = v_campaign.tenant_id
      AND ep.deleted_at IS NULL
      AND ep.status = 'active'
      AND (
        (v_campaign.channel IN ('email', 'both') AND ep.email IS NOT NULL)
        OR
        (v_campaign.channel IN ('whatsapp', 'both') AND ep.phone IS NOT NULL)
        OR
        v_campaign.channel NOT IN ('email', 'whatsapp', 'both')
      )
      AND (
        v_campaign.target_scope IS NULL
        OR (
          (v_campaign.target_scope->>'establishment_ids' IS NULL
           OR ep.establishment_id::text IN (
             SELECT jsonb_array_elements_text(v_campaign.target_scope->'establishment_ids')
           ))
          AND
          (v_campaign.target_scope->>'department_ids' IS NULL
           OR ep.department_id::text IN (
             SELECT jsonb_array_elements_text(v_campaign.target_scope->'department_ids')
           ))
        )
      )
    ON CONFLICT DO NOTHING;
  END IF;

  INSERT INTO public.campaign_deliveries (
    campaign_id, recipient_id, channel, status
  )
  SELECT
    cr.campaign_id,
    cr.id,
    CASE
      WHEN cr.channel = 'both' THEN 'email'::public.delivery_channel
      ELSE cr.channel
    END,
    'pending'::public.delivery_status
  FROM public.campaign_recipients cr
  WHERE cr.campaign_id = p_campaign_id
    AND NOT EXISTS (
      SELECT 1 FROM public.campaign_deliveries cd
      WHERE cd.recipient_id = cr.id
        AND cd.channel = (CASE WHEN cr.channel = 'both' THEN 'email'::public.delivery_channel ELSE cr.channel END)
    );

  INSERT INTO public.campaign_deliveries (
    campaign_id, recipient_id, channel, status
  )
  SELECT
    cr.campaign_id,
    cr.id,
    'whatsapp'::public.delivery_channel,
    'pending'::public.delivery_status
  FROM public.campaign_recipients cr
  WHERE cr.campaign_id = p_campaign_id
    AND cr.channel = 'both'
    AND cr.phone IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.campaign_deliveries cd
      WHERE cd.recipient_id = cr.id AND cd.channel = 'whatsapp'
    );

  SELECT count(*) INTO v_count
  FROM public.campaign_recipients WHERE campaign_id = p_campaign_id;

  UPDATE public.campaigns
  SET status = 'sending',
      sent_at = now(),
      total_recipients = v_count
  WHERE id = p_campaign_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'total_recipients', v_count
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_prepare_campaign_send(uuid)
  TO authenticated, service_role;

COMMIT;
