-- ============================================================================
-- Migration: Campanhas — Funções SECURITY DEFINER
-- Todas com SET search_path = '' (defense-in-depth)
-- ============================================================================

-- ============================================================================
-- fn_get_campaign_stats: Estatísticas de entrega de uma campanha
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_get_campaign_stats(
  p_campaign_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_tenant_id UUID;
  v_stats     JSONB;
  v_by_status JSONB;
  v_by_channel JSONB;
  v_total_recipients INT;
  v_total_acknowledged INT;
BEGIN
  -- 1. Verificar permissão
  SELECT c.tenant_id INTO v_tenant_id
  FROM public.campaigns c
  WHERE c.id = p_campaign_id AND c.deleted_at IS NULL;

  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'not_found');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.tenant_id = v_tenant_id
      AND om.user_id = auth.uid()
      AND om.role IN ('owner', 'admin', 'manager', 'auditor')
      AND om.deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'forbidden');
  END IF;

  -- 2. Contagem por status de delivery
  SELECT COALESCE(jsonb_object_agg(status, cnt), '{}'::jsonb)
  INTO v_by_status
  FROM (
    SELECT d.status::text AS status, count(*) AS cnt
    FROM public.campaign_deliveries d
    WHERE d.campaign_id = p_campaign_id
    GROUP BY d.status
  ) sub;

  -- 3. Contagem por canal
  SELECT COALESCE(jsonb_object_agg(channel, cnt), '{}'::jsonb)
  INTO v_by_channel
  FROM (
    SELECT d.channel::text AS channel, count(*) AS cnt
    FROM public.campaign_deliveries d
    WHERE d.campaign_id = p_campaign_id
    GROUP BY d.channel
  ) sub;

  -- 4. Total de recipients
  SELECT count(*) INTO v_total_recipients
  FROM public.campaign_recipients cr
  WHERE cr.campaign_id = p_campaign_id;

  -- 5. Total de acknowledgments
  SELECT count(*) INTO v_total_acknowledged
  FROM public.campaign_acknowledgments ca
  WHERE ca.campaign_id = p_campaign_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'total_recipients', v_total_recipients,
    'total_acknowledged', v_total_acknowledged,
    'by_status', v_by_status,
    'by_channel', v_by_channel
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_campaign_stats(UUID) TO authenticated;


-- ============================================================================
-- fn_record_delivery_event: Registra evento de entrega do provedor (webhook)
-- Chamada por edge function que processa webhooks do Resend/WhatsApp.
-- Idempotente: mesma idempotency_key não gera duplicata.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_record_delivery_event(
  p_delivery_id     UUID,
  p_new_status      TEXT,
  p_provider_id     TEXT DEFAULT NULL,
  p_error_code      TEXT DEFAULT NULL,
  p_error_message   TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_current_status TEXT;
  v_campaign_id    UUID;
BEGIN
  -- 1. Buscar delivery atual
  SELECT d.status::text, d.campaign_id
  INTO v_current_status, v_campaign_id
  FROM public.campaign_deliveries d
  WHERE d.id = p_delivery_id;

  IF v_current_status IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'delivery_not_found');
  END IF;

  -- 2. Idempotência: não regredir status
  -- Ordem de progresso: pending → queued → sent → delivered → read
  -- Estados terminais: failed, bounced, rejected
  IF v_current_status IN ('delivered', 'read') AND p_new_status IN ('pending', 'queued', 'sent') THEN
    -- Não regredir
    RETURN jsonb_build_object('success', TRUE, 'skipped', TRUE, 'reason', 'status_already_advanced');
  END IF;

  -- 3. Atualizar delivery
  UPDATE public.campaign_deliveries
  SET status = p_new_status::public.delivery_status,
      provider_id = COALESCE(p_provider_id, provider_id),
      queued_at = CASE WHEN p_new_status = 'queued' AND queued_at IS NULL THEN now() ELSE queued_at END,
      sent_at = CASE WHEN p_new_status = 'sent' AND sent_at IS NULL THEN now() ELSE sent_at END,
      delivered_at = CASE WHEN p_new_status = 'delivered' AND delivered_at IS NULL THEN now() ELSE delivered_at END,
      read_at = CASE WHEN p_new_status = 'read' AND read_at IS NULL THEN now() ELSE read_at END,
      failed_at = CASE WHEN p_new_status IN ('failed', 'bounced', 'rejected') AND failed_at IS NULL THEN now() ELSE failed_at END,
      error_code = COALESCE(p_error_code, error_code),
      error_message = COALESCE(p_error_message, error_message)
  WHERE id = p_delivery_id;

  -- 4. Verificar se todas as deliveries da campanha estão finalizadas
  IF NOT EXISTS (
    SELECT 1 FROM public.campaign_deliveries d
    WHERE d.campaign_id = v_campaign_id
      AND d.status IN ('pending', 'queued', 'sent')
  ) THEN
    -- Todas finalizadas → marcar campanha como sent
    UPDATE public.campaigns
    SET status = 'sent',
        completed_at = now()
    WHERE id = v_campaign_id
      AND status = 'sending';
  END IF;

  RETURN jsonb_build_object('success', TRUE, 'old_status', v_current_status, 'new_status', p_new_status);
END;
$$;

-- Executável por service_role (webhooks via edge function)
GRANT EXECUTE ON FUNCTION public.fn_record_delivery_event(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;


-- ============================================================================
-- fn_prepare_campaign_send: Prepara campanha para envio
-- Resolve destinatários, cria registros de delivery, congela conteúdo.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_prepare_campaign_send(
  p_campaign_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_campaign    RECORD;
  v_recipient   RECORD;
  v_count       INT := 0;
BEGIN
  -- 1. Buscar e validar campanha
  SELECT c.id, c.tenant_id, c.status, c.channel, c.target_scope
  INTO v_campaign
  FROM public.campaigns c
  WHERE c.id = p_campaign_id AND c.deleted_at IS NULL;

  IF v_campaign IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'campaign_not_found');
  END IF;

  -- Verificar permissão
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.tenant_id = v_campaign.tenant_id
      AND om.user_id = auth.uid()
      AND om.role IN ('owner', 'admin', 'manager')
      AND om.deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'forbidden');
  END IF;

  -- Só pode enviar rascunho ou agendada
  IF v_campaign.status NOT IN ('draft', 'scheduled') THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_status');
  END IF;

  -- 2. Verificar se já há recipients (evitar duplicação)
  IF EXISTS (SELECT 1 FROM public.campaign_recipients WHERE campaign_id = p_campaign_id LIMIT 1) THEN
    -- Já preparada — pular resolução de destinatários
    NULL;
  ELSE
    -- 3. Resolver destinatários a partir de organization_members
    -- (colaboradores do tenant, filtrados por target_scope se presente)
    FOR v_recipient IN
      SELECT
        om.user_id,
        COALESCE(p.full_name, p.email, 'Colaborador') AS full_name,
        p.email,
        p.phone,
        om.establishment_id,
        om.department_id
      FROM public.organization_members om
      LEFT JOIN public.profiles p ON p.id = om.user_id
      WHERE om.tenant_id = v_campaign.tenant_id
        AND om.deleted_at IS NULL
        AND om.role IN ('collaborator', 'manager')  -- destinatários típicos
        -- Filtro por escopo (se definido)
        AND (
          v_campaign.target_scope IS NULL
          OR (
            (v_campaign.target_scope->>'establishment_ids' IS NULL
             OR om.establishment_id::text IN (
               SELECT jsonb_array_elements_text(v_campaign.target_scope->'establishment_ids')
             ))
            AND
            (v_campaign.target_scope->>'department_ids' IS NULL
             OR om.department_id::text IN (
               SELECT jsonb_array_elements_text(v_campaign.target_scope->'department_ids')
             ))
          )
        )
    LOOP
      -- Inserir recipient
      INSERT INTO public.campaign_recipients (
        campaign_id, tenant_id, user_id,
        full_name, email, phone,
        establishment_id, department_id,
        channel
      ) VALUES (
        p_campaign_id, v_campaign.tenant_id, v_recipient.user_id,
        v_recipient.full_name, v_recipient.email, v_recipient.phone,
        v_recipient.establishment_id, v_recipient.department_id,
        v_campaign.channel
      );

      v_count := v_count + 1;
    END LOOP;
  END IF;

  -- 4. Criar registros de delivery para cada recipient + canal
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
    );

  -- Para canal 'both', adicionar também WhatsApp
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

  -- 5. Atualizar campanha
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
$$;

GRANT EXECUTE ON FUNCTION public.fn_prepare_campaign_send(UUID) TO authenticated;
