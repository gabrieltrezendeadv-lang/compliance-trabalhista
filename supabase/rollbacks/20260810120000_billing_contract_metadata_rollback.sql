-- =============================================================================
-- ROLLBACK DA ETAPA 12C.1 — METADADOS CONTRATUAIS E CONTATO FINANCEIRO
-- =============================================================================
--
-- Desfaz `20260810120000_billing_contract_metadata.sql` e SÓ ela. Não toca em
-- nada da 12A, da 12B ou das 36 históricas.
--
-- ── ELE ABORTA SE HOUVER ACEITE REAL ────────────────────────────────────────
--
-- Remover `terms_version`/`terms_accepted_at` de uma linha que os tem apaga a
-- prova de que alguém aceitou um contrato. Isso não é reversão, é destruição de
-- prova — e um rollback que a executa em silêncio é pior do que rollback
-- nenhum, porque devolve a sensação de que dá para voltar.
--
-- Por isso a PRIMEIRA coisa aqui é uma barreira: se qualquer assinatura tiver
-- e-mail financeiro, versão de termos ou instante de aceite; ou se a trilha já
-- registrar `terms_acceptance` ou `billing_email`, este arquivo ABORTA com
-- diagnóstico — quantas linhas, quais organizações — e não remove nada.
--
-- Voltar atrás nessa situação é decisão humana, com destino declarado para o
-- dado contratual. Não é `psql -f`.
--
-- ── O QUE NÃO VOLTA, E ESTÁ DITO ────────────────────────────────────────────
--
-- Os rótulos `terms_acceptance` e `billing_email` PERMANECEM em
-- `billing.audit_subject`. O PostgreSQL não tem `ALTER TYPE ... DROP VALUE`, e
-- recriar o enum exigiria derrubar a coluna `subject` de `audit_events` — ou
-- seja, a trilha inteira. Rótulo sem uso não concede privilégio, não guarda
-- dado e não altera comportamento. Está registrado aqui porque fingir reversão
-- total seria mentira, não porque seja risco.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. BARREIRA — nenhum dado contratual pode ser destruído em silêncio
-- ─────────────────────────────────────────────────────────────────────────────

DO $barreira$
DECLARE
  v_subs  integer;
  v_orgs  text;
  v_trilha integer;
BEGIN
  SELECT count(*), string_agg(DISTINCT s.organization_id::text, ', ')
    INTO v_subs, v_orgs
    FROM billing.subscriptions s
   WHERE s.billing_email IS NOT NULL
      OR s.terms_version IS NOT NULL
      OR s.terms_accepted_at IS NOT NULL;

  -- `::text` de propósito: comparar por rótulo evita depender de o valor de
  -- enum estar utilizável nesta transação.
  SELECT count(*) INTO v_trilha
    FROM billing.audit_events ae
   WHERE ae.subject::text IN ('terms_acceptance', 'billing_email');

  IF v_subs > 0 OR v_trilha > 0 THEN
    RAISE EXCEPTION
      'ROLLBACK 20260810120000 ABORTADO: existe dado contratual que seria destruido'
      USING DETAIL = format(
        '%s assinatura(s) com e-mail financeiro, versao ou instante de aceite '
        '(organizacoes: %s); %s evento(s) de auditoria de aceite ou de contato. '
        'Remover as colunas apagaria prova de aceite contratual.',
        v_subs, coalesce(v_orgs, '-'), v_trilha),
      HINT = 'Decida o destino do dado contratual antes de reverter. '
             'Este rollback nao decide isso por voce.';
  END IF;

  RAISE NOTICE
    'ROLLBACK 20260810120000: nenhuma assinatura com dado contratual, nenhum evento de aceite';
END
$barreira$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. AS DUAS RPCs INTRODUZIDAS AQUI — e só elas
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.fn_billing_update_billing_email(
  uuid, uuid, text, timestamptz, text
);
DROP FUNCTION IF EXISTS public.fn_billing_accept_terms(
  uuid, uuid, text, timestamptz, text
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. A ASSINATURA ANTERIOR DE `fn_billing_start_trial`, EXATA
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Corpo idêntico ao de `20260802093000_billing_orchestration.sql` §9.2. Não é
-- "equivalente": é o mesmo, para que o estado após o rollback seja o estado
-- anterior, e não uma terceira coisa parecida.

DROP FUNCTION IF EXISTS public.fn_billing_start_trial(
  uuid, uuid, text, text, text, integer, text,
  timestamptz, timestamptz, timestamptz, integer, text, text, text, text, timestamptz
);

CREATE OR REPLACE FUNCTION public.fn_billing_start_trial(
  p_actor_id uuid,
  p_organization_id uuid,
  p_plan text,
  p_tier text,
  p_period text,
  p_worker_count integer,
  p_cnpj text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_trial_ends_at timestamptz,
  p_amount_cents integer,
  p_catalog_version text,
  p_correlation_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_id uuid;
BEGIN
  PERFORM billing.fn_require_member(p_actor_id, p_organization_id, true);

  IF p_cnpj IS NULL OR btrim(p_cnpj) = '' THEN
    RAISE EXCEPTION 'billing: CNPJ e obrigatorio para iniciar o trial'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_worker_count IS NULL OR p_worker_count < 1 THEN
    RAISE EXCEPTION 'billing: numero de trabalhadores invalido'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  INSERT INTO billing.subscriptions (
    organization_id, plan, tier, period, state, worker_count, cnpj,
    current_period_start, current_period_end, trial_ends_at
  ) VALUES (
    p_organization_id, p_plan::billing.plan_slug, p_tier::billing.tier_slug,
    p_period::billing.billing_period, 'trialing', p_worker_count, p_cnpj,
    p_period_start, p_period_end, p_trial_ends_at
  )
  RETURNING id INTO v_id;

  IF p_amount_cents IS NOT NULL AND p_catalog_version IS NOT NULL THEN
    INSERT INTO billing.price_snapshots (
      subscription_id, plan, tier, period, amount_cents, catalog_version, captured_at
    ) VALUES (
      v_id, p_plan::billing.plan_slug, p_tier::billing.tier_slug,
      p_period::billing.billing_period, p_amount_cents, p_catalog_version,
      p_period_start
    );
  END IF;

  PERFORM billing.fn_audit(
    p_organization_id, v_id, 'subscription_state', p_actor_id, 'owner',
    p_period_start, NULL,
    jsonb_build_object('state', 'trialing', 'plan', p_plan, 'tier', p_tier,
                       'trialEndsAt', p_trial_ends_at),
    'inicio de trial', NULL, p_correlation_id
  );

  RETURN billing.fn_subscription_json(p_organization_id);
END
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. SERIALIZAÇÃO ANTERIOR — antes de as colunas sumirem
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION billing.fn_subscription_json(p_organization_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $fn$
  SELECT to_jsonb(x) FROM (
    SELECT s.id,
           s.organization_id,
           s.plan::text          AS plan,
           s.tier::text          AS tier,
           s.period::text        AS period,
           s.state::text         AS state,
           s.worker_count,
           s.cnpj,
           s.current_period_start,
           s.current_period_end,
           s.trial_ends_at,
           s.payment_failed_at,
           s.scheduled_downgrade_plan::text AS scheduled_downgrade_plan,
           s.scheduled_downgrade_tier::text AS scheduled_downgrade_tier,
           (SELECT to_jsonb(y) FROM (
              SELECT ps.plan::text AS plan, ps.tier::text AS tier,
                     ps.period::text AS period,
                     ps.amount_cents, ps.catalog_version, ps.captured_at
                FROM billing.price_snapshots ps
               WHERE ps.subscription_id = s.id
               ORDER BY ps.captured_at DESC, ps.created_at DESC
               LIMIT 1
            ) y) AS price_snapshot
      FROM billing.subscriptions s
     WHERE s.organization_id = p_organization_id
  ) x;
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. AUXILIARES INTRODUZIDOS AQUI
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS billing.fn_mask_email(text);
DROP FUNCTION IF EXISTS billing.fn_normalize_email(text);
DROP FUNCTION IF EXISTS billing.fn_require_terms_version(text);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. AS TRÊS COLUNAS E SEUS CHECKs
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Só chega aqui quem passou pela barreira do §0: nenhuma linha tem valor.

ALTER TABLE billing.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_termos_par_completo,
  DROP CONSTRAINT IF EXISTS subscriptions_termos_versao_valida,
  DROP CONSTRAINT IF EXISTS subscriptions_billing_email_valido;

ALTER TABLE billing.subscriptions
  DROP COLUMN IF EXISTS billing_email,
  DROP COLUMN IF EXISTS terms_version,
  DROP COLUMN IF EXISTS terms_accepted_at;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. ACL, OWNER E `search_path` DE VOLTA AO REGIME DA 12B
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  r record;
  v_int integer := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS assinatura
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_billing\_%'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.assinatura);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.assinatura);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', r.assinatura);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.assinatura);
    v_int := v_int + 1;
  END LOOP;

  IF v_int <> 16 THEN
    RAISE EXCEPTION
      'ROLLBACK 20260810120000: esperadas 16 RPCs apos reverter, encontradas %', v_int;
  END IF;
END
$$;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS assinatura
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'billing'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.assinatura);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.assinatura);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', r.assinatura);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM service_role', r.assinatura);
  END LOOP;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. PÓS-CONDIÇÕES DO ROLLBACK
-- ─────────────────────────────────────────────────────────────────────────────

DO $pc_rollback$
DECLARE
  v_int integer;
  v_txt text;
BEGIN
  SELECT count(*) INTO v_int
    FROM information_schema.columns
   WHERE table_schema = 'billing' AND table_name = 'subscriptions'
     AND column_name IN ('billing_email', 'terms_version', 'terms_accepted_at');
  IF v_int <> 0 THEN
    RAISE EXCEPTION 'ROLLBACK 20260810120000: % coluna(s) contratual(is) sobreviveram', v_int;
  END IF;

  SELECT count(*) INTO v_int
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_billing\_%';
  IF v_int <> 16 THEN
    RAISE EXCEPTION 'ROLLBACK 20260810120000: % RPCs em public, esperadas 16', v_int;
  END IF;

  IF to_regprocedure(
       'public.fn_billing_start_trial(uuid, uuid, text, text, text, integer, text, '
       'timestamp with time zone, timestamp with time zone, timestamp with time zone, '
       'integer, text, text)'
     ) IS NULL THEN
    RAISE EXCEPTION
      'ROLLBACK 20260810120000: a assinatura ANTERIOR de fn_billing_start_trial nao voltou';
  END IF;

  SELECT string_agg(e, ', ') INTO v_txt
    FROM unnest(ARRAY[
      'public.fn_billing_update_billing_email(uuid, uuid, text, timestamp with time zone, text)',
      'public.fn_billing_accept_terms(uuid, uuid, text, timestamp with time zone, text)',
      'public.fn_billing_start_trial(uuid, uuid, text, text, text, integer, text, '
        'timestamp with time zone, timestamp with time zone, timestamp with time zone, '
        'integer, text, text, text, text, timestamp with time zone)'
    ]) AS e
   WHERE to_regprocedure(e) IS NOT NULL;
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK 20260810120000: objeto da 12C.1 sobreviveu: %', v_txt;
  END IF;

  SELECT string_agg(p.proname, ', ') INTO v_txt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'billing'
     AND p.proname IN ('fn_mask_email', 'fn_normalize_email', 'fn_require_terms_version');
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK 20260810120000: auxiliar da 12C.1 sobreviveu: %', v_txt;
  END IF;

  SELECT string_agg(format('%s para %s', p.oid::regprocedure::text, papel), ', ')
    INTO v_txt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN unnest(ARRAY['anon', 'authenticated']) AS papel
   WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_billing\_%'
     AND has_function_privilege(papel, p.oid, 'EXECUTE');
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK 20260810120000: EXECUTE indevido apos reverter: %', v_txt;
  END IF;

  RAISE NOTICE
    'ROLLBACK 20260810120000 OK: 16 RPCs, assinatura anterior restaurada, colunas removidas';
  RAISE NOTICE
    'ROLLBACK 20260810120000: os rotulos terms_acceptance e billing_email PERMANECEM em billing.audit_subject (PostgreSQL nao remove valor de enum)';
END
$pc_rollback$;
