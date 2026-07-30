
-- Safety check 1: Confirma que o EXPAND foi aplicado (_v2 existem)
DO $$
DECLARE
  v_fn_oid oid;
BEGIN
  SELECT p.oid INTO v_fn_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'fn_access_complaint_v2'
    AND pg_get_function_identity_arguments(p.oid) = 'p_protocol text, p_pin_hash text, p_caller_ip_hash text';

  IF v_fn_oid IS NULL THEN
    SELECT p.oid INTO v_fn_oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'fn_access_complaint_v2'
      AND array_length(p.proargtypes, 1) = 3;

    IF v_fn_oid IS NULL THEN
      RAISE EXCEPTION 'CONTRACT ABORTED: fn_access_complaint_v2(text,text,text) nao encontrada. O EXPAND deve ser aplicado antes do CONTRACT.';
    END IF;
  END IF;

  v_fn_oid := NULL;
  SELECT p.oid INTO v_fn_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'fn_send_reporter_message_v2'
    AND array_length(p.proargtypes, 1) = 4;

  IF v_fn_oid IS NULL THEN
    RAISE EXCEPTION 'CONTRACT ABORTED: fn_send_reporter_message_v2(text,text,text,text) nao encontrada. O EXPAND deve ser aplicado antes do CONTRACT.';
  END IF;

  v_fn_oid := NULL;
  SELECT p.oid INTO v_fn_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'fn_check_pin_rate_limit_v2'
    AND array_length(p.proargtypes, 1) = 5;

  IF v_fn_oid IS NULL THEN
    RAISE EXCEPTION 'CONTRACT ABORTED: fn_check_pin_rate_limit_v2(text,text,int,int,int) nao encontrada. O EXPAND deve ser aplicado antes do CONTRACT.';
  END IF;

  RAISE NOTICE 'Safety check 1 OK: todas as funcoes _v2 existem.';
END;
$$;

-- Safety check 2: Confirma que funcoes antigas existem e nenhum caller as referencia
DO $$
DECLARE
  v_fn_access_oid      oid;
  v_fn_message_oid     oid;
  v_fn_ratelimit_oid   oid;
  v_dep_callers        text;
  v_text_callers       text;
  v_all_callers        text;
BEGIN
  SELECT p.oid INTO v_fn_access_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'fn_access_complaint'
    AND array_length(p.proargtypes, 1) = 2
    AND p.proargtypes[0] = 'text'::regtype
    AND p.proargtypes[1] = 'text'::regtype;

  IF v_fn_access_oid IS NULL THEN
    RAISE EXCEPTION 'CONTRACT ABORTED: fn_access_complaint(text,text) nao encontrada. A funcao antiga ja foi removida ou nunca existiu. Estado inconsistente.';
  END IF;

  SELECT p.oid INTO v_fn_message_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'fn_send_reporter_message'
    AND array_length(p.proargtypes, 1) = 3
    AND p.proargtypes[0] = 'text'::regtype
    AND p.proargtypes[1] = 'text'::regtype
    AND p.proargtypes[2] = 'text'::regtype;

  IF v_fn_message_oid IS NULL THEN
    RAISE EXCEPTION 'CONTRACT ABORTED: fn_send_reporter_message(text,text,text) nao encontrada. A funcao antiga ja foi removida ou nunca existiu. Estado inconsistente.';
  END IF;

  SELECT p.oid INTO v_fn_ratelimit_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'fn_check_pin_rate_limit'
    AND array_length(p.proargtypes, 1) = 3
    AND p.proargtypes[0] = 'text'::regtype
    AND p.proargtypes[1] = 'integer'::regtype
    AND p.proargtypes[2] = 'integer'::regtype;

  IF v_fn_ratelimit_oid IS NULL THEN
    RAISE EXCEPTION 'CONTRACT ABORTED: fn_check_pin_rate_limit(text,integer,integer) nao encontrada. A funcao antiga ja foi removida ou nunca existiu. Estado inconsistente.';
  END IF;

  RAISE NOTICE 'Safety check 2a OK: funcoes antigas localizadas (OIDs: %, %, %).', v_fn_access_oid, v_fn_message_oid, v_fn_ratelimit_oid;

  SELECT string_agg(
    n2.nspname || '.' || p2.proname || '(' || pg_get_function_identity_arguments(p2.oid) || ')',
    ', '
  )
  INTO v_dep_callers
  FROM pg_depend d
  JOIN pg_proc p2 ON p2.oid = d.objid
  JOIN pg_namespace n2 ON n2.oid = p2.pronamespace
  WHERE d.deptype = 'n'
    AND d.refobjid IN (v_fn_access_oid, v_fn_message_oid, v_fn_ratelimit_oid)
    AND p2.oid NOT IN (v_fn_access_oid, v_fn_message_oid, v_fn_ratelimit_oid);

  SELECT string_agg(
    n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
    ', '
  )
  INTO v_text_callers
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prokind = 'f'
    AND p.oid NOT IN (v_fn_access_oid, v_fn_message_oid, v_fn_ratelimit_oid)
    AND p.proname NOT LIKE '%_v2'
    AND (
      (
        pg_get_functiondef(p.oid) ~* 'fn_access_complaint\s*\('
        AND pg_get_functiondef(p.oid) !~* 'fn_access_complaint_v2\s*\('
      )
      OR
      (
        pg_get_functiondef(p.oid) ~* 'fn_send_reporter_message\s*\('
        AND pg_get_functiondef(p.oid) !~* 'fn_send_reporter_message_v2\s*\('
      )
      OR
      (
        pg_get_functiondef(p.oid) ~* 'fn_check_pin_rate_limit\s*\('
        AND pg_get_functiondef(p.oid) !~* 'fn_check_pin_rate_limit_v2\s*\('
      )
    );

  v_all_callers := concat_ws(', ',
    NULLIF(v_dep_callers, ''),
    NULLIF(v_text_callers, '')
  );

  IF v_all_callers IS NOT NULL AND v_all_callers != '' THEN
    RAISE EXCEPTION 'CONTRACT ABORTED: funcoes que ainda referenciam assinaturas antigas: %. Migre todos os callers para _v2 antes de aplicar o CONTRACT. Nenhuma funcao foi removida.', v_all_callers;
  END IF;

  RAISE NOTICE 'Safety check 2b OK: nenhuma dependencia ou referencia textual encontrada.';
END;
$$;

-- 1. REVOKE + DROP fn_access_complaint(text, text)
REVOKE EXECUTE ON FUNCTION public.fn_access_complaint(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION public.fn_access_complaint(text, text);

-- 2. REVOKE + DROP fn_send_reporter_message(text, text, text)
REVOKE EXECUTE ON FUNCTION public.fn_send_reporter_message(text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION public.fn_send_reporter_message(text, text, text);

-- 3. REVOKE + DROP fn_check_pin_rate_limit(text, integer, integer)
REVOKE EXECUTE ON FUNCTION public.fn_check_pin_rate_limit(text, integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION public.fn_check_pin_rate_limit(text, integer, integer);

-- Verificacao pos-CONTRACT
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'fn_access_complaint'
      AND array_length(p.proargtypes, 1) = 2
  ) THEN
    RAISE EXCEPTION 'CONTRACT FAILED: fn_access_complaint(text,text) ainda existe apos DROP.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'fn_send_reporter_message'
      AND array_length(p.proargtypes, 1) = 3
  ) THEN
    RAISE EXCEPTION 'CONTRACT FAILED: fn_send_reporter_message(text,text,text) ainda existe apos DROP.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'fn_check_pin_rate_limit'
      AND array_length(p.proargtypes, 1) = 3
  ) THEN
    RAISE EXCEPTION 'CONTRACT FAILED: fn_check_pin_rate_limit(text,integer,integer) ainda existe apos DROP.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'fn_access_complaint_v2'
  ) THEN
    RAISE EXCEPTION 'CONTRACT FAILED: fn_access_complaint_v2 desapareceu.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'fn_send_reporter_message_v2'
  ) THEN
    RAISE EXCEPTION 'CONTRACT FAILED: fn_send_reporter_message_v2 desapareceu.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'fn_check_pin_rate_limit_v2'
  ) THEN
    RAISE EXCEPTION 'CONTRACT FAILED: fn_check_pin_rate_limit_v2 desapareceu.';
  END IF;

  RAISE NOTICE 'CONTRACT concluido: funcoes antigas removidas, _v2 ativas.';
END;
$$;
