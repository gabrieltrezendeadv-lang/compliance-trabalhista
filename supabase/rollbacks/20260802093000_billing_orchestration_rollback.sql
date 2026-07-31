-- =============================================================================
-- ROLLBACK — 20260802093000_billing_orchestration.sql
-- =============================================================================
--
-- Desfaz a persistência da 12B, deixando a fundação da 12A intacta.
--
-- ── O QUE É DESFEITO ────────────────────────────────────────────────────────
--
--   1. as quatro tabelas novas;
--   2. as quatro colunas acrescentadas a `billing.audit_events`;
--   3. os três tipos novos.
--
-- ── O QUE **NÃO** PODE SER DESFEITO, E POR QUÊ ──────────────────────────────
--
-- Os dois valores acrescentados a `billing.audit_subject` — `'payment'` e
-- `'charge'` — PERMANECEM. O PostgreSQL não tem `ALTER TYPE ... DROP VALUE`:
-- remover um rótulo de enum exigiria recriar o tipo e reescrever toda coluna
-- que o usa, o que é destrutivo e desproporcional.
--
-- A permanência é inofensiva: são rótulos sem uso depois do rollback, porque a
-- única tabela que os gravaria some junto com o código da 12B. Está escrito
-- aqui, e não num comentário de commit, porque quem executar o rollback merece
-- saber exatamente o que sobra.
--
-- ── LIMITE DECLARADO ────────────────────────────────────────────────────────
--
-- `DROP TABLE ... CASCADE` APAGA DADO. Enquanto a 12B estiver apenas instalada
-- e sem jornada — que é a situação desta etapa — não há dado a perder: nenhuma
-- cobrança real existe. A partir do momento em que existir cobrança, ESTE
-- ROLLBACK DEIXA DE SER SEGURO e não deve ser executado sem extração prévia.
--
-- Este arquivo serve à stack descartável e ao ensaio do CI. Não é um plano de
-- rollback de produção.
-- =============================================================================

DROP TABLE IF EXISTS billing.courtesy_revocations CASCADE;
DROP TABLE IF EXISTS billing.idempotency_records CASCADE;
DROP TABLE IF EXISTS billing.charges CASCADE;
DROP TABLE IF EXISTS billing.customers CASCADE;

ALTER TABLE billing.audit_events
  DROP COLUMN IF EXISTS subscription_id,
  DROP COLUMN IF EXISTS origin,
  DROP COLUMN IF EXISTS idempotency_key,
  DROP COLUMN IF EXISTS correlation_id;

DROP TYPE IF EXISTS billing.idempotency_scope;
DROP TYPE IF EXISTS billing.charge_method;
DROP TYPE IF EXISTS billing.charge_status;

DO $conferir$
DECLARE
  v_int integer;
BEGIN
  SELECT count(*) INTO v_int
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'billing' AND c.relkind = 'r';
  IF v_int <> 9 THEN
    RAISE EXCEPTION
      'após o rollback da 12B esperavam-se as 9 tabelas da 12A, encontradas %', v_int;
  END IF;

  -- A fundação da 12A tem de continuar de pé — o rollback da 12B não a toca.
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

  RAISE NOTICE
    'OK: 12B removida; fundação da 12A intacta. Os rótulos payment/charge '
    'permanecem em billing.audit_subject — o PostgreSQL não remove valor de enum.';
END
$conferir$;
