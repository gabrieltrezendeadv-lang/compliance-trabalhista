
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. fn_submit_complaint — PIN minimo 6, validacao numerica, enum casts
--    Mesma assinatura (11 params) — CREATE OR REPLACE seguro
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_submit_complaint(
  p_tenant_slug   text,
  p_subject       text,
  p_description   text,
  p_category      text,
  p_is_anonymous  boolean,
  p_reporter_name  text DEFAULT NULL,
  p_reporter_email text DEFAULT NULL,
  p_reporter_phone text DEFAULT NULL,
  p_establishment_name text DEFAULT NULL,
  p_department_name    text DEFAULT NULL,
  p_pin_hash      text DEFAULT NULL
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
  -- PIN minimo 6 para novas denuncias (nao 4)
  -- PINs legados de 4-5 digitos sao aceitos apenas em consulta e mensagem
  IF p_pin_hash IS NULL OR length(p_pin_hash) < 6 OR length(p_pin_hash) > 32 THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_pin_length');
  END IF;

  -- Validar que o PIN contem apenas digitos
  IF p_pin_hash !~ '^\d+$' THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_pin_format');
  END IF;

  SELECT id INTO v_tenant_id
  FROM public.organizations
  WHERE slug = p_tenant_slug AND deleted_at IS NULL;

  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_tenant');
  END IF;

  v_protocol := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  v_bcrypt_hash := extensions.crypt(p_pin_hash, extensions.gen_salt('bf', 10));

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

REVOKE EXECUTE ON FUNCTION public.fn_submit_complaint(text,text,text,text,boolean,text,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_submit_complaint(text,text,text,text,boolean,text,text,text,text,text,text) TO anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. fn_check_pin_rate_limit_v2 — NOVA FUNCAO: dual rate limiting
--    Funcao antiga fn_check_pin_rate_limit(text,int,int) permanece intacta.
--    _v2 adiciona rate limit por ip_hash (HMAC) e nao insere tentativa.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_check_pin_rate_limit_v2(
  p_protocol         text,
  p_ip_hash          text    DEFAULT NULL,
  p_max_attempts     integer DEFAULT 5,
  p_window_minutes   integer DEFAULT 15,
  p_max_ip_attempts  integer DEFAULT 20
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_proto_count  integer;
  v_ip_count     integer;
BEGIN
  -- Poda por protocolo dentro da janela (nao global)
  DELETE FROM public.complaint_pin_attempts
  WHERE protocol = p_protocol
    AND attempted_at < now() - (p_window_minutes || ' minutes')::interval;

  -- Poda global de entradas expiradas (> 24h) para prevenir crescimento ilimitado
  DELETE FROM public.complaint_pin_attempts
  WHERE id IN (
    SELECT id FROM public.complaint_pin_attempts
    WHERE attempted_at < now() - interval '24 hours'
    LIMIT 1000
  );

  -- LIMITE 1: Contar tentativas FALHAS por PROTOCOLO no periodo
  SELECT count(*) INTO v_proto_count
  FROM public.complaint_pin_attempts
  WHERE protocol = p_protocol
    AND attempted_at >= now() - (p_window_minutes || ' minutes')::interval;

  IF v_proto_count >= p_max_attempts THEN
    RETURN FALSE;
  END IF;

  -- LIMITE 2: Contar tentativas FALHAS por IP HASH no periodo
  IF p_ip_hash IS NOT NULL AND p_ip_hash != '' THEN
    SELECT count(*) INTO v_ip_count
    FROM public.complaint_pin_attempts
    WHERE ip_hash = p_ip_hash
      AND attempted_at >= now() - (p_window_minutes || ' minutes')::interval;

    IF v_ip_count >= p_max_ip_attempts THEN
      RETURN FALSE;
    END IF;
  END IF;

  -- NAO insere tentativa aqui
  -- O registro de falha e feito por fn_record_pin_failure
  RETURN TRUE;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_check_pin_rate_limit_v2(text,text,integer,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_check_pin_rate_limit_v2(text,text,integer,integer,integer) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. fn_record_pin_failure — NOVA FUNCAO (sem predecessora)
--    Registra tentativa falha de verificacao de PIN.
--    Chamada somente quando o PIN e incorreto ou o protocolo nao existe.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_record_pin_failure(
  p_protocol text,
  p_ip_hash  text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.complaint_pin_attempts (protocol, ip_hash)
  VALUES (p_protocol, p_ip_hash);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_record_pin_failure(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_record_pin_failure(text,text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. fn_send_reporter_message_v2 — NOVA FUNCAO: IP hash via gateway
--    Funcao antiga fn_send_reporter_message(text,text,text) permanece intacta.
--    _v2 recebe ip_hash de gateway confiavel, ACL service_role only.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_send_reporter_message_v2(
  p_protocol       text,
  p_pin_hash       text,
  p_body           text,
  p_caller_ip_hash text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_complaint  record;
  v_message_id uuid;
  v_rate_ok    boolean;
  v_new_bcrypt text;
BEGIN
  -- 1. Verificar rate limit (dual: protocolo + ip_hash)
  SELECT public.fn_check_pin_rate_limit_v2(p_protocol, p_caller_ip_hash) INTO v_rate_ok;
  IF NOT v_rate_ok THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'rate_limited');
  END IF;

  -- 2. Buscar denuncia
  SELECT c.id, c.status::text AS status, c.pin_hash
  INTO v_complaint
  FROM public.complaints c
  WHERE c.protocol = p_protocol;

  -- Dummy bcrypt anti-enumeracao quando protocolo nao existe
  IF v_complaint IS NULL THEN
    PERFORM extensions.crypt('dummy-constant-time', extensions.gen_salt('bf', 10));
    PERFORM public.fn_record_pin_failure(p_protocol, p_caller_ip_hash);
    RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_credentials');
  END IF;

  -- 3. Verificar PIN
  IF NOT public.fn_verify_complaint_pin(v_complaint.pin_hash, p_pin_hash) THEN
    PERFORM public.fn_record_pin_failure(p_protocol, p_caller_ip_hash);
    RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_credentials');
  END IF;

  -- 4. Rehash legado para bcrypt (PIN correto)
  IF v_complaint.pin_hash NOT LIKE '$2%' THEN
    v_new_bcrypt := extensions.crypt(p_pin_hash, extensions.gen_salt('bf', 10));
    UPDATE public.complaints
    SET pin_hash = v_new_bcrypt
    WHERE id = v_complaint.id;
  END IF;

  -- Usar valores corretos do enum complaint_status
  IF v_complaint.status IN ('resolved', 'dismissed') THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'complaint_closed');
  END IF;

  -- 5. Inserir mensagem
  INSERT INTO public.complaint_messages (
    complaint_id, sender_type, body
  ) VALUES (
    v_complaint.id, 'reporter', p_body
  ) RETURNING id INTO v_message_id;

  RETURN jsonb_build_object('success', TRUE, 'message_id', v_message_id);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_send_reporter_message_v2(text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_send_reporter_message_v2(text,text,text,text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. fn_access_complaint_v2 — NOVA FUNCAO: IP hash via gateway
--    Funcao antiga fn_access_complaint(text,text) permanece intacta.
--    _v2 recebe ip_hash de gateway confiavel, ACL service_role only.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_access_complaint_v2(
  p_protocol       text,
  p_pin_hash       text,
  p_caller_ip_hash text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_complaint  record;
  v_messages   jsonb;
  v_rate_ok    boolean;
  v_new_bcrypt text;
BEGIN
  -- 1. Verificar rate limit (dual: protocolo + ip_hash)
  SELECT public.fn_check_pin_rate_limit_v2(p_protocol, p_caller_ip_hash) INTO v_rate_ok;
  IF NOT v_rate_ok THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'rate_limited');
  END IF;

  -- 2. Buscar denuncia
  SELECT c.id, c.status, c.category, c.severity, c.is_anonymous,
         c.pin_hash, c.created_at, c.updated_at
  INTO v_complaint
  FROM public.complaints c
  WHERE c.protocol = p_protocol;

  -- Dummy bcrypt anti-enumeracao quando protocolo nao existe
  IF v_complaint IS NULL THEN
    PERFORM extensions.crypt('dummy-constant-time', extensions.gen_salt('bf', 10));
    PERFORM public.fn_record_pin_failure(p_protocol, p_caller_ip_hash);
    RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_credentials');
  END IF;

  -- 3. Verificar PIN
  IF NOT public.fn_verify_complaint_pin(v_complaint.pin_hash, p_pin_hash) THEN
    PERFORM public.fn_record_pin_failure(p_protocol, p_caller_ip_hash);
    RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_credentials');
  END IF;

  -- 4. Rehash legado para bcrypt (PIN correto)
  IF v_complaint.pin_hash NOT LIKE '$2%' THEN
    v_new_bcrypt := extensions.crypt(p_pin_hash, extensions.gen_salt('bf', 10));
    UPDATE public.complaints
    SET pin_hash = v_new_bcrypt
    WHERE id = v_complaint.id;
  END IF;

  -- 5. Buscar mensagens
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', m.id,
      'sender_type', m.sender_type,
      'body', m.body,
      'created_at', m.created_at
    ) ORDER BY m.created_at
  ), '[]'::jsonb)
  INTO v_messages
  FROM public.complaint_messages m
  WHERE m.complaint_id = v_complaint.id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'complaint', jsonb_build_object(
      'status', v_complaint.status,
      'category', v_complaint.category,
      'severity', v_complaint.severity,
      'is_anonymous', v_complaint.is_anonymous,
      'created_at', v_complaint.created_at,
      'updated_at', v_complaint.updated_at
    ),
    'messages', v_messages
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_access_complaint_v2(text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_access_complaint_v2(text,text,text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. check_plan_limit — ambas overloads
--    Overload (uuid,text) criada primeiro (v1.2: nova)
--    Overload (text) atualizada com multi-org check e delegacao
--    Ambas mesma assinatura — CREATE OR REPLACE seguro
-- ─────────────────────────────────────────────────────────────────────────────

-- Overload com tenant_id explicito (nova)
CREATE OR REPLACE FUNCTION public.check_plan_limit(p_tenant_id uuid, p_metric text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_status        public.subscription_status;
  v_max_est       integer;
  v_max_dept      integer;
  v_max_mem       integer;
  v_max_camp      integer;
  v_max_assess    integer;
  v_max_allowed   integer;
  v_current_count integer;
BEGIN
  -- Verificar que o caller e membro do tenant especificado
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.user_id = auth.uid()
      AND om.tenant_id = p_tenant_id
      AND om.deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'forbidden');
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
  WHERE s.tenant_id = p_tenant_id AND s.deleted_at IS NULL;

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
    RETURN jsonb_build_object('allowed', false, 'reason', 'unknown_metric');
  END IF;

  SELECT COALESCE(COUNT(*), 0) INTO v_current_count
  FROM (
    SELECT 1 FROM public.establishments WHERE tenant_id = p_tenant_id AND deleted_at IS NULL AND p_metric = 'establishments'
    UNION ALL
    SELECT 1 FROM public.departments WHERE tenant_id = p_tenant_id AND deleted_at IS NULL AND p_metric = 'departments'
    UNION ALL
    SELECT 1 FROM public.organization_members WHERE tenant_id = p_tenant_id AND deleted_at IS NULL AND p_metric = 'members'
    UNION ALL
    SELECT 1 FROM public.campaigns WHERE tenant_id = p_tenant_id AND deleted_at IS NULL AND p_metric = 'campaigns' AND created_at >= date_trunc('month', now())
    UNION ALL
    SELECT 1 FROM public.assessment_cycles WHERE tenant_id = p_tenant_id AND deleted_at IS NULL AND p_metric = 'assessments' AND created_at >= date_trunc('month', now())
  ) counts;

  RETURN jsonb_build_object(
    'allowed', v_current_count < v_max_allowed,
    'limit', v_max_allowed,
    'current', v_current_count,
    'remaining', GREATEST(0, v_max_allowed - v_current_count)
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.check_plan_limit(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_plan_limit(uuid, text) TO authenticated, service_role;

-- Overload sem tenant_id (atualizada com multi-org check)
CREATE OR REPLACE FUNCTION public.check_plan_limit(p_metric text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_tenant_id     uuid;
  v_tenant_count  integer;
BEGIN
  SELECT count(DISTINCT om.tenant_id)
  INTO v_tenant_count
  FROM public.organization_members om
  WHERE om.user_id = auth.uid()
    AND om.deleted_at IS NULL;

  IF v_tenant_count = 0 THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'no_tenant');
  END IF;

  IF v_tenant_count > 1 THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'multi_org_ambiguous');
  END IF;

  SELECT om.tenant_id INTO v_tenant_id
  FROM public.organization_members om
  WHERE om.user_id = auth.uid()
    AND om.deleted_at IS NULL
  LIMIT 1;

  RETURN public.check_plan_limit(v_tenant_id, p_metric);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.check_plan_limit(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_plan_limit(text) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. fn_remove_member — tenant derivado do alvo, advisory lock
--    Mesma assinatura (uuid) — CREATE OR REPLACE seguro
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
  v_target_tenant  uuid;
  v_target         record;
  v_owner_count    integer;
  v_lock_key       bigint;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'unauthenticated');
  END IF;

  SELECT om.tenant_id INTO v_target_tenant
  FROM public.organization_members om
  WHERE om.id = p_member_id;

  IF v_target_tenant IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'member_not_found');
  END IF;

  v_lock_key := ('x' || left(replace(v_target_tenant::text, '-', ''), 15))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT om.id, om.user_id, om.tenant_id, om.role::text AS role, om.deleted_at
  INTO v_target
  FROM public.organization_members om
  WHERE om.id = p_member_id
  FOR UPDATE;

  IF v_target IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'member_not_found');
  END IF;

  IF v_target.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'already_removed');
  END IF;

  SELECT om.role::text INTO v_caller_role
  FROM public.organization_members om
  WHERE om.user_id = v_caller_id
    AND om.tenant_id = v_target.tenant_id
    AND om.deleted_at IS NULL;

  IF v_caller_role IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'member_not_found');
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
    WHERE om.tenant_id = v_target.tenant_id
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
    v_target.tenant_id,
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

REVOKE EXECUTE ON FUNCTION public.fn_remove_member(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_remove_member(uuid) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. fn_get_complaint_list — paginacao correta (ambas overloads)
--    Mesma assinatura — CREATE OR REPLACE seguro
-- ─────────────────────────────────────────────────────────────────────────────

-- Overload 1: Sem p_tenant_id (multi-org check)
CREATE OR REPLACE FUNCTION public.fn_get_complaint_list(
  p_status text DEFAULT NULL,
  p_limit  integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_tenant_id    uuid;
  v_tenant_count integer;
  v_user_role    text;
  v_results      jsonb;
  v_total        bigint;
BEGIN
  SELECT count(DISTINCT om.tenant_id)
  INTO v_tenant_count
  FROM public.organization_members om
  WHERE om.user_id = auth.uid()
    AND om.deleted_at IS NULL
    AND om.role IN ('owner', 'admin', 'manager', 'investigator');

  IF v_tenant_count = 0 THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'forbidden');
  END IF;

  IF v_tenant_count > 1 THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'multi_org_ambiguous');
  END IF;

  SELECT om.tenant_id, om.role::text INTO v_tenant_id, v_user_role
  FROM public.organization_members om
  WHERE om.user_id = auth.uid()
    AND om.deleted_at IS NULL
    AND om.role IN ('owner', 'admin', 'manager', 'investigator')
  LIMIT 1;

  SELECT count(*) INTO v_total
  FROM public.complaints c
  WHERE c.tenant_id = v_tenant_id
    AND c.deleted_at IS NULL
    AND (p_status IS NULL OR c.status::text = p_status);

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', sub.id, 'protocol', sub.protocol,
      'category', sub.category, 'severity', sub.severity,
      'status', sub.status, 'is_anonymous', sub.is_anonymous,
      'created_at', sub.created_at, 'updated_at', sub.updated_at,
      'resolved_at', sub.resolved_at,
      'investigator_count', (
        SELECT count(*) FROM public.complaint_investigators ci
        WHERE ci.complaint_id = sub.id AND ci.removed_at IS NULL
      ),
      'message_count', (
        SELECT count(*) FROM public.complaint_messages cm
        WHERE cm.complaint_id = sub.id
      )
    ) ORDER BY sub.created_at DESC
  ), '[]'::jsonb)
  INTO v_results
  FROM (
    SELECT c.id, c.protocol, c.category, c.severity,
           c.status, c.is_anonymous, c.created_at, c.updated_at,
           c.resolved_at
    FROM public.complaints c
    WHERE c.tenant_id = v_tenant_id
      AND c.deleted_at IS NULL
      AND (p_status IS NULL OR c.status::text = p_status)
    ORDER BY c.created_at DESC
    LIMIT p_limit
    OFFSET p_offset
  ) sub;

  RETURN jsonb_build_object('success', TRUE, 'complaints', v_results, 'total', v_total);
END;
$function$;

-- Overload 2: Com p_tenant_id explicito
CREATE OR REPLACE FUNCTION public.fn_get_complaint_list(
  p_tenant_id uuid,
  p_status    text DEFAULT NULL,
  p_limit     integer DEFAULT 50,
  p_offset    integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''
AS $function$
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
      'id', sub.id, 'protocol', sub.protocol,
      'category', sub.category, 'severity', sub.severity,
      'status', sub.status, 'is_anonymous', sub.is_anonymous,
      'created_at', sub.created_at, 'updated_at', sub.updated_at,
      'resolved_at', sub.resolved_at,
      'investigator_count', (
        SELECT count(*) FROM public.complaint_investigators ci
        WHERE ci.complaint_id = sub.id AND ci.removed_at IS NULL
      ),
      'message_count', (
        SELECT count(*) FROM public.complaint_messages cm
        WHERE cm.complaint_id = sub.id
      )
    ) ORDER BY sub.created_at DESC
  ), '[]'::jsonb)
  INTO v_results
  FROM (
    SELECT c.id, c.protocol, c.category, c.severity,
           c.status, c.is_anonymous, c.created_at, c.updated_at,
           c.resolved_at
    FROM public.complaints c
    WHERE c.tenant_id = p_tenant_id
      AND c.deleted_at IS NULL
      AND (p_status IS NULL OR c.status::text = p_status)
    ORDER BY c.created_at DESC
    LIMIT p_limit
    OFFSET p_offset
  ) sub;

  RETURN jsonb_build_object('success', TRUE, 'complaints', v_results, 'total', v_total);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_get_complaint_list(text,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_get_complaint_list(text,integer,integer) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.fn_get_complaint_list(uuid,text,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_get_complaint_list(uuid,text,integer,integer) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. fn_prepare_campaign_send — v1.2.1: both OR, jsonb_typeof, dedup
--    Mesma assinatura (uuid) — CREATE OR REPLACE seguro
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_prepare_campaign_send(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_campaign       record;
  v_count          int := 0;
  v_delivery_count int := 0;
  v_lock_key       bigint;
  v_scope_keys     text[];
  v_valid_keys     text[] := ARRAY['establishment_ids', 'department_ids'];
  v_key            text;
  v_id_text        text;
  v_id_uuid        uuid;
  v_invalid_ids    text[];
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

  -- Validar target_scope keys
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

    -- Validar jsonb_typeof ANTES de jsonb_array_elements_text
    IF v_campaign.target_scope->'establishment_ids' IS NOT NULL THEN
      IF jsonb_typeof(v_campaign.target_scope->'establishment_ids') != 'array' THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_target_scope_format',
                                 'detail', 'establishment_ids must be a JSON array');
      END IF;

      v_invalid_ids := ARRAY[]::text[];
      FOR v_id_text IN SELECT jsonb_array_elements_text(v_campaign.target_scope->'establishment_ids')
      LOOP
        BEGIN
          v_id_uuid := v_id_text::uuid;
          IF NOT EXISTS (
            SELECT 1 FROM public.establishments
            WHERE id = v_id_uuid
              AND tenant_id = v_campaign.tenant_id
              AND deleted_at IS NULL
          ) THEN
            v_invalid_ids := v_invalid_ids || v_id_text;
          END IF;
        EXCEPTION WHEN invalid_text_representation THEN
          v_invalid_ids := v_invalid_ids || v_id_text;
        END;
      END LOOP;
      IF array_length(v_invalid_ids, 1) > 0 THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_establishment_ids',
                                 'detail', array_to_string(v_invalid_ids, ', '));
      END IF;
    END IF;

    IF v_campaign.target_scope->'department_ids' IS NOT NULL THEN
      IF jsonb_typeof(v_campaign.target_scope->'department_ids') != 'array' THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_target_scope_format',
                                 'detail', 'department_ids must be a JSON array');
      END IF;

      v_invalid_ids := ARRAY[]::text[];
      FOR v_id_text IN SELECT jsonb_array_elements_text(v_campaign.target_scope->'department_ids')
      LOOP
        BEGIN
          v_id_uuid := v_id_text::uuid;
          IF NOT EXISTS (
            SELECT 1 FROM public.departments
            WHERE id = v_id_uuid
              AND tenant_id = v_campaign.tenant_id
              AND deleted_at IS NULL
          ) THEN
            v_invalid_ids := v_invalid_ids || v_id_text;
          END IF;
        EXCEPTION WHEN invalid_text_representation THEN
          v_invalid_ids := v_invalid_ids || v_id_text;
        END;
      END LOOP;
      IF array_length(v_invalid_ids, 1) > 0 THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_department_ids',
                                 'detail', array_to_string(v_invalid_ids, ', '));
      END IF;
    END IF;
  END IF;

  -- Popular recipients (idempotent)
  IF NOT EXISTS (SELECT 1 FROM public.campaign_recipients WHERE campaign_id = p_campaign_id LIMIT 1) THEN
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
        CASE v_campaign.channel
          WHEN 'email' THEN ep.email IS NOT NULL
          WHEN 'whatsapp' THEN ep.phone IS NOT NULL
          WHEN 'both' THEN ep.email IS NOT NULL OR ep.phone IS NOT NULL
          ELSE FALSE
        END
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

  -- Deliveries (email) com dedup por email normalizado
  INSERT INTO public.campaign_deliveries (
    campaign_id, recipient_id, channel, status
  )
  SELECT DISTINCT ON (lower(trim(cr.email)))
    cr.campaign_id,
    cr.id,
    'email'::public.delivery_channel,
    'pending'::public.delivery_status
  FROM public.campaign_recipients cr
  WHERE cr.campaign_id = p_campaign_id
    AND cr.channel IN ('email', 'both')
    AND cr.email IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.campaign_deliveries cd
      WHERE cd.recipient_id = cr.id
        AND cd.channel = 'email'
    )
  ORDER BY lower(trim(cr.email)), cr.created_at;

  -- Deliveries (whatsapp) com dedup por telefone normalizado
  INSERT INTO public.campaign_deliveries (
    campaign_id, recipient_id, channel, status
  )
  SELECT DISTINCT ON (regexp_replace(cr.phone, '[^0-9+]', '', 'g'))
    cr.campaign_id,
    cr.id,
    'whatsapp'::public.delivery_channel,
    'pending'::public.delivery_status
  FROM public.campaign_recipients cr
  WHERE cr.campaign_id = p_campaign_id
    AND cr.channel IN ('whatsapp', 'both')
    AND cr.phone IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.campaign_deliveries cd
      WHERE cd.recipient_id = cr.id AND cd.channel = 'whatsapp'
    )
  ORDER BY regexp_replace(cr.phone, '[^0-9+]', '', 'g'), cr.created_at;

  -- Contar DELIVERIES para determinar sucesso
  SELECT count(*) INTO v_delivery_count
  FROM public.campaign_deliveries WHERE campaign_id = p_campaign_id;

  SELECT count(*) INTO v_count
  FROM public.campaign_recipients WHERE campaign_id = p_campaign_id;

  IF v_delivery_count = 0 THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'error', 'no_deliveries',
      'total_recipients', v_count,
      'total_deliveries', 0
    );
  END IF;

  UPDATE public.campaigns
  SET status = 'sending',
      sent_at = now(),
      total_recipients = v_count
  WHERE id = p_campaign_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'total_recipients', v_count,
    'total_deliveries', v_delivery_count
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_prepare_campaign_send(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_prepare_campaign_send(uuid) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Index adicional para rate limit dual por ip_hash
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_pin_attempts_ip_hash_time
  ON public.complaint_pin_attempts (ip_hash, attempted_at DESC)
  WHERE ip_hash IS NOT NULL;
