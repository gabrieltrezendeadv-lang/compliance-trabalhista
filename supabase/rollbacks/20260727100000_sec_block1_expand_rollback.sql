-- =============================================================================
-- ROLLBACK: SEC-BLOCK1-CONSOLIDATION v1.2.2 — EXPAND PHASE
-- Reverte a fase EXPAND, restaurando o estado pre-EXPAND.
--
-- Estado pre-EXPAND = SEC-001..SEC-006 + HOTFIX-1 + HOTFIX-2 aplicados.
--
-- HOTFIX-1 (fn_submit_complaint):
--   - PIN min 4 (nao 6)
--   - Enum casts: p_category::public.complaint_category,
--                 'medium'::public.complaint_severity
--   - Sem validacao numerica (adicionada apenas no EXPAND)
--
-- HOTFIX-2 (fn_send_reporter_message):
--   - Status de rejeicao: 'resolved', 'dismissed' (nao 'closed', 'archived')
--
-- Escopo:
--   1. DROP fn_check_pin_rate_limit_v2 (nova)
--   2. DROP fn_record_pin_failure (nova)
--   3. DROP fn_access_complaint_v2 (nova)
--   4. DROP fn_send_reporter_message_v2 (nova)
--   5. DROP check_plan_limit(uuid, text) (overload nova)
--   6. Restaura fn_submit_complaint ao corpo HOTFIX-1
--   7. Restaura check_plan_limit(text) ao corpo SEC-002
--   8. Restaura fn_remove_member ao corpo SEC-004
--   9. Restaura fn_get_complaint_list (3-arg) ao corpo SEC-003
--  10. Restaura fn_get_complaint_list (4-arg) ao corpo original
--  11. Restaura fn_prepare_campaign_send ao corpo SEC-005
--  12. DROP index idx_pin_attempts_ip_hash_time
--
-- Funcoes antigas (fn_access_complaint, fn_send_reporter_message,
-- fn_check_pin_rate_limit) NAO sao tocadas — permaneceram intactas no EXPAND.
--
-- IMPORTANTE: Execute somente se o EXPAND foi aplicado e o CONTRACT NAO.
-- =============================================================================

BEGIN;

-- Safety check: confirma que o EXPAND foi aplicado
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'fn_access_complaint_v2'
  ) THEN
    RAISE EXCEPTION 'ROLLBACK ABORTED: fn_access_complaint_v2 nao encontrada. '
      'O EXPAND nao parece ter sido aplicado.';
  END IF;

  -- Confirmar que o CONTRACT NAO foi aplicado (funcoes antigas devem existir)
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'fn_access_complaint'
      AND array_length(p.proargtypes, 1) = 2
  ) THEN
    RAISE EXCEPTION 'ROLLBACK ABORTED: fn_access_complaint(text,text) nao encontrada. '
      'O CONTRACT parece ter sido aplicado. Use o rollback do CONTRACT primeiro.';
  END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. DROP funcoes _v2
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.fn_access_complaint_v2(text, text, text);
DROP FUNCTION IF EXISTS public.fn_send_reporter_message_v2(text, text, text, text);
DROP FUNCTION IF EXISTS public.fn_check_pin_rate_limit_v2(text, text, integer, integer, integer);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. DROP funcoes novas sem predecessora
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.fn_record_pin_failure(text, text);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. DROP overload nova de check_plan_limit
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.check_plan_limit(uuid, text);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. DROP index de ip_hash
-- ─────────────────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS public.idx_pin_attempts_ip_hash_time;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Restaura fn_submit_complaint ao corpo HOTFIX-1
--    Origem: SEC-003 + HOTFIX-1 (enum casts + PIN min 4)
--    Diferenca vs EXPAND: PIN min 4 (nao 6), sem validacao numerica,
--                         enum casts preservados
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_submit_complaint(
  p_tenant_slug text,
  p_subject text,
  p_description text,
  p_category text,
  p_is_anonymous boolean,
  p_reporter_name text DEFAULT NULL,
  p_reporter_email text DEFAULT NULL,
  p_reporter_phone text DEFAULT NULL,
  p_establishment_name text DEFAULT NULL,
  p_department_name text DEFAULT NULL,
  p_pin_hash text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_tenant_id    uuid;
  v_complaint_id uuid;
  v_protocol     text;
  v_bcrypt_hash  text;
BEGIN
  -- HOTFIX-1: PIN minimo 4 (legado aceito)
  IF p_pin_hash IS NULL OR length(p_pin_hash) < 4 OR length(p_pin_hash) > 32 THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_pin_length');
  END IF;

  SELECT id INTO v_tenant_id
  FROM public.organizations
  WHERE slug = p_tenant_slug AND deleted_at IS NULL;

  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_tenant');
  END IF;

  v_protocol := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  v_bcrypt_hash := extensions.crypt(p_pin_hash, extensions.gen_salt('bf', 10));

  -- HOTFIX-1: Enum casts explícitos para evitar erro de tipo
  INSERT INTO public.complaints (
    id, tenant_id, protocol, category, severity, is_anonymous, pin_hash
  ) VALUES (
    gen_random_uuid(), v_tenant_id, v_protocol,
    p_category::public.complaint_category,
    'medium'::public.complaint_severity,
    p_is_anonymous, v_bcrypt_hash
  ) RETURNING id INTO v_complaint_id;

  INSERT INTO public.complaint_contents (
    complaint_id, subject, description,
    reporter_name, reporter_email, reporter_phone,
    establishment_name, department_name
  ) VALUES (
    v_complaint_id, p_subject, p_description,
    CASE WHEN p_is_anonymous THEN NULL ELSE p_reporter_name END,
    CASE WHEN p_is_anonymous THEN NULL ELSE p_reporter_email END,
    CASE WHEN p_is_anonymous THEN NULL ELSE p_reporter_phone END,
    p_establishment_name, p_department_name
  );

  INSERT INTO public.complaint_audit_log (
    complaint_id, action, details
  ) VALUES (
    v_complaint_id, 'created',
    jsonb_build_object('category', p_category, 'is_anonymous', p_is_anonymous)
  );

  RETURN jsonb_build_object('success', TRUE, 'protocol', v_protocol);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_submit_complaint(text,text,text,text,boolean,text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_submit_complaint(text,text,text,text,boolean,text,text,text,text,text,text)
  TO anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Restaura check_plan_limit(text) ao corpo SEC-002
--    Origem: SEC-002 (sem multi-org check, sem delegacao)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_plan_limit(p_metric text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_tenant_id  uuid;
  v_status     public.subscription_status;
  v_max_est    integer;
  v_max_dept   integer;
  v_max_mem    integer;
  v_max_camp   integer;
  v_max_assess integer;
  v_max_allowed integer;
  v_current_count integer;
BEGIN
  SELECT om.tenant_id INTO v_tenant_id
  FROM public.organization_members om
  WHERE om.user_id = auth.uid()
    AND om.deleted_at IS NULL
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'no_tenant');
  END IF;

  SELECT s.status,
         (p.limits).max_establishments,
         (p.limits).max_departments,
         (p.limits).max_members,
         (p.limits).max_campaigns_per_month,
         (p.limits).max_assessments_per_month
  INTO v_status, v_max_est, v_max_dept, v_max_mem, v_max_camp, v_max_assess
  FROM public.tenant_subscriptions s
  JOIN public.subscription_plans p ON p.id = s.plan_id
  WHERE s.tenant_id = v_tenant_id AND s.deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'no_subscription');
  END IF;

  IF v_status IN ('fully_blocked', 'cancelled') THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'subscription_blocked');
  END IF;

  IF v_status = 'partially_blocked' THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'read_only_mode');
  END IF;

  v_max_allowed := CASE p_metric
    WHEN 'establishments' THEN v_max_est
    WHEN 'departments' THEN v_max_dept
    WHEN 'members' THEN v_max_mem
    WHEN 'campaigns' THEN v_max_camp
    WHEN 'assessments' THEN v_max_assess
    ELSE NULL
  END;

  IF v_max_allowed IS NULL THEN
    RETURN jsonb_build_object('allowed', true, 'limit', NULL, 'current', 0);
  END IF;

  SELECT COALESCE(COUNT(*), 0) INTO v_current_count
  FROM (
    SELECT 1 FROM public.establishments WHERE tenant_id = v_tenant_id AND deleted_at IS NULL AND p_metric = 'establishments'
    UNION ALL
    SELECT 1 FROM public.departments WHERE tenant_id = v_tenant_id AND deleted_at IS NULL AND p_metric = 'departments'
    UNION ALL
    SELECT 1 FROM public.organization_members WHERE tenant_id = v_tenant_id AND deleted_at IS NULL AND p_metric = 'members'
    UNION ALL
    SELECT 1 FROM public.campaigns WHERE tenant_id = v_tenant_id AND deleted_at IS NULL AND p_metric = 'campaigns' AND created_at >= date_trunc('month', now())
    UNION ALL
    SELECT 1 FROM public.assessment_cycles WHERE tenant_id = v_tenant_id AND deleted_at IS NULL AND p_metric = 'assessments' AND created_at >= date_trunc('month', now())
  ) counts;

  RETURN jsonb_build_object(
    'allowed', v_current_count < v_max_allowed,
    'limit', v_max_allowed,
    'current', v_current_count,
    'remaining', GREATEST(0, v_max_allowed - v_current_count)
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.check_plan_limit(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_plan_limit(text)
  TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Restaura fn_remove_member ao corpo SEC-004
--    Origem: SEC-004 (sem advisory lock, tenant derivado de caller)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_remove_member(p_member_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_caller_id      uuid;
  v_caller_role    text;
  v_caller_tenant  uuid;
  v_target         record;
  v_owner_count    integer;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'unauthenticated');
  END IF;

  SELECT om.tenant_id, om.role::text
  INTO v_caller_tenant, v_caller_role
  FROM public.organization_members om
  WHERE om.user_id = v_caller_id
    AND om.deleted_at IS NULL
  LIMIT 1;

  IF v_caller_tenant IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'no_tenant');
  END IF;

  SELECT om.id, om.user_id, om.tenant_id, om.role::text AS role, om.deleted_at
  INTO v_target
  FROM public.organization_members om
  WHERE om.id = p_member_id
  FOR UPDATE;

  IF v_target IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'member_not_found');
  END IF;

  IF v_target.tenant_id != v_caller_tenant THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'member_not_found');
  END IF;

  IF v_target.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'already_removed');
  END IF;

  IF v_target.user_id = v_caller_id THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'cannot_remove_self');
  END IF;

  IF v_caller_role = 'owner' THEN
    NULL;
  ELSIF v_caller_role = 'admin' THEN
    IF v_target.role IN ('owner', 'admin') THEN
      RETURN jsonb_build_object('success', FALSE, 'error', 'insufficient_privileges');
    END IF;
  ELSE
    RETURN jsonb_build_object('success', FALSE, 'error', 'forbidden');
  END IF;

  IF v_target.role = 'owner' THEN
    SELECT count(*) INTO v_owner_count
    FROM public.organization_members om
    WHERE om.tenant_id = v_caller_tenant
      AND om.role = 'owner'
      AND om.deleted_at IS NULL;

    IF v_owner_count <= 1 THEN
      RETURN jsonb_build_object('success', FALSE, 'error', 'last_owner_cannot_be_removed');
    END IF;
  END IF;

  UPDATE public.organization_members
  SET deleted_at = now(),
      updated_at = now()
  WHERE id = p_member_id;

  INSERT INTO public.organization_audit_log (
    tenant_id, actor_id, action, target_type, target_id, details
  ) VALUES (
    v_caller_tenant,
    v_caller_id,
    'member_removed',
    'member',
    p_member_id,
    jsonb_build_object(
      'removed_user_id', v_target.user_id,
      'removed_role', v_target.role
    )
  );

  RETURN jsonb_build_object('success', TRUE);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_remove_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_remove_member(uuid)
  TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Restaura fn_get_complaint_list (3-arg) ao corpo SEC-003
--    Origem: SEC-003 (sem multi-org check, paginacao na query principal)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_get_complaint_list(
  p_status text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_tenant_id uuid;
  v_user_role text;
  v_results   jsonb;
  v_total     bigint;
BEGIN
  SELECT om.tenant_id, om.role::text INTO v_tenant_id, v_user_role
  FROM public.organization_members om
  WHERE om.user_id = auth.uid()
    AND om.deleted_at IS NULL
    AND om.role IN ('owner', 'admin', 'manager', 'investigator')
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'forbidden');
  END IF;

  SELECT count(*) INTO v_total
  FROM public.complaints c
  WHERE c.tenant_id = v_tenant_id
    AND c.deleted_at IS NULL
    AND (p_status IS NULL OR c.status::text = p_status);

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', c.id, 'protocol', c.protocol,
      'category', c.category, 'severity', c.severity,
      'status', c.status, 'is_anonymous', c.is_anonymous,
      'created_at', c.created_at, 'updated_at', c.updated_at,
      'resolved_at', c.resolved_at,
      'investigator_count', (
        SELECT count(*) FROM public.complaint_investigators ci
        WHERE ci.complaint_id = c.id AND ci.removed_at IS NULL
      ),
      'message_count', (
        SELECT count(*) FROM public.complaint_messages cm
        WHERE cm.complaint_id = c.id
      )
    ) ORDER BY c.created_at DESC
  ), '[]'::jsonb)
  INTO v_results
  FROM public.complaints c
  WHERE c.tenant_id = v_tenant_id
    AND c.deleted_at IS NULL
    AND (p_status IS NULL OR c.status::text = p_status)
  LIMIT p_limit
  OFFSET p_offset;

  RETURN jsonb_build_object('success', TRUE, 'complaints', v_results, 'total', v_total);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_get_complaint_list(text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_get_complaint_list(text, integer, integer)
  TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Restaura fn_get_complaint_list (4-arg) ao corpo original
--    Origem: corpo original pre-SEC (sem service_role grant)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_get_complaint_list(
  p_tenant_id UUID,
  p_status    TEXT DEFAULT NULL,
  p_limit     INT DEFAULT 50,
  p_offset    INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_user_role TEXT;
  v_results   JSONB;
  v_total     BIGINT;
BEGIN
  SELECT om.role INTO v_user_role
  FROM public.organization_members om
  WHERE om.tenant_id = p_tenant_id
    AND om.user_id = auth.uid()
    AND om.deleted_at IS NULL
    AND om.role IN ('owner', 'admin', 'manager', 'investigator')
  LIMIT 1;

  IF v_user_role IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'forbidden');
  END IF;

  SELECT count(*) INTO v_total
  FROM public.complaints c
  WHERE c.tenant_id = p_tenant_id
    AND c.deleted_at IS NULL
    AND (p_status IS NULL OR c.status::text = p_status);

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', c.id, 'protocol', c.protocol,
      'category', c.category, 'severity', c.severity,
      'status', c.status, 'is_anonymous', c.is_anonymous,
      'created_at', c.created_at, 'updated_at', c.updated_at,
      'resolved_at', c.resolved_at,
      'investigator_count', (
        SELECT count(*) FROM public.complaint_investigators ci
        WHERE ci.complaint_id = c.id AND ci.removed_at IS NULL
      ),
      'message_count', (
        SELECT count(*) FROM public.complaint_messages cm
        WHERE cm.complaint_id = c.id
      )
    ) ORDER BY c.created_at DESC
  ), '[]'::jsonb)
  INTO v_results
  FROM public.complaints c
  WHERE c.tenant_id = p_tenant_id
    AND c.deleted_at IS NULL
    AND (p_status IS NULL OR c.status::text = p_status)
  LIMIT p_limit
  OFFSET p_offset;

  RETURN jsonb_build_object('success', TRUE, 'complaints', v_results, 'total', v_total);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_get_complaint_list(uuid, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_get_complaint_list(uuid, text, integer, integer)
  TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Restaura fn_prepare_campaign_send ao corpo SEC-005
--     Origem: SEC-005 (sem jsonb_typeof, sem dedup por canal, sem both OR)
-- ─────────────────────────────────────────────────────────────────────────────
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
      p_campaign_id, ep.tenant_id, ep.user_id, ep.full_name,
      ep.email, ep.phone, ep.establishment_id, ep.department_id,
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

  INSERT INTO public.campaign_deliveries (campaign_id, recipient_id, channel, status)
  SELECT cr.campaign_id, cr.id,
    CASE WHEN cr.channel = 'both' THEN 'email'::public.delivery_channel ELSE cr.channel END,
    'pending'::public.delivery_status
  FROM public.campaign_recipients cr
  WHERE cr.campaign_id = p_campaign_id
    AND NOT EXISTS (
      SELECT 1 FROM public.campaign_deliveries cd
      WHERE cd.recipient_id = cr.id
        AND cd.channel = (CASE WHEN cr.channel = 'both' THEN 'email'::public.delivery_channel ELSE cr.channel END)
    );

  INSERT INTO public.campaign_deliveries (campaign_id, recipient_id, channel, status)
  SELECT cr.campaign_id, cr.id, 'whatsapp'::public.delivery_channel, 'pending'::public.delivery_status
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
  SET status = 'sending', sent_at = now(), total_recipients = v_count
  WHERE id = p_campaign_id;

  RETURN jsonb_build_object('success', TRUE, 'total_recipients', v_count);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_prepare_campaign_send(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_prepare_campaign_send(uuid)
  TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verificacao pos-rollback
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  -- _v2 nao devem existir
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'fn_access_complaint_v2'
  ) THEN
    RAISE EXCEPTION 'EXPAND ROLLBACK FAILED: fn_access_complaint_v2 ainda existe.';
  END IF;

  -- Funcoes antigas devem existir (nao foram tocadas pelo EXPAND)
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'fn_access_complaint'
      AND array_length(p.proargtypes, 1) = 2
  ) THEN
    RAISE EXCEPTION 'EXPAND ROLLBACK FAILED: fn_access_complaint(text,text) nao existe.';
  END IF;

  -- check_plan_limit overload (uuid,text) nao deve existir
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'check_plan_limit'
      AND array_length(p.proargtypes, 1) = 2
  ) THEN
    RAISE EXCEPTION 'EXPAND ROLLBACK FAILED: check_plan_limit(uuid,text) ainda existe.';
  END IF;

  -- fn_record_pin_failure nao deve existir
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'fn_record_pin_failure'
  ) THEN
    RAISE EXCEPTION 'EXPAND ROLLBACK FAILED: fn_record_pin_failure ainda existe.';
  END IF;

  RAISE NOTICE 'EXPAND ROLLBACK concluido: estado restaurado para pre-EXPAND (HOTFIX-1 + HOTFIX-2).';
END;
$$;

COMMIT;
