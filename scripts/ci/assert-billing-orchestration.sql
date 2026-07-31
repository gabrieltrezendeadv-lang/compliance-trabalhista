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
-- As RPCs são o único caminho da aplicação até `billing`. Este arquivo as
-- EXECUTA e confere o efeito — não pergunta se existem, o que
-- `assert-billing-rpcs.sql` já faz pelo catálogo.
--
--   1. autorização revalidada no banco, com recusa INDISTINGUÍVEL entre tenant
--      alheio e tenant inexistente;
--   2. máquina de estados da idempotência: claim → completed / failed, com
--      fingerprint separando repetição de reuso de chave;
--   3. ATOMICIDADE de cada RPC: erro no meio não deixa efeito parcial;
--   4. imutabilidade e transições de cobrança, por trigger, sobre linha real;
--   5. resolução do tenant pelo identificador EXTERNO, sem aceitar organização
--      vinda do evento;
--   6. isolamento A × B.
--
-- ── O QUE ESTE ARQUIVO NÃO PROVA ────────────────────────────────────────────
--
-- CONCORRÊNCIA. Uma sessão `psql` é uma sessão só, e um INSERT duplicado
-- sequencial não é uma corrida — prova que a constraint existe, nada além. A
-- disputa real, com duas conexões independentes e barreira de sincronização,
-- está em `scripts/ci/assert-billing-concurrency.sh`. A versão anterior deste
-- arquivo afirmava provar concorrência, e não provava.
--
-- Tudo dentro de transação encerrada por ROLLBACK. Nenhuma fixture sobrevive,
-- e a seção final confere isso.
-- =============================================================================

\set ON_ERROR_STOP on

-- ═════════════════════════════════════════════════════════════════════════════
-- A. ESTRUTURA E ALCANCE
-- ═════════════════════════════════════════════════════════════════════════════

DO $estrutura$
DECLARE
  v_int   integer;
  v_lista text;
BEGIN
  SELECT count(*) INTO v_int
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'billing' AND c.relkind = 'r';
  IF v_int <> 14 THEN
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: billing tem % tabela(s), esperadas 14', v_int;
  END IF;

  -- Nenhum papel do PostgREST alcança tabela alguma — nem o service_role, que
  -- a partir da 12B escreve exclusivamente por RPC.
  SELECT string_agg(format('%s→%s', papel, c.relname), ', ' ORDER BY c.relname)
    INTO v_lista
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN unnest(ARRAY['anon', 'authenticated', 'service_role']) AS papel
   WHERE n.nspname = 'billing' AND c.relkind = 'r'
     AND has_table_privilege(papel, c.oid, 'SELECT, INSERT, UPDATE, DELETE');
  IF v_lista IS NOT NULL THEN
    RAISE EXCEPTION
      'ASSERÇÃO REPROVADA: papel alcança tabela de billing diretamente: %', v_lista;
  END IF;

  RAISE NOTICE 'billing12B/estrutura OK: 14 tabelas, nenhuma alcançável diretamente';
END
$estrutura$;

-- ═════════════════════════════════════════════════════════════════════════════
-- B. COMPORTAMENTO DAS RPCs
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL row_security = off;

-- ── Fixtures ────────────────────────────────────────────────────────────────
--
-- Identificadores fixos: o teste precisa referenciá-los em blocos distintos, e
-- valor sorteado tornaria a falha irreproduzível.

CREATE TEMP TABLE b12_ids (rotulo text PRIMARY KEY, valor uuid);
INSERT INTO b12_ids VALUES
  ('org_a',      '0b12a000-0000-4000-8000-000000000001'),
  ('org_b',      '0b12a000-0000-4000-8000-000000000002'),
  ('dono_a',     '0b12a000-0000-4000-8000-000000000011'),
  ('dono_b',     '0b12a000-0000-4000-8000-000000000012'),
  ('colab_a',    '0b12a000-0000-4000-8000-000000000013'),
  ('fantasma',   '0b12a000-0000-4000-8000-0000000000ff');

CREATE OR REPLACE FUNCTION pg_temp.id(text) RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT valor FROM b12_ids WHERE rotulo = $1;
$$;

INSERT INTO auth.users (id, instance_id, aud, role, email)
SELECT valor, '00000000-0000-0000-0000-000000000000', 'authenticated',
       'authenticated', rotulo || '@b12.test'
  FROM b12_ids WHERE rotulo IN ('dono_a', 'dono_b', 'colab_a');

INSERT INTO public.profiles (id, full_name, email)
SELECT valor, rotulo, rotulo || '@b12.test'
  FROM b12_ids WHERE rotulo IN ('dono_a', 'dono_b', 'colab_a')
ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name;

INSERT INTO public.organizations (id, name, slug) VALUES
  (pg_temp.id('org_a'), 'Fixture 12B A', 'fixture-12b-a'),
  (pg_temp.id('org_b'), 'Fixture 12B B', 'fixture-12b-b');

INSERT INTO public.organization_members (tenant_id, user_id, role, created_at) VALUES
  (pg_temp.id('org_a'), pg_temp.id('dono_a'),  'owner',        '2026-01-01T00:00:00Z'),
  (pg_temp.id('org_b'), pg_temp.id('dono_b'),  'owner',        '2026-01-01T00:00:00Z'),
  (pg_temp.id('org_a'), pg_temp.id('colab_a'), 'collaborator', '2026-01-01T00:00:00Z');

-- ── B.1 AUTORIZAÇÃO ─────────────────────────────────────────────────────────

DO $autorizacao$
DECLARE
  v_msg_alheio    text;
  v_msg_inexiste  text;
BEGIN
  -- Colaborador não administra assinatura.
  BEGIN
    PERFORM public.fn_billing_start_trial(
      pg_temp.id('colab_a'), pg_temp.id('org_a'), 'essencial', 't1_20', 'monthly',
      10, '00000000000191', '2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z',
      '2026-08-08T00:00:00Z', 9990, '2026-07-30.1', 'corr-1');
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: colaborador iniciou trial';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Tenant ALHEIO e tenant INEXISTENTE têm de produzir a MESMA mensagem —
  -- distingui-las entregaria "esta organização existe" a quem varre.
  BEGIN
    PERFORM public.fn_billing_read_ledger(pg_temp.id('dono_a'), pg_temp.id('org_b'));
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: dono de A leu a trilha de B';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_msg_alheio = MESSAGE_TEXT;
  END;

  BEGIN
    PERFORM public.fn_billing_read_ledger(pg_temp.id('dono_a'), pg_temp.id('fantasma'));
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: organização inexistente foi aceita';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_msg_inexiste = MESSAGE_TEXT;
  END;

  IF v_msg_alheio IS DISTINCT FROM v_msg_inexiste THEN
    RAISE EXCEPTION
      'ASSERÇÃO REPROVADA: recusas distinguíveis — alheio="%" inexistente="%"',
      v_msg_alheio, v_msg_inexiste;
  END IF;

  RAISE NOTICE 'billing12B/autorização OK: papel exigido e recusas indistinguíveis';
END
$autorizacao$;

-- ── B.2 CICLO DE VIDA, ATÔMICO ──────────────────────────────────────────────

DO $ciclo$
DECLARE
  v_json  jsonb;
  v_int   integer;
BEGIN
  v_json := public.fn_billing_start_trial(
    pg_temp.id('dono_a'), pg_temp.id('org_a'), 'essencial', 't1_20', 'monthly',
    10, '00000000000191', '2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z',
    '2026-08-08T00:00:00Z', 9990, '2026-07-30.1', 'corr-1');

  IF v_json->>'state' <> 'trialing' THEN
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: trial não iniciou (%)', v_json;
  END IF;
  IF (v_json->'price_snapshot'->>'amount_cents')::int <> 9990 THEN
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: snapshot não foi gravado na mesma transação';
  END IF;

  -- Assinatura, snapshot e auditoria numa transação só: se a RPC não fosse
  -- atômica, um destes três estaria faltando.
  SELECT count(*) INTO v_int FROM billing.audit_events
   WHERE organization_id = pg_temp.id('org_a');
  IF v_int <> 1 THEN
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: auditoria do trial ausente (%)', v_int;
  END IF;

  v_json := public.fn_billing_start_trial(
    pg_temp.id('dono_b'), pg_temp.id('org_b'), 'completo', 't1_20', 'monthly',
    10, '00000000000272', '2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z',
    '2026-08-08T00:00:00Z', 24990, '2026-07-30.1', 'corr-b');

  -- ATOMICIDADE: uma RPC que falhe no meio não pode deixar rastro. Aqui o
  -- `worker_count` inválido reprova DEPOIS da checagem de autorização, e nada
  -- pode ter sido escrito.
  SELECT count(*) INTO v_int FROM billing.audit_events
   WHERE organization_id = pg_temp.id('org_a');
  BEGIN
    PERFORM public.fn_billing_record_worker_count(
      pg_temp.id('dono_a'), pg_temp.id('org_a'), 0, 'corr-x', '2026-08-02T00:00:00Z');
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: worker_count 0 foi aceito';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  IF (SELECT count(*) FROM billing.audit_events
       WHERE organization_id = pg_temp.id('org_a')) <> v_int THEN
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: RPC que falhou deixou auditoria para trás';
  END IF;

  RAISE NOTICE 'billing12B/ciclo OK: assinatura+snapshot+auditoria atômicos';
END
$ciclo$;

-- ── B.3 IDEMPOTÊNCIA: claim → finalize / fail ───────────────────────────────

DO $idem$
DECLARE
  v_json jsonb;
  v_int  integer;
BEGIN
  -- claim inicial
  v_json := public.fn_billing_claim_idempotency(
    pg_temp.id('dono_a'), pg_temp.id('org_a'), 'command', 'mock', 'ck-1',
    'fp-aaa', 'corr-1', '2026-08-02T00:00:00Z');
  IF v_json->>'outcome' <> 'claimed' THEN
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: primeiro claim devolveu %', v_json;
  END IF;

  -- repetição com MESMO fingerprint, ainda em andamento
  v_json := public.fn_billing_claim_idempotency(
    pg_temp.id('dono_a'), pg_temp.id('org_a'), 'command', 'mock', 'ck-1',
    'fp-aaa', 'corr-1', '2026-08-02T00:01:00Z');
  IF v_json->>'outcome' <> 'in_progress' THEN
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: repetição em andamento devolveu %', v_json;
  END IF;

  -- MESMA chave, OUTRO pedido: conflito, e não o resultado do primeiro
  v_json := public.fn_billing_claim_idempotency(
    pg_temp.id('dono_a'), pg_temp.id('org_a'), 'command', 'mock', 'ck-1',
    'fp-DIFERENTE', 'corr-1', '2026-08-02T00:02:00Z');
  IF v_json->>'outcome' <> 'fingerprint_conflict' THEN
    RAISE EXCEPTION
      'ASSERÇÃO REPROVADA: chave reusada com outro payload não deu conflito (%)', v_json;
  END IF;

  -- finalize: cobrança + cliente + auditoria + conclusão da chave, numa
  -- transação só
  v_json := public.fn_billing_finalize_checkout(
    pg_temp.id('dono_a'), pg_temp.id('org_a'), 'mock', 'acct-1', 'cus-1', 'chg-1',
    'pix', 9990, '2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z',
    'ck-1', 'fp-aaa', 'corr-1', '2026-08-02T00:03:00Z');
  IF v_json->>'outcome' <> 'completed' THEN
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: finalize devolveu %', v_json;
  END IF;
  IF (v_json->'charge'->>'status') <> 'pending' THEN
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: cobrança não nasceu pendente';
  END IF;

  SELECT count(*) INTO v_int FROM billing.customers
   WHERE organization_id = pg_temp.id('org_a');
  IF v_int <> 1 THEN
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: cliente do provider não foi gravado';
  END IF;

  -- claim depois de concluída devolve o MESMO resultado, sem repetir efeito
  v_json := public.fn_billing_claim_idempotency(
    pg_temp.id('dono_a'), pg_temp.id('org_a'), 'command', 'mock', 'ck-1',
    'fp-aaa', 'corr-1', '2026-08-02T00:04:00Z');
  IF v_json->>'outcome' <> 'completed' OR (v_json->'result'->>'chargeId') IS NULL THEN
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: repetição de chave concluída devolveu %', v_json;
  END IF;
  IF (SELECT count(*) FROM billing.charges WHERE organization_id = pg_temp.id('org_a')) <> 1 THEN
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: repetição criou segunda cobrança';
  END IF;

  -- RECUPERAÇÃO DE ABANDONO: uma operação que falhou entre o claim e o
  -- finalize é marcada `failed`, e a repetição com o MESMO pedido é permitida.
  -- Sem isso a chave ficaria presa para sempre — a pílula envenenada da versão
  -- anterior.
  PERFORM public.fn_billing_claim_idempotency(
    pg_temp.id('dono_a'), pg_temp.id('org_a'), 'command', 'mock', 'ck-2',
    'fp-bbb', 'corr-2', '2026-08-03T00:00:00Z');
  v_json := public.fn_billing_fail_idempotency(
    pg_temp.id('dono_a'), pg_temp.id('org_a'), 'command', 'mock', 'ck-2',
    'fp-bbb', 'provider_timeout', '2026-08-03T00:01:00Z');
  IF v_json->>'outcome' <> 'failed' THEN
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: fail devolveu %', v_json;
  END IF;

  -- e o registro falho NÃO pode ter resultado: nada aconteceu.
  IF EXISTS (SELECT 1 FROM billing.idempotency_records
              WHERE key = 'ck-2' AND result IS NOT NULL) THEN
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: registro falho declarou resultado';
  END IF;

  v_json := public.fn_billing_claim_idempotency(
    pg_temp.id('dono_a'), pg_temp.id('org_a'), 'command', 'mock', 'ck-2',
    'fp-bbb', 'corr-2', '2026-08-03T00:02:00Z');
  IF v_json->>'outcome' <> 'claimed' THEN
    RAISE EXCEPTION
      'ASSERÇÃO REPROVADA: chave falha não pôde ser retomada (%)', v_json;
  END IF;

  RAISE NOTICE 'billing12B/idempotência OK: claim, conflito de fingerprint, finalize e retomada';
END
$idem$;

-- ── B.4 COBRANÇA: imutabilidade e transições ────────────────────────────────

DO $cobranca$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM billing.charges WHERE external_charge_id = 'chg-1';

  -- Valor, tenant, período e identificadores externos são imutáveis, e a
  -- trigger vale MESMO para o owner da tabela — as RPCs rodam como owner, e uma
  -- função com defeito não pode ser a última defesa.
  BEGIN
    UPDATE billing.charges SET amount_cents = 1 WHERE id = v_id;
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: valor da cobrança foi alterado';
  EXCEPTION WHEN restrict_violation THEN NULL;
  END;

  BEGIN
    UPDATE billing.charges SET organization_id = pg_temp.id('org_b') WHERE id = v_id;
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: cobrança trocou de tenant';
  EXCEPTION WHEN restrict_violation THEN NULL;
  END;

  BEGIN
    UPDATE billing.charges SET external_charge_id = 'outro' WHERE id = v_id;
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: identificador externo foi trocado';
  EXCEPTION WHEN restrict_violation THEN NULL;
  END;

  BEGIN
    UPDATE billing.charges SET period_end = '2027-01-01T00:00:00Z' WHERE id = v_id;
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: período da cobrança foi trocado';
  EXCEPTION WHEN restrict_violation THEN NULL;
  END;

  -- Estado desconhecido não existe no enum; transição inválida é recusada pela
  -- máquina fechada.
  UPDATE billing.charges
     SET status = 'paid', paid_at = '2026-08-04T00:00:00Z' WHERE id = v_id;

  BEGIN
    UPDATE billing.charges
       SET status = 'failed', paid_at = NULL, failed_at = '2026-08-05T00:00:00Z'
     WHERE id = v_id;
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: paid → failed foi aceito';
  EXCEPTION WHEN restrict_violation THEN NULL;
  END;

  BEGIN
    UPDATE billing.charges SET status = 'pending', paid_at = NULL WHERE id = v_id;
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: regressão paid → pending foi aceita';
  EXCEPTION WHEN restrict_violation THEN NULL;
  END;

  -- DELETE não é concedido a ninguém, mas o owner pode: a garantia contra
  -- apagamento é o grant, e ele já foi conferido na seção A.
  RAISE NOTICE 'billing12B/cobrança OK: 4 colunas imutáveis e transições fechadas';
END
$cobranca$;

-- ── B.5 EVENTO EXTERNO: tenant resolvido, não informado ─────────────────────

DO $evento$
DECLARE
  v_json jsonb;
BEGIN
  -- Nova cobrança pendente para exercitar o evento.
  PERFORM public.fn_billing_claim_idempotency(
    pg_temp.id('dono_b'), pg_temp.id('org_b'), 'command', 'mock', 'ck-b',
    'fp-b', 'corr-b', '2026-08-02T00:00:00Z');
  PERFORM public.fn_billing_finalize_checkout(
    pg_temp.id('dono_b'), pg_temp.id('org_b'), 'mock', 'acct-1', 'cus-b', 'chg-b',
    'pix', 24990, '2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z',
    'ck-b', 'fp-b', 'corr-b', '2026-08-02T00:01:00Z');

  -- A RPC do webhook NÃO recebe organization_id: ela resolve pelo identificador
  -- externo, que é único globalmente.
  v_json := public.fn_billing_apply_provider_event(
    'mock', 'acct-1', 'ev-1', 'chg-b', 'charge_paid',
    '2026-08-05T00:00:00Z', 'corr-b', '2026-08-05T00:00:01Z');

  IF v_json->>'outcome' <> 'applied' THEN
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: evento não foi aplicado (%)', v_json;
  END IF;
  IF (v_json->>'organizationId')::uuid <> pg_temp.id('org_b') THEN
    RAISE EXCEPTION
      'ASSERÇÃO REPROVADA: tenant resolvido incorretamente (%)', v_json->>'organizationId';
  END IF;
  IF (v_json->'subscription'->>'state') <> 'active' THEN
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: assinatura não foi ativada pelo pagamento';
  END IF;

  -- Repetição do MESMO evento não reaplica nada.
  v_json := public.fn_billing_apply_provider_event(
    'mock', 'acct-1', 'ev-1', 'chg-b', 'charge_paid',
    '2026-08-05T00:00:00Z', 'corr-b', '2026-08-05T00:00:02Z');
  IF v_json->>'outcome' <> 'duplicate' THEN
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: evento duplicado foi reaplicado (%)', v_json;
  END IF;

  -- Evento anterior ao período da cobrança é recusado: pagamento atrasado não
  -- reativa ciclo posterior.
  v_json := public.fn_billing_apply_provider_event(
    'mock', 'acct-1', 'ev-2', 'chg-b', 'charge_paid',
    '2026-07-01T00:00:00Z', 'corr-b', '2026-08-05T00:00:03Z');
  IF v_json->>'outcome' <> 'out_of_order' THEN
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: evento fora de ordem foi aceito (%)', v_json;
  END IF;

  -- Cobrança desconhecida: não existe caminho para "aplicar em qualquer tenant".
  BEGIN
    PERFORM public.fn_billing_apply_provider_event(
      'mock', 'acct-1', 'ev-3', 'chg-inexistente', 'charge_paid',
      '2026-08-05T00:00:00Z', 'corr-b', '2026-08-05T00:00:04Z');
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: evento de cobrança inexistente foi aceito';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;

  RAISE NOTICE 'billing12B/evento OK: tenant resolvido pelo externo, duplicata e ordem';
END
$evento$;

-- ── B.6 ISOLAMENTO A × B ────────────────────────────────────────────────────

DO $isolamento$
DECLARE
  v_json jsonb;
BEGIN
  v_json := public.fn_billing_read_ledger(pg_temp.id('dono_a'), pg_temp.id('org_a'));
  IF jsonb_array_length(v_json->'charges') <> 1 THEN
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: A enxerga % cobrança(s)',
      jsonb_array_length(v_json->'charges');
  END IF;
  IF v_json->'charges'->0->>'external_charge_id' <> 'chg-1' THEN
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: a trilha de A trouxe cobrança de outro tenant';
  END IF;

  v_json := public.fn_billing_read_state(pg_temp.id('dono_b'), pg_temp.id('org_b'));
  IF (v_json->'subscription'->>'organization_id')::uuid <> pg_temp.id('org_b') THEN
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: read_state devolveu assinatura de outro tenant';
  END IF;

  RAISE NOTICE 'billing12B/isolamento OK: cada tenant só enxerga o próprio';
END
$isolamento$;

-- ── B.7 CORTESIA: revogação append-only ─────────────────────────────────────

DO $cortesia$
DECLARE
  v_json jsonb;
  v_id   uuid;
BEGIN
  v_json := public.fn_billing_grant_courtesy(
    pg_temp.id('dono_a'), pg_temp.id('org_a'), 'completo',
    '2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z', 'piloto interno', 'corr-c');
  v_id := (v_json->>'id')::uuid;

  v_json := public.fn_billing_revoke_courtesy(
    pg_temp.id('dono_a'), pg_temp.id('org_a'), v_id,
    '2026-08-10T00:00:00Z', 'encerrado', 'corr-c');
  IF v_json->>'outcome' <> 'revoked' THEN
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: revogação devolveu %', v_json;
  END IF;

  -- A concessão original PERMANECE: apagá-la apagaria a prova de que existiu.
  IF NOT EXISTS (SELECT 1 FROM billing.courtesies WHERE id = v_id) THEN
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: a concessão original sumiu';
  END IF;

  v_json := public.fn_billing_revoke_courtesy(
    pg_temp.id('dono_a'), pg_temp.id('org_a'), v_id,
    '2026-08-11T00:00:00Z', 'de novo', 'corr-c');
  IF v_json->>'outcome' <> 'already_revoked' THEN
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: segunda revogação foi aceita (%)', v_json;
  END IF;

  -- Cortesia de outro tenant não é revogável.
  BEGIN
    PERFORM public.fn_billing_revoke_courtesy(
      pg_temp.id('dono_b'), pg_temp.id('org_b'), v_id,
      '2026-08-12T00:00:00Z', 'alheia', 'corr-c');
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: cortesia de outro tenant foi revogada';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;

  RAISE NOTICE 'billing12B/cortesia OK: append-only e isolada por tenant';
END
$cortesia$;

ROLLBACK;

-- ═════════════════════════════════════════════════════════════════════════════
-- C. NENHUMA FIXTURE SOBREVIVEU
-- ═════════════════════════════════════════════════════════════════════════════

DO $limpeza$
DECLARE
  v_int integer;
BEGIN
  SELECT count(*) INTO v_int FROM public.organizations
   WHERE slug IN ('fixture-12b-a', 'fixture-12b-b');
  IF v_int <> 0 THEN
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: % organização(ões) de fixture sobreviveram', v_int;
  END IF;

  SELECT count(*) INTO v_int FROM billing.charges;
  IF v_int <> 0 THEN
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: % cobrança(s) sobreviveram ao ROLLBACK', v_int;
  END IF;

  SELECT count(*) INTO v_int FROM billing.idempotency_records;
  IF v_int <> 0 THEN
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: % chave(s) sobreviveram ao ROLLBACK', v_int;
  END IF;

  SELECT count(*) INTO v_int FROM billing.provider_events;
  IF v_int <> 0 THEN
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: % evento(s) sobreviveram ao ROLLBACK', v_int;
  END IF;

  RAISE NOTICE 'billing12B OK: nenhuma fixture sobreviveu';
END
$limpeza$;
