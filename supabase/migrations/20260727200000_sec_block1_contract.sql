-- =============================================================================
-- SEC-BLOCK1-CONSOLIDATION v1.2.2 — CONTRACT PHASE
-- Estrategia expand–migrate–contract para zero downtime.
--
-- PRE-REQUISITOS:
--   1. EXPAND (20260727100000) aplicado com sucesso
--   2. Gateway TS atualizado para chamar funcoes _v2
--   3. Deploy completo com _v2 verificado em preview/staging
--   4. Nenhum caller usando as assinaturas antigas
--
-- CONTRACT: Remove funcoes antigas que foram substituidas por _v2.
--   - DROP fn_access_complaint(text, text) — substituida por _v2(text,text,text)
--   - DROP fn_send_reporter_message(text, text, text) — substituida por _v2(text,text,text,text)
--   - DROP fn_check_pin_rate_limit(text, integer, integer) — substituida por _v2(text,text,int,int,int)
--
-- IMPORTANTE: Nao execute ate que TODOS os callers tenham sido migrados para _v2.
--             Execute a query de diagnostico abaixo para confirmar.
--
-- CONVENCOES:
--   - REVOKE EXECUTE (nunca REVOKE ALL)
--   - RAISE EXCEPTION para abortar (nunca RAISE WARNING em safety checks)
--   - Verificacao por pg_proc com OIDs e assinaturas exatas
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- Safety check 1: Confirma que o EXPAND foi aplicado (_v2 existem)
--                 Usa pg_get_function_identity_arguments para assinatura exata
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_fn_oid oid;
BEGIN
  -- Verificar fn_access_complaint_v2(text, text, text)
  SELECT p.oid INTO v_fn_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'fn_access_complaint_v2'
    AND pg_get_function_identity_arguments(p.oid) = 'p_protocol text, p_pin_hash text, p_caller_ip_hash text';

  IF v_fn_oid IS NULL THEN
    -- Tentar match apenas por nome (assinatura pode variar em nomes de parametros)
    SELECT p.oid INTO v_fn_oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'fn_access_complaint_v2'
      AND array_length(p.proargtypes, 1) = 3;

    IF v_fn_oid IS NULL THEN
      RAISE EXCEPTION 'CONTRACT ABORTED: fn_access_complaint_v2(text,text,text) nao encontrada. '
        'O EXPAND deve ser aplicado antes do CONTRACT.';
    END IF;
  END IF;

  -- Verificar fn_send_reporter_message_v2(text, text, text, text)
  v_fn_oid := NULL;
  SELECT p.oid INTO v_fn_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'fn_send_reporter_message_v2'
    AND array_length(p.proargtypes, 1) = 4;

  IF v_fn_oid IS NULL THEN
    RAISE EXCEPTION 'CONTRACT ABORTED: fn_send_reporter_message_v2(text,text,text,text) nao encontrada. '
      'O EXPAND deve ser aplicado antes do CONTRACT.';
  END IF;

  -- Verificar fn_check_pin_rate_limit_v2(text, text, integer, integer, integer)
  v_fn_oid := NULL;
  SELECT p.oid INTO v_fn_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'fn_check_pin_rate_limit_v2'
    AND array_length(p.proargtypes, 1) = 5;

  IF v_fn_oid IS NULL THEN
    RAISE EXCEPTION 'CONTRACT ABORTED: fn_check_pin_rate_limit_v2(text,text,int,int,int) nao encontrada. '
      'O EXPAND deve ser aplicado antes do CONTRACT.';
  END IF;

  RAISE NOTICE 'Safety check 1 OK: todas as funcoes _v2 existem.';
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Safety check 2: Confirma que funcoes antigas existem (pre-condicao para DROP)
--                 e que nenhuma outra funcao as referencia (nenhum caller SQL)
--
-- Usa pg_proc com OIDs, pg_depend e busca textual em pg_get_functiondef.
-- RAISE EXCEPTION (nao WARNING) — estado parcial nao e permitido.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_fn_access_oid      oid;
  v_fn_message_oid     oid;
  v_fn_ratelimit_oid   oid;
  v_dep_callers        text;
  v_text_callers       text;
  v_all_callers        text;
BEGIN
  -- ── Localizar funcoes antigas por assinatura exata ──────────────────────

  -- fn_access_complaint(text, text) — 2 parametros text
  SELECT p.oid INTO v_fn_access_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'fn_access_complaint'
    AND array_length(p.proargtypes, 1) = 2
    AND p.proargtypes[0] = 'text'::regtype
    AND p.proargtypes[1] = 'text'::regtype;

  IF v_fn_access_oid IS NULL THEN
    RAISE EXCEPTION 'CONTRACT ABORTED: fn_access_complaint(text,text) nao encontrada. '
      'A funcao antiga ja foi removida ou nunca existiu. Estado inconsistente.';
  END IF;

  -- fn_send_reporter_message(text, text, text) — 3 parametros text
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
    RAISE EXCEPTION 'CONTRACT ABORTED: fn_send_reporter_message(text,text,text) nao encontrada. '
      'A funcao antiga ja foi removida ou nunca existiu. Estado inconsistente.';
  END IF;

  -- fn_check_pin_rate_limit(text, integer, integer) — 1 text + 2 integer
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
    RAISE EXCEPTION 'CONTRACT ABORTED: fn_check_pin_rate_limit(text,integer,integer) nao encontrada. '
      'A funcao antiga ja foi removida ou nunca existiu. Estado inconsistente.';
  END IF;

  RAISE NOTICE 'Safety check 2a OK: funcoes antigas localizadas (OIDs: %, %, %).',
    v_fn_access_oid, v_fn_message_oid, v_fn_ratelimit_oid;

  -- ── Verificar dependencias via pg_depend ───────────────────────────────
  -- pg_depend captura dependencias formais (triggers, views, etc.)

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

  -- ── Verificar referencias textuais em pg_get_functiondef ───────────────
  -- plpgsql resolve em runtime, pg_depend pode nao capturar tudo.
  -- Busca textual complementar, excluindo _v2 e as proprias funcoes antigas.

  SELECT string_agg(
    n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
    ', '
  )
  INTO v_text_callers
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prokind = 'f'  -- Apenas funcoes regulares (exclui aggregates, window, procedures)
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

  -- ── Consolidar resultados ──────────────────────────────────────────────
  v_all_callers := concat_ws(', ',
    NULLIF(v_dep_callers, ''),
    NULLIF(v_text_callers, '')
  );

  IF v_all_callers IS NOT NULL AND v_all_callers != '' THEN
    RAISE EXCEPTION 'CONTRACT ABORTED: funcoes que ainda referenciam assinaturas antigas: %. '
      'Migre todos os callers para _v2 antes de aplicar o CONTRACT. '
      'Nenhuma funcao foi removida.', v_all_callers;
  END IF;

  RAISE NOTICE 'Safety check 2b OK: nenhuma dependencia ou referencia textual encontrada.';
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- QUERY DE DIAGNOSTICO (para execucao manual antes de aplicar o CONTRACT)
-- Executar esta query via SQL Editor para confirmar que nao ha callers:
--
-- SELECT p.proname,
--        pg_get_function_identity_arguments(p.oid) AS args,
--        CASE
--          WHEN pg_get_functiondef(p.oid) ~* 'fn_access_complaint\s*\('
--               AND pg_get_functiondef(p.oid) !~* 'fn_access_complaint_v2\s*\('
--          THEN 'chama fn_access_complaint (antiga)'
--          WHEN pg_get_functiondef(p.oid) ~* 'fn_send_reporter_message\s*\('
--               AND pg_get_functiondef(p.oid) !~* 'fn_send_reporter_message_v2\s*\('
--          THEN 'chama fn_send_reporter_message (antiga)'
--          WHEN pg_get_functiondef(p.oid) ~* 'fn_check_pin_rate_limit\s*\('
--               AND pg_get_functiondef(p.oid) !~* 'fn_check_pin_rate_limit_v2\s*\('
--          THEN 'chama fn_check_pin_rate_limit (antiga)'
--        END AS referencia
-- FROM pg_proc p
-- JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public'
--   AND p.oid NOT IN (
--     -- Excluir as proprias funcoes antigas
--     SELECT p2.oid FROM pg_proc p2
--     JOIN pg_namespace n2 ON n2.oid = p2.pronamespace
--     WHERE n2.nspname = 'public'
--       AND p2.proname IN ('fn_access_complaint','fn_send_reporter_message','fn_check_pin_rate_limit')
--       AND p2.proname NOT LIKE '%_v2'
--   )
--   AND (
--     (pg_get_functiondef(p.oid) ~* 'fn_access_complaint\s*\('
--      AND pg_get_functiondef(p.oid) !~* 'fn_access_complaint_v2\s*\(')
--     OR
--     (pg_get_functiondef(p.oid) ~* 'fn_send_reporter_message\s*\('
--      AND pg_get_functiondef(p.oid) !~* 'fn_send_reporter_message_v2\s*\(')
--     OR
--     (pg_get_functiondef(p.oid) ~* 'fn_check_pin_rate_limit\s*\('
--      AND pg_get_functiondef(p.oid) !~* 'fn_check_pin_rate_limit_v2\s*\(')
--   );
--
-- Se retornar 0 linhas: seguro para CONTRACT.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. REVOKE + DROP fn_access_complaint(text, text) — assinatura antiga SEC-003
--    Substituida por fn_access_complaint_v2(text, text, text)
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.fn_access_complaint(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION public.fn_access_complaint(text, text);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. REVOKE + DROP fn_send_reporter_message(text, text, text) — assinatura antiga
--    Substituida por fn_send_reporter_message_v2(text, text, text, text)
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.fn_send_reporter_message(text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION public.fn_send_reporter_message(text, text, text);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. REVOKE + DROP fn_check_pin_rate_limit(text, integer, integer) — assinatura antiga
--    Substituida por fn_check_pin_rate_limit_v2(text, text, int, int, int)
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.fn_check_pin_rate_limit(text, integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION public.fn_check_pin_rate_limit(text, integer, integer);

-- ─────────────────────────────────────────────────────────────────────────────
-- Verificacao pos-CONTRACT: confirmar que apenas _v2 permanecem
-- Usa assinatura exata (array_length) para evitar falsos positivos
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  -- Confirmar que fn_access_complaint antiga (2 args) nao existe mais
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'fn_access_complaint'
      AND array_length(p.proargtypes, 1) = 2
  ) THEN
    RAISE EXCEPTION 'CONTRACT FAILED: fn_access_complaint(text,text) ainda existe apos DROP.';
  END IF;

  -- Confirmar que fn_send_reporter_message antiga (3 args) nao existe mais
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'fn_send_reporter_message'
      AND array_length(p.proargtypes, 1) = 3
  ) THEN
    RAISE EXCEPTION 'CONTRACT FAILED: fn_send_reporter_message(text,text,text) ainda existe apos DROP.';
  END IF;

  -- Confirmar que fn_check_pin_rate_limit antiga (3 args) nao existe mais
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'fn_check_pin_rate_limit'
      AND array_length(p.proargtypes, 1) = 3
  ) THEN
    RAISE EXCEPTION 'CONTRACT FAILED: fn_check_pin_rate_limit(text,integer,integer) ainda existe apos DROP.';
  END IF;

  -- Confirmar que _v2 ainda existem
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

COMMIT;
