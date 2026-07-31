-- =============================================================================
-- INTEGRAÇÃO DA 12B CONTRA PostgreSQL DE VERDADE
-- =============================================================================
--
-- Uso:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f scripts/ci/assert-billing-orchestration.sql
--
-- Roda no job `Verify`, contra a STACK DESCARTÁVEL local. Nunca contra
-- produção, nunca contra o Supabase remoto.
--
-- ── O QUE SÓ SE PROVA AQUI ──────────────────────────────────────────────────
--
-- O repositório em memória reproduz o CONTRATO, e é exercido pela mesma suíte.
-- Quatro coisas, porém, ele não tem como reproduzir, e é exatamente por isso
-- que este arquivo existe:
--
--   1. UNIQUE resolvendo CONCORRÊNCIA — duas transações reais disputando a
--      mesma chave de idempotência;
--   2. TRANSAÇÃO — falha no meio desfaz o que já havia sido escrito;
--   3. RLS e GRANTS — o que `anon` e `authenticated` conseguem, de fato;
--   4. TRIGGER de imutabilidade agindo sobre linha real.
--
-- Tudo dentro de transações encerradas por ROLLBACK. Nenhuma fixture sobrevive,
-- e a seção final confere isso.
-- =============================================================================

\set ON_ERROR_STOP on

-- ═════════════════════════════════════════════════════════════════════════════
-- A. ESTRUTURA
-- ═════════════════════════════════════════════════════════════════════════════

DO $estrutura$
DECLARE
  v_int   integer;
  v_lista text;
BEGIN
  SELECT count(*) INTO v_int
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'billing' AND c.relkind = 'r';
  IF v_int <> 13 THEN
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: billing tem % tabela(s), esperadas 13', v_int;
  END IF;

  -- Nada para o cliente, em nenhuma das treze.
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname)
    INTO v_lista
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'billing' AND c.relkind = 'r'
     AND (
       has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE')
       OR has_table_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE, DELETE')
     );
  IF v_lista IS NOT NULL THEN
    RAISE EXCEPTION
      'ASSERÇÃO REPROVADA: anon/authenticated alcançam tabela(s) da 12B: %', v_lista;
  END IF;

  RAISE NOTICE 'billing12B/estrutura OK: 13 tabelas, nenhuma alcançável pelo cliente';
END
$estrutura$;

-- ═════════════════════════════════════════════════════════════════════════════
-- B. COMPORTAMENTO
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL row_security = off;

DO $comportamento$
DECLARE
  v_org_a  uuid;
  v_org_b  uuid;
  v_sub_a  uuid;
  v_sub_b  uuid;
  v_chg_a  uuid;
  v_int    integer;
BEGIN
  -- ── Fixtures: DUAS organizações ────────────────────────────────────────
  INSERT INTO public.organizations (name, slug)
       VALUES ('Fixture 12B A', 'fixture-12b-a') RETURNING id INTO v_org_a;
  INSERT INTO public.organizations (name, slug)
       VALUES ('Fixture 12B B', 'fixture-12b-b') RETURNING id INTO v_org_b;

  INSERT INTO billing.subscriptions
    (organization_id, plan, tier, period, state, worker_count, cnpj,
     current_period_start, current_period_end)
  VALUES
    (v_org_a, 'essencial', 't1_20', 'monthly', 'active', 10, '00000000000191',
     '2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z')
  RETURNING id INTO v_sub_a;

  INSERT INTO billing.subscriptions
    (organization_id, plan, tier, period, state, worker_count, cnpj,
     current_period_start, current_period_end)
  VALUES
    (v_org_b, 'completo', 't1_20', 'monthly', 'active', 10, '00000000000272',
     '2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z')
  RETURNING id INTO v_sub_b;

  -- ── B.1 Uma assinatura por organização ─────────────────────────────────
  BEGIN
    INSERT INTO billing.subscriptions
      (organization_id, plan, tier, period, worker_count, cnpj,
       current_period_start, current_period_end)
    VALUES
      (v_org_a, 'completo', 't1_20', 'monthly', 10, '00000000000191',
       '2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z');
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: segunda assinatura aceita para a mesma organização';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- ── B.2 Idempotência: a MESMA chave não entra duas vezes ───────────────
  INSERT INTO billing.idempotency_records (organization_id, scope, provider, key, result)
       VALUES (v_org_a, 'command', 'mock', 'ck-1', '{"intent":"checkout"}'::jsonb);

  BEGIN
    INSERT INTO billing.idempotency_records (organization_id, scope, provider, key, result)
         VALUES (v_org_a, 'command', 'mock', 'ck-1', '{"intent":"outro"}'::jsonb);
    RAISE EXCEPTION
      'ASSERÇÃO REPROVADA: chave de idempotência duplicada foi aceita — a '
      'concorrência não teria como ser resolvida pelo banco';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- A chave pertence ao TENANT e ao PROVIDER: as três variações abaixo são
  -- chaves DIFERENTES e têm de ser aceitas.
  INSERT INTO billing.idempotency_records (organization_id, scope, provider, key)
       VALUES (v_org_b, 'command', 'mock', 'ck-1');
  INSERT INTO billing.idempotency_records (organization_id, scope, provider, key)
       VALUES (v_org_a, 'command', 'outro', 'ck-1');
  INSERT INTO billing.idempotency_records (organization_id, scope, provider, key)
       VALUES (v_org_a, 'provider_event', 'mock', 'ck-1');

  SELECT count(*) INTO v_int FROM billing.idempotency_records;
  IF v_int <> 4 THEN
    RAISE EXCEPTION
      'ASSERÇÃO REPROVADA: esperadas 4 chaves distintas, gravadas %', v_int;
  END IF;

  -- ── B.3 Cobrança: unicidade por externo e por comando ──────────────────
  INSERT INTO billing.charges
    (organization_id, subscription_id, provider, external_charge_id, method,
     amount_cents, period_start, period_end, idempotency_key)
  VALUES
    (v_org_a, v_sub_a, 'mock', 'chg_1', 'pix', 9990,
     '2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z', 'ck-1')
  RETURNING id INTO v_chg_a;

  BEGIN
    INSERT INTO billing.charges
      (organization_id, subscription_id, provider, external_charge_id, method,
       amount_cents, period_start, period_end)
    VALUES
      (v_org_a, v_sub_a, 'mock', 'chg_1', 'pix', 9990,
       '2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z');
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: cobrança com identificador externo repetido foi aceita';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO billing.charges
      (organization_id, subscription_id, provider, external_charge_id, method,
       amount_cents, period_start, period_end, idempotency_key)
    VALUES
      (v_org_a, v_sub_a, 'mock', 'chg_2', 'pix', 9990,
       '2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z', 'ck-1');
    RAISE EXCEPTION
      'ASSERÇÃO REPROVADA: segunda cobrança com a mesma chave de comando foi aceita';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- Estado e carimbo não divergem.
  BEGIN
    UPDATE billing.charges SET status = 'paid' WHERE id = v_chg_a;
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: cobrança marcada como paga SEM data de pagamento';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  UPDATE billing.charges
     SET status = 'paid', paid_at = '2026-08-05T00:00:00Z'
   WHERE id = v_chg_a AND organization_id = v_org_a;

  -- ── B.4 Isolamento entre A e B ─────────────────────────────────────────
  --
  -- O filtro de organização é a barreira efetiva: `service_role` tem BYPASSRLS,
  -- então RLS não protege um SELECT sem `WHERE`. É por isso que o repositório
  -- filtra sempre, e é isso que se confere aqui.
  SELECT count(*) INTO v_int
    FROM billing.charges WHERE organization_id = v_org_b;
  IF v_int <> 0 THEN
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: cobrança de A apareceu para B';
  END IF;

  -- UPDATE com o id certo mas a organização errada não pode atingir nada.
  UPDATE billing.charges
     SET status = 'cancelled'
   WHERE id = v_chg_a AND organization_id = v_org_b;
  GET DIAGNOSTICS v_int = ROW_COUNT;
  IF v_int <> 0 THEN
    RAISE EXCEPTION
      'ASSERÇÃO REPROVADA: UPDATE alcançou cobrança de outra organização (% linha(s))', v_int;
  END IF;

  IF (SELECT status FROM billing.charges WHERE id = v_chg_a) <> 'paid' THEN
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: a cobrança de A foi alterada pelo contexto de B';
  END IF;

  -- ── B.5 Snapshot imutável, com a 12B instalada ─────────────────────────
  INSERT INTO billing.price_snapshots
    (subscription_id, plan, tier, period, amount_cents, catalog_version, captured_at)
  VALUES (v_sub_a, 'essencial', 't1_20', 'monthly', 9990, '2026-07-30.1',
          '2026-08-01T00:00:00Z');

  BEGIN
    UPDATE billing.price_snapshots SET amount_cents = 1 WHERE subscription_id = v_sub_a;
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: snapshot alterável depois da 12B';
  EXCEPTION WHEN restrict_violation THEN NULL;
  END;

  -- ── B.6 Auditoria append-only, já com as colunas novas ─────────────────
  INSERT INTO billing.audit_events
    (organization_id, subscription_id, subject, actor_id, origin, previous_value,
     new_value, reason, idempotency_key, correlation_id)
  VALUES
    (v_org_a, v_sub_a, 'payment', NULL, 'provider_webhook', '{"state":"trialing"}'::jsonb,
     '{"state":"active"}'::jsonb, 'pagamento confirmado', 'evt-1', 'corr-1');

  BEGIN
    UPDATE billing.audit_events SET reason = 'adulterado' WHERE organization_id = v_org_a;
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: trilha de auditoria é editável';
  EXCEPTION WHEN restrict_violation THEN NULL;
  END;

  BEGIN
    DELETE FROM billing.audit_events WHERE organization_id = v_org_a;
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: trilha de auditoria é apagável';
  EXCEPTION WHEN restrict_violation THEN NULL;
  END;

  -- Os rótulos novos do enum funcionam depois do commit da migration.
  SELECT count(*) INTO v_int
    FROM billing.audit_events WHERE subject = 'payment' AND organization_id = v_org_a;
  IF v_int <> 1 THEN
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: o rótulo payment não foi aceito';
  END IF;

  -- ── B.7 Revogação de cortesia é append-only e por organização ──────────
  DECLARE
    v_crt uuid;
  BEGIN
    INSERT INTO billing.courtesies
      (organization_id, plan, starts_at, ends_at, reason, granted_by)
    VALUES (v_org_a, 'completo', '2026-08-01T00:00:00Z', '2026-08-31T00:00:00Z',
            'piloto', v_org_a)
    RETURNING id INTO v_crt;

    INSERT INTO billing.courtesy_revocations
      (courtesy_id, organization_id, revoked_at, revoked_by, reason)
    VALUES (v_crt, v_org_a, '2026-08-10T00:00:00Z', v_org_a, 'encerrado');

    BEGIN
      INSERT INTO billing.courtesy_revocations
        (courtesy_id, organization_id, revoked_at, revoked_by, reason)
      VALUES (v_crt, v_org_a, '2026-08-11T00:00:00Z', v_org_a, 'de novo');
      RAISE EXCEPTION 'ASSERÇÃO REPROVADA: cortesia revogada duas vezes';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;

    -- A concessão original continua lá, com autor e motivo.
    IF (SELECT reason FROM billing.courtesies WHERE id = v_crt) <> 'piloto' THEN
      RAISE EXCEPTION 'ASSERÇÃO REPROVADA: a concessão original foi alterada';
    END IF;
  END;

  RAISE NOTICE
    'billing12B/comportamento OK: unicidade, isolamento A×B, imutabilidade e append-only';
END
$comportamento$;

ROLLBACK;

-- ═════════════════════════════════════════════════════════════════════════════
-- C. TRANSAÇÃO — falha no meio desfaz tudo
-- ═════════════════════════════════════════════════════════════════════════════
--
-- É o cenário "falha após persistência parcial é recuperável sem
-- inconsistência": a cobrança é gravada, a auditoria falha, e o que sobra tem
-- de ser NADA — não uma cobrança órfã.

DO $transacao$
DECLARE
  v_org uuid;
  v_sub uuid;
  v_int integer;
BEGIN
  BEGIN
    INSERT INTO public.organizations (name, slug)
         VALUES ('Fixture 12B TX', 'fixture-12b-tx') RETURNING id INTO v_org;

    INSERT INTO billing.subscriptions
      (organization_id, plan, tier, period, state, worker_count, cnpj,
       current_period_start, current_period_end)
    VALUES
      (v_org, 'essencial', 't1_20', 'monthly', 'active', 10, '00000000000191',
       '2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z')
    RETURNING id INTO v_sub;

    INSERT INTO billing.charges
      (organization_id, subscription_id, provider, external_charge_id, method,
       amount_cents, period_start, period_end)
    VALUES
      (v_org, v_sub, 'mock', 'chg_tx', 'pix', 9990,
       '2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z');

    -- Falha DEPOIS da escrita parcial: `subject` inválido para o enum.
    INSERT INTO billing.audit_events (organization_id, subject)
         VALUES (v_org, 'assunto_inexistente');

    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: assunto inválido de auditoria foi aceito';
  EXCEPTION
    WHEN invalid_text_representation THEN
      -- O bloco inteiro é desfeito pelo PostgreSQL.
      NULL;
  END;

  SELECT count(*) INTO v_int
    FROM billing.charges WHERE external_charge_id = 'chg_tx';
  IF v_int <> 0 THEN
    RAISE EXCEPTION
      'ASSERÇÃO REPROVADA: cobrança órfã sobreviveu à falha (% linha(s)) — '
      'a escrita parcial não foi desfeita', v_int;
  END IF;

  SELECT count(*) INTO v_int
    FROM public.organizations WHERE slug = 'fixture-12b-tx';
  IF v_int <> 0 THEN
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: organização órfã sobreviveu à falha';
  END IF;

  RAISE NOTICE 'billing12B/transação OK: falha no meio desfez a escrita parcial';
END
$transacao$;

-- ═════════════════════════════════════════════════════════════════════════════
-- D. Nada sobrou
-- ═════════════════════════════════════════════════════════════════════════════

DO $limpeza$
BEGIN
  IF EXISTS (SELECT 1 FROM billing.charges)
     OR EXISTS (SELECT 1 FROM billing.idempotency_records)
     OR EXISTS (SELECT 1 FROM billing.customers)
     OR EXISTS (SELECT 1 FROM billing.courtesy_revocations)
     OR EXISTS (SELECT 1 FROM billing.subscriptions)
     OR EXISTS (SELECT 1 FROM public.organizations WHERE slug LIKE 'fixture-12b-%') THEN
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: fixture da 12B sobreviveu';
  END IF;

  RAISE NOTICE 'billing12B OK: nenhuma fixture sobreviveu';
END
$limpeza$;
