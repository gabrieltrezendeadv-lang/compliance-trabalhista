-- =============================================================================
-- REMOÇÃO DAS FIXTURES DO CONTRATO, E CONFERÊNCIA DE QUE NADA SOBROU
-- =============================================================================
--
-- Uso:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f scripts/ci/teardown-contract-fixtures.sql
--
-- A ordem é a das dependências: primeiro o que referencia, depois o que é
-- referenciado. `ON DELETE RESTRICT` em billing é deliberado — nada de billing
-- some por cascata, e por isso a remoção é explícita, tabela por tabela.
--
-- A seção final é a que importa: se qualquer linha de fixture sobreviver, o
-- passo REPROVA. Uma limpeza que não confere o resultado não é limpeza.
-- =============================================================================

\set ON_ERROR_STOP on

-- Identifica as fixtures pelo prefixo determinístico do UUID.
\set PREFIXO '0c07a000-0000-4000-8000-%'

BEGIN;

-- ── POR QUE OS TRIGGERS SÃO DESLIGADOS AQUI ─────────────────────────────────
--
-- `tg_price_snapshot_immutable` e `tg_audit_events_append_only` recusam DELETE
-- — e é exatamente para isso que existem. A limpeza de fixture é o único caso
-- legítimo em que se precisa apagar, e ela roda como PROPRIETÁRIO, contra a
-- stack descartável, dentro desta transação.
--
-- `SET LOCAL` limita o efeito a esta transação: o COMMIT o desfaz, e nenhuma
-- outra sessão enxerga o afrouxamento. A imutabilidade continua valendo para
-- todo o resto, e `assert-billing-orchestration.sql` a exercita.
SET LOCAL session_replication_role = replica;

DELETE FROM billing.provider_events
 WHERE organization_id::text LIKE :'PREFIXO';

DELETE FROM billing.charges
 WHERE organization_id::text LIKE :'PREFIXO';

DELETE FROM billing.idempotency_records
 WHERE organization_id::text LIKE :'PREFIXO';

DELETE FROM billing.customers
 WHERE organization_id::text LIKE :'PREFIXO';

DELETE FROM billing.courtesy_revocations
 WHERE organization_id::text LIKE :'PREFIXO';

DELETE FROM billing.courtesies
 WHERE organization_id::text LIKE :'PREFIXO';

DELETE FROM billing.grandfathered_organizations
 WHERE organization_id::text LIKE :'PREFIXO';

DELETE FROM billing.price_snapshots
 WHERE subscription_id IN (
   SELECT id FROM billing.subscriptions
    WHERE organization_id::text LIKE :'PREFIXO'
 );

DELETE FROM billing.audit_events
 WHERE organization_id::text LIKE :'PREFIXO';

DELETE FROM billing.subscriptions
 WHERE organization_id::text LIKE :'PREFIXO';

DELETE FROM public.organization_members
 WHERE tenant_id::text LIKE :'PREFIXO';

DELETE FROM public.organizations
 WHERE id::text LIKE :'PREFIXO';

DELETE FROM public.profiles
 WHERE id::text LIKE :'PREFIXO';

DELETE FROM auth.users
 WHERE id::text LIKE :'PREFIXO';

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Conferência: nenhuma fixture sobreviveu
-- ─────────────────────────────────────────────────────────────────────────────

DO $conferir$
DECLARE
  v_txt text;
BEGIN
  SELECT string_agg(format('%s=%s', origem, quantidade), ', ')
    INTO v_txt
    FROM (
      SELECT 'billing.subscriptions' AS origem, count(*) AS quantidade
        FROM billing.subscriptions
       WHERE organization_id::text LIKE '0c07a000-0000-4000-8000-%'
      UNION ALL
      SELECT 'billing.charges', count(*) FROM billing.charges
       WHERE organization_id::text LIKE '0c07a000-0000-4000-8000-%'
      UNION ALL
      SELECT 'billing.idempotency_records', count(*) FROM billing.idempotency_records
       WHERE organization_id::text LIKE '0c07a000-0000-4000-8000-%'
      UNION ALL
      SELECT 'billing.provider_events', count(*) FROM billing.provider_events
       WHERE organization_id::text LIKE '0c07a000-0000-4000-8000-%'
      UNION ALL
      SELECT 'billing.courtesies', count(*) FROM billing.courtesies
       WHERE organization_id::text LIKE '0c07a000-0000-4000-8000-%'
      UNION ALL
      SELECT 'billing.audit_events', count(*) FROM billing.audit_events
       WHERE organization_id::text LIKE '0c07a000-0000-4000-8000-%'
      UNION ALL
      SELECT 'public.organizations', count(*) FROM public.organizations
       WHERE id::text LIKE '0c07a000-0000-4000-8000-%'
      UNION ALL
      SELECT 'public.organization_members', count(*) FROM public.organization_members
       WHERE tenant_id::text LIKE '0c07a000-0000-4000-8000-%'
    ) s
   WHERE quantidade > 0;

  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'contrato/teardown: fixture(s) sobreviveram — %', v_txt;
  END IF;

  RAISE NOTICE 'contrato/teardown OK: nenhuma fixture sobreviveu';
END
$conferir$;
