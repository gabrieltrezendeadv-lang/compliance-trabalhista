-- =============================================================================
-- ROLLBACK: SEC-BLOCK1-CONSOLIDATION v1.2.2 — CONTRACT PHASE
-- Reverte a fase CONTRACT, recriando as funcoes antigas que foram removidas.
--
-- Estado alvo: pos-EXPAND (funcoes antigas + _v2 coexistem).
--
-- As funcoes recriadas devem corresponder exatamente ao estado que existia
-- antes do CONTRACT, ou seja, o estado preservado pelo EXPAND:
--   - fn_access_complaint(text, text): corpo SEC-003, ACL anon+authenticated+service_role
--   - fn_send_reporter_message(text, text, text): corpo SEC-003 + HOTFIX-2
--     (status 'resolved','dismissed' — NAO 'closed','archived')
--   - fn_check_pin_rate_limit(text, integer, integer): corpo SEC-003, ACL service_role
--
-- Escopo:
--   1. Recria fn_check_pin_rate_limit(text, integer, integer)
--   2. Recria fn_access_complaint(text, text)
--   3. Recria fn_send_reporter_message(text, text, text) com HOTFIX-2
--   4. Restaura ACLs originais
--
-- Funcoes _v2 permanecem intactas (coexistem durante rollback).
-- Apos o rollback do CONTRACT, o sistema fica no estado pos-EXPAND:
-- ambas as versoes existem, e o gateway pode ser revertido para chamar
-- as funcoes antigas.
--
-- IMPORTANTE: Execute somente se o CONTRACT foi aplicado.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- Safety check: Confirma que o CONTRACT foi aplicado
--               (funcoes antigas NAO existem, _v2 existem)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  -- Se a funcao antiga ainda existe, o CONTRACT nao foi aplicado
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'fn_access_complaint'
      AND array_length(p.proargtypes, 1) = 2
  ) THEN
    RAISE EXCEPTION 'ROLLBACK ABORTED: fn_access_complaint(text,text) ainda existe. '
      'O CONTRACT nao parece ter sido aplicado.';
  END IF;

  -- Confirmar que _v2 existem (estado esperado pos-CONTRACT)
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'fn_access_complaint_v2'
  ) THEN
    RAISE EXCEPTION 'ROLLBACK ABORTED: fn_access_complaint_v2 nao encontrada. '
      'Estado inconsistente — nem CONTRACT nem EXPAND parecem estar aplicados.';
  END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Recria fn_check_pin_rate_limit(text, integer, integer) — corpo SEC-003
--    Funcao original com rate limit por protocolo, poda global + INSERT
--    ACL: service_role only
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_check_pin_rate_limit(
  p_protocol       text,
  p_max_attempts   integer DEFAULT 5,
  p_window_minutes integer DEFAULT 15
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_count integer;
BEGIN
  -- Prune old attempts (older than window)
  DELETE FROM public.complaint_pin_attempts
  WHERE attempted_at < now() - (p_window_minutes || ' minutes')::interval;

  -- Count recent attempts for this protocol
  SELECT count(*) INTO v_count
  FROM public.complaint_pin_attempts
  WHERE protocol = p_protocol
    AND attempted_at >= now() - (p_window_minutes || ' minutes')::interval;

  IF v_count >= p_max_attempts THEN
    RETURN FALSE;
  END IF;

  -- Record this attempt
  INSERT INTO public.complaint_pin_attempts (protocol)
  VALUES (p_protocol);

  RETURN TRUE;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_check_pin_rate_limit(text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_check_pin_rate_limit(text, integer, integer)
  TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Recria fn_access_complaint(text, text) — corpo SEC-003
--    Rate limit via funcao antiga, dummy bcrypt, rehash legado
--    ACL: anon + authenticated + service_role (acesso publico original)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_access_complaint(
  p_protocol text,
  p_pin_hash text
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
  -- Rate limit check (5 attempts per 15 minutes per protocol)
  SELECT public.fn_check_pin_rate_limit(p_protocol) INTO v_rate_ok;
  IF NOT v_rate_ok THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'rate_limited');
  END IF;

  SELECT c.id, c.status, c.category, c.severity, c.is_anonymous,
         c.pin_hash, c.created_at, c.updated_at
  INTO v_complaint
  FROM public.complaints c
  WHERE c.protocol = p_protocol;

  IF v_complaint IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_credentials');
  END IF;

  IF NOT public.fn_verify_complaint_pin(v_complaint.pin_hash, p_pin_hash) THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_credentials');
  END IF;

  -- Rehash legacy SHA-256 to bcrypt if needed
  IF v_complaint.pin_hash NOT LIKE '$2%' THEN
    v_new_bcrypt := extensions.crypt(p_pin_hash, extensions.gen_salt('bf', 10));
    UPDATE public.complaints
    SET pin_hash = v_new_bcrypt
    WHERE id = v_complaint.id;
  END IF;

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

REVOKE EXECUTE ON FUNCTION public.fn_access_complaint(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_access_complaint(text, text)
  TO anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Recria fn_send_reporter_message(text, text, text)
--    Corpo SEC-003 + HOTFIX-2: status 'resolved', 'dismissed'
--    (NAO 'closed', 'archived' — corrigido em v1.2.2)
--    ACL: anon + authenticated + service_role (acesso publico original)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_send_reporter_message(
  p_protocol text,
  p_pin_hash text,
  p_body     text
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
  -- Rate limit check
  SELECT public.fn_check_pin_rate_limit(p_protocol) INTO v_rate_ok;
  IF NOT v_rate_ok THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'rate_limited');
  END IF;

  SELECT c.id, c.status, c.pin_hash
  INTO v_complaint
  FROM public.complaints c
  WHERE c.protocol = p_protocol;

  IF v_complaint IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_credentials');
  END IF;

  IF NOT public.fn_verify_complaint_pin(v_complaint.pin_hash, p_pin_hash) THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_credentials');
  END IF;

  -- Rehash legacy SHA-256 to bcrypt if needed
  IF v_complaint.pin_hash NOT LIKE '$2%' THEN
    v_new_bcrypt := extensions.crypt(p_pin_hash, extensions.gen_salt('bf', 10));
    UPDATE public.complaints
    SET pin_hash = v_new_bcrypt
    WHERE id = v_complaint.id;
  END IF;

  -- HOTFIX-2: status de rejeicao correto ('resolved', 'dismissed')
  IF v_complaint.status IN ('resolved', 'dismissed') THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'complaint_closed');
  END IF;

  INSERT INTO public.complaint_messages (
    complaint_id, sender_type, body
  ) VALUES (
    v_complaint.id, 'reporter', p_body
  ) RETURNING id INTO v_message_id;

  RETURN jsonb_build_object('success', TRUE, 'message_id', v_message_id);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_send_reporter_message(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_send_reporter_message(text, text, text)
  TO anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verificacao pos-rollback: confirmar coexistencia de ambas as versoes
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  -- Funcoes antigas recriadas
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'fn_access_complaint'
      AND array_length(p.proargtypes, 1) = 2
  ) THEN
    RAISE EXCEPTION 'CONTRACT ROLLBACK FAILED: fn_access_complaint(text,text) nao recriada.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'fn_send_reporter_message'
      AND array_length(p.proargtypes, 1) = 3
  ) THEN
    RAISE EXCEPTION 'CONTRACT ROLLBACK FAILED: fn_send_reporter_message(text,text,text) nao recriada.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'fn_check_pin_rate_limit'
      AND array_length(p.proargtypes, 1) = 3
  ) THEN
    RAISE EXCEPTION 'CONTRACT ROLLBACK FAILED: fn_check_pin_rate_limit(text,integer,integer) nao recriada.';
  END IF;

  -- _v2 intactas
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'fn_access_complaint_v2'
  ) THEN
    RAISE EXCEPTION 'CONTRACT ROLLBACK FAILED: fn_access_complaint_v2 desapareceu.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'fn_send_reporter_message_v2'
  ) THEN
    RAISE EXCEPTION 'CONTRACT ROLLBACK FAILED: fn_send_reporter_message_v2 desapareceu.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'fn_check_pin_rate_limit_v2'
  ) THEN
    RAISE EXCEPTION 'CONTRACT ROLLBACK FAILED: fn_check_pin_rate_limit_v2 desapareceu.';
  END IF;

  RAISE NOTICE 'CONTRACT ROLLBACK concluido: funcoes antigas e _v2 coexistem (estado pos-EXPAND).';
END;
$$;

COMMIT;
