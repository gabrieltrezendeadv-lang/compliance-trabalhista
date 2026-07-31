-- =============================================================================
-- ROLLBACK — 20260802093000_billing_orchestration.sql
-- =============================================================================
--
-- Desfaz a orquestração da 12B, deixando a fundação da 12A exatamente como
-- estava — inclusive nos privilégios.
--
-- ── O QUE É DESFEITO ────────────────────────────────────────────────────────
--
--   1. as dezesseis RPCs de `public`;
--   2. os sete auxiliares internos de `billing`;
--   3. as duas triggers de cobrança;
--   4. as cinco tabelas novas;
--   5. as quatro colunas acrescentadas a `billing.audit_events`;
--   6. os quatro tipos novos;
--   7. os privilégios diretos que a 12B REVOGOU são DEVOLVIDOS ao
--      `service_role`, no exato regime da 12A.
--
-- O item 7 é a parte que um rollback descuidado esqueceria. A 12B tirou do
-- `service_role` o USAGE no schema e todo acesso às tabelas, porque passou a
-- escrever só por RPC. Desfazer a 12B sem devolver esses privilégios deixaria a
-- 12A instalada e inoperante — um estado que nunca existiu, e portanto pior do
-- que qualquer um dos dois.
--
-- ── O QUE **NÃO** PODE SER DESFEITO, E POR QUÊ ──────────────────────────────
--
-- Os dois valores acrescentados a `billing.audit_subject` — `'payment'` e
-- `'charge'` — PERMANECEM. O PostgreSQL não tem `ALTER TYPE ... DROP VALUE`:
-- remover um rótulo exigiria recriar o tipo e reescrever toda coluna que o usa.
-- São rótulos sem uso depois do rollback, porque as tabelas que os gravariam
-- somem junto.
--
-- ── LIMITE DECLARADO ────────────────────────────────────────────────────────
--
-- `DROP TABLE ... CASCADE` APAGA DADO. Enquanto a 12B estiver apenas instalada
-- e sem jornada — que é a situação desta etapa — não há dado a perder. A partir
-- do momento em que existir cobrança, ESTE ROLLBACK DEIXA DE SER SEGURO e não
-- deve ser executado sem extração prévia.
--
-- Serve à stack descartável e ao ensaio do CI. Não é plano de rollback de
-- produção.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. RPCs de `public` — a exceção nominal deixa de existir
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Por assinatura completa: `DROP FUNCTION` sem argumentos falha quando há
-- sobrecarga, e sobrecarga é justamente o que não pode sobrar para trás.

DROP FUNCTION IF EXISTS public.fn_billing_read_state(uuid, uuid);
DROP FUNCTION IF EXISTS public.fn_billing_read_catalog(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.fn_billing_read_ledger(uuid, uuid);
DROP FUNCTION IF EXISTS public.fn_billing_start_trial(
  uuid, uuid, text, text, text, integer, text, timestamptz, timestamptz,
  timestamptz, integer, text, text);
DROP FUNCTION IF EXISTS public.fn_billing_change_plan(
  uuid, uuid, text, text, text, text, timestamptz, timestamptz, integer, text,
  text, text, text, text, timestamptz);
DROP FUNCTION IF EXISTS public.fn_billing_schedule_downgrade(
  uuid, uuid, text, text, text, text, timestamptz);
DROP FUNCTION IF EXISTS public.fn_billing_cancel_at_period_end(
  uuid, uuid, text, text, timestamptz);
DROP FUNCTION IF EXISTS public.fn_billing_transition_state(
  uuid, uuid, text, text, text, text, timestamptz);
DROP FUNCTION IF EXISTS public.fn_billing_record_worker_count(
  uuid, uuid, integer, text, timestamptz);
DROP FUNCTION IF EXISTS public.fn_billing_claim_idempotency(
  uuid, uuid, text, text, text, text, text, timestamptz);
DROP FUNCTION IF EXISTS public.fn_billing_fail_idempotency(
  uuid, uuid, text, text, text, text, text, timestamptz);
DROP FUNCTION IF EXISTS public.fn_billing_finalize_checkout(
  uuid, uuid, text, text, text, text, text, integer, timestamptz, timestamptz,
  text, text, text, timestamptz);
DROP FUNCTION IF EXISTS public.fn_billing_apply_provider_event(
  text, text, text, text, text, timestamptz, text, timestamptz);
DROP FUNCTION IF EXISTS public.fn_billing_grant_courtesy(
  uuid, uuid, text, timestamptz, timestamptz, text, text);
DROP FUNCTION IF EXISTS public.fn_billing_revoke_courtesy(
  uuid, uuid, uuid, timestamptz, text, text);
DROP FUNCTION IF EXISTS public.fn_billing_save_grandfathering(
  uuid, uuid, timestamptz, timestamptz, text);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Tabelas, triggers e auxiliares internos
-- ─────────────────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS tg_charges_transition ON billing.charges;
DROP TRIGGER IF EXISTS tg_charges_immutable  ON billing.charges;

DROP TABLE IF EXISTS billing.provider_events CASCADE;
DROP TABLE IF EXISTS billing.courtesy_revocations CASCADE;
DROP TABLE IF EXISTS billing.idempotency_records CASCADE;
DROP TABLE IF EXISTS billing.charges CASCADE;
DROP TABLE IF EXISTS billing.customers CASCADE;

DROP FUNCTION IF EXISTS billing.fn_write_subscription(
  uuid, uuid, text, billing.plan_slug, billing.tier_slug, billing.billing_period,
  billing.subscription_state, integer, timestamptz, timestamptz, timestamptz,
  boolean, billing.plan_slug, billing.tier_slug, boolean, timestamptz, boolean,
  integer, text, billing.audit_subject, text, text, text, timestamptz);
DROP FUNCTION IF EXISTS billing.fn_charge_json(uuid);
DROP FUNCTION IF EXISTS billing.fn_subscription_json(uuid);
DROP FUNCTION IF EXISTS billing.fn_audit(
  uuid, uuid, billing.audit_subject, uuid, text, timestamptz, jsonb, jsonb,
  text, text, text);
DROP FUNCTION IF EXISTS billing.fn_require_member(uuid, uuid, boolean);
DROP FUNCTION IF EXISTS billing.fn_charges_transition();
DROP FUNCTION IF EXISTS billing.fn_charges_immutable();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Colunas e tipos
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE billing.audit_events
  DROP COLUMN IF EXISTS subscription_id,
  DROP COLUMN IF EXISTS origin,
  DROP COLUMN IF EXISTS idempotency_key,
  DROP COLUMN IF EXISTS correlation_id;

DROP TYPE IF EXISTS billing.idempotency_state;
DROP TYPE IF EXISTS billing.idempotency_scope;
DROP TYPE IF EXISTS billing.charge_method;
DROP TYPE IF EXISTS billing.charge_status;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Devolver os privilégios da 12A
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Regime exato de `20260801120000`: referência é só leitura; `subscriptions`
-- aceita atualização; o resto é append-only. Nada para anon/authenticated.

GRANT USAGE ON SCHEMA billing TO service_role;

DO $devolver$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tiers', 'price_catalog', 'subscriptions', 'price_snapshots',
    'grandfathering_cutoff', 'grandfathered_organizations', 'courtesies',
    'audit_events', 'legacy_plan_state'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE billing.%I FROM PUBLIC', t);
    EXECUTE format('REVOKE ALL ON TABLE billing.%I FROM anon', t);
    EXECUTE format('REVOKE ALL ON TABLE billing.%I FROM authenticated', t);

    IF t IN ('tiers', 'price_catalog', 'grandfathering_cutoff', 'legacy_plan_state') THEN
      EXECUTE format('GRANT SELECT ON TABLE billing.%I TO service_role', t);
    ELSIF t = 'subscriptions' THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE billing.%I TO service_role', t);
    ELSE
      EXECUTE format('GRANT SELECT, INSERT ON TABLE billing.%I TO service_role', t);
    END IF;
  END LOOP;
END
$devolver$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Conferência
-- ─────────────────────────────────────────────────────────────────────────────

DO $conferir$
DECLARE
  v_int integer;
  v_txt text;
BEGIN
  SELECT count(*) INTO v_int
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'billing' AND c.relkind = 'r';
  IF v_int <> 9 THEN
    RAISE EXCEPTION
      'apos o rollback da 12B esperavam-se as 9 tabelas da 12A, encontradas %', v_int;
  END IF;

  -- Nenhuma RPC de billing pode sobrar em `public`: a exceção nominal é da 12B,
  -- e a 12B acabou de ser desfeita.
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_txt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_billing\_%';
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'RPC(s) da 12B sobreviveram em public: %', v_txt;
  END IF;

  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_txt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'billing'
     AND p.proname IN ('fn_require_member', 'fn_audit', 'fn_subscription_json',
                       'fn_charge_json', 'fn_write_subscription',
                       'fn_charges_immutable', 'fn_charges_transition');
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'auxiliar(es) da 12B sobreviveram em billing: %', v_txt;
  END IF;

  IF to_regclass('billing.subscriptions') IS NULL
     OR to_regclass('billing.price_snapshots') IS NULL
     OR to_regclass('billing.audit_events') IS NULL THEN
    RAISE EXCEPTION 'o rollback da 12B derrubou tabela da 12A';
  END IF;

  SELECT count(*) INTO v_int
    FROM information_schema.columns
   WHERE table_schema = 'billing' AND table_name = 'audit_events'
     AND column_name IN ('subscription_id', 'origin', 'idempotency_key', 'correlation_id');
  IF v_int <> 0 THEN
    RAISE EXCEPTION 'colunas da 12B sobreviveram em audit_events (%)', v_int;
  END IF;

  -- Os privilégios da 12A voltaram: sem isto o rollback deixaria a fundação
  -- instalada e inalcançável.
  IF NOT has_schema_privilege('service_role', 'billing', 'USAGE') THEN
    RAISE EXCEPTION 'o rollback nao devolveu USAGE no schema billing';
  END IF;
  IF NOT has_table_privilege('service_role', 'billing.subscriptions', 'SELECT, INSERT, UPDATE') THEN
    RAISE EXCEPTION 'o rollback nao devolveu os privilegios da 12A em subscriptions';
  END IF;

  RAISE NOTICE
    'OK: 12B removida; fundacao da 12A intacta e com os privilegios devolvidos. '
    'Os rotulos payment/charge permanecem em billing.audit_subject.';
END
$conferir$;
