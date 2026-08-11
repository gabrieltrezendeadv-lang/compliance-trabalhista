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
  -- Organização C nasce SEM assinatura, e continua sem: ela existe para os
  -- casos da 12C.1 que precisam de um trial que NÃO deve chegar a ser gravado.
  ('org_c',      '0b12a000-0000-4000-8000-000000000003'),
  ('dono_c',     '0b12a000-0000-4000-8000-000000000014'),
  ('fantasma',   '0b12a000-0000-4000-8000-0000000000ff');

CREATE OR REPLACE FUNCTION pg_temp.id(text) RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT valor FROM b12_ids WHERE rotulo = $1;
$$;

INSERT INTO auth.users (id, instance_id, aud, role, email)
SELECT valor, '00000000-0000-0000-0000-000000000000', 'authenticated',
       'authenticated', rotulo || '@b12.test'
  FROM b12_ids WHERE rotulo IN ('dono_a', 'dono_b', 'colab_a', 'dono_c');

INSERT INTO public.profiles (id, full_name, email)
SELECT valor, rotulo, rotulo || '@b12.test'
  FROM b12_ids WHERE rotulo IN ('dono_a', 'dono_b', 'colab_a', 'dono_c')
ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name;

INSERT INTO public.organizations (id, name, slug) VALUES
  (pg_temp.id('org_a'), 'Fixture 12B A', 'fixture-12b-a'),
  (pg_temp.id('org_b'), 'Fixture 12B B', 'fixture-12b-b'),
  (pg_temp.id('org_c'), 'Fixture 12B C', 'fixture-12b-c');

INSERT INTO public.organization_members (tenant_id, user_id, role, created_at) VALUES
  (pg_temp.id('org_a'), pg_temp.id('dono_a'),  'owner',        '2026-01-01T00:00:00Z'),
  (pg_temp.id('org_b'), pg_temp.id('dono_b'),  'owner',        '2026-01-01T00:00:00Z'),
  (pg_temp.id('org_a'), pg_temp.id('colab_a'), 'collaborator', '2026-01-01T00:00:00Z'),
  (pg_temp.id('org_c'), pg_temp.id('dono_c'),  'owner',        '2026-01-01T00:00:00Z');

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
      '2026-08-08T00:00:00Z', 9990, '2026-07-30.1', 'corr-1',
      NULL, '2026-08-10', '2026-08-01T00:00:00Z');
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
    '2026-08-08T00:00:00Z', 9990, '2026-07-30.1', 'corr-1',
    NULL, '2026-08-10', '2026-08-01T00:00:00Z');

  IF v_json->>'state' <> 'trialing' THEN
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: trial não iniciou (%)', v_json;
  END IF;
  IF (v_json->'price_snapshot'->>'amount_cents')::int <> 9990 THEN
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: snapshot não foi gravado na mesma transação';
  END IF;

  -- Assinatura, snapshot e auditoria numa transação só: se a RPC não fosse
  -- atômica, um destes três estaria faltando.
  -- DOIS eventos, não um: `subscription_state` (a assinatura entrou em
  -- trial) e `terms_acceptance` (esta pessoa aceitou a versão X neste
  -- instante). São fatos distintos, e quem audita contrato procura o segundo.
  SELECT count(*) INTO v_int FROM billing.audit_events
   WHERE organization_id = pg_temp.id('org_a');
  IF v_int <> 2 THEN
    RAISE EXCEPTION
      'ASSERÇÃO REPROVADA: esperados 2 eventos no trial (estado + aceite), vieram %', v_int;
  END IF;

  SELECT count(*) INTO v_int FROM billing.audit_events
   WHERE organization_id = pg_temp.id('org_a')
     AND subject::text = 'terms_acceptance'
     AND actor_id = pg_temp.id('dono_a')
     AND occurred_at = '2026-08-01T00:00:00Z'
     AND new_value->>'termsVersion' = '2026-08-10';
  IF v_int <> 1 THEN
    RAISE EXCEPTION
      'ASSERÇÃO REPROVADA: aceite sem ator, instante ou versao na trilha (%)', v_int;
  END IF;

  v_json := public.fn_billing_start_trial(
    pg_temp.id('dono_b'), pg_temp.id('org_b'), 'completo', 't1_20', 'monthly',
    10, '00000000000272', '2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z',
    '2026-08-08T00:00:00Z', 24990, '2026-07-30.1', 'corr-b',
    'financeiro@fixture-b.test', '2026-08-10', '2026-08-01T00:00:00Z');

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

-- ── B.3.1 LEASE DA RESERVA ──────────────────────────────────────────────────
--
-- A lease é o que impede que uma reserva abandonada trave a chave para sempre,
-- e é o que impede que uma reserva VIVA seja roubada. Ela existia só no dublê:
-- o SQL devolvia `in_progress` sem olhar `started_at`, e as duas variantes do
-- contrato passavam porque nenhuma expectativa a exercitava.
--
-- Aqui a prova é direta, contra o PostgreSQL, com o relógio explícito da RPC —
-- os cinco minutos passam sem espera real.

DO $lease$
DECLARE
  v_json     jsonb;
  v_inicio   timestamptz := '2026-08-05T00:00:00Z';
  v_started  timestamptz;
  v_int      integer;
BEGIN
  -- claim inicial
  v_json := public.fn_billing_claim_idempotency(
    pg_temp.id('dono_a'), pg_temp.id('org_a'), 'command', 'mock', 'ck-lease',
    'fp-lease', 'corr-l', v_inicio);
  IF v_json->>'outcome' <> 'claimed' THEN
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: claim inicial da lease devolveu %', v_json;
  END IF;

  -- 1. LEASE VÁLIDA — a 4m59s ainda está em curso
  v_json := public.fn_billing_claim_idempotency(
    pg_temp.id('dono_a'), pg_temp.id('org_a'), 'command', 'mock', 'ck-lease',
    'fp-lease', 'corr-l', v_inicio + interval '4 minutes 59 seconds');
  IF v_json->>'outcome' <> 'in_progress' THEN
    RAISE EXCEPTION
      'ASSERÇÃO REPROVADA: a 4m59s a lease deveria valer, devolveu %', v_json;
  END IF;

  -- 2. CONFLITO DE FINGERPRINT ANTES DE EXPIRAR
  v_json := public.fn_billing_claim_idempotency(
    pg_temp.id('dono_a'), pg_temp.id('org_a'), 'command', 'mock', 'ck-lease',
    'fp-OUTRO', 'corr-l', v_inicio + interval '1 minute');
  IF v_json->>'outcome' <> 'fingerprint_conflict' THEN
    RAISE EXCEPTION
      'ASSERÇÃO REPROVADA: fingerprint diferente dentro da lease devolveu %', v_json;
  END IF;

  -- 3. CONFLITO DE FINGERPRINT DEPOIS DE EXPIRAR
  --
  -- Expirar libera a retomada do MESMO pedido. Nunca de outro: devolver a
  -- reserva a um pedido diferente faria o primeiro sumir sem aviso.
  v_json := public.fn_billing_claim_idempotency(
    pg_temp.id('dono_a'), pg_temp.id('org_a'), 'command', 'mock', 'ck-lease',
    'fp-OUTRO', 'corr-l', v_inicio + interval '30 minutes');
  IF v_json->>'outcome' <> 'fingerprint_conflict' THEN
    RAISE EXCEPTION
      'ASSERÇÃO REPROVADA: fingerprint diferente APÓS expirar devolveu %', v_json;
  END IF;

  -- 4. LIMITE EXATO — `p_now >= started_at + 5min` é lease VENCIDA
  --
  -- É a borda que separa `>=` de `>`. Uma implementação com `>` devolveria
  -- `in_progress` aqui, e este bloco reprovaria.
  v_json := public.fn_billing_claim_idempotency(
    pg_temp.id('dono_a'), pg_temp.id('org_a'), 'command', 'mock', 'ck-lease',
    'fp-lease', 'corr-takeover', v_inicio + interval '5 minutes');
  IF v_json->>'outcome' <> 'claimed' THEN
    RAISE EXCEPTION
      'ASSERÇÃO REPROVADA: no limite exato de 5min a lease deveria ter vencido, devolveu %',
      v_json;
  END IF;

  -- 5. O TAKEOVER REINICIA `started_at`, mantendo chave e fingerprint
  SELECT started_at INTO v_started FROM billing.idempotency_records
   WHERE organization_id = pg_temp.id('org_a') AND key = 'ck-lease';
  IF v_started <> v_inicio + interval '5 minutes' THEN
    RAISE EXCEPTION
      'ASSERÇÃO REPROVADA: takeover não reiniciou started_at (ficou em %)', v_started;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM billing.idempotency_records
     WHERE organization_id = pg_temp.id('org_a') AND key = 'ck-lease'
       AND request_fingerprint = 'fp-lease'
       AND status = 'in_progress'
       AND error_code IS NULL
  ) THEN
    RAISE EXCEPTION
      'ASSERÇÃO REPROVADA: takeover alterou fingerprint, status ou não limpou error_code';
  END IF;

  -- 6. A NOVA LEASE CONTA DO ZERO — 4m59s depois do takeover ainda vale
  v_json := public.fn_billing_claim_idempotency(
    pg_temp.id('dono_a'), pg_temp.id('org_a'), 'command', 'mock', 'ck-lease',
    'fp-lease', 'corr-l', v_inicio + interval '9 minutes 59 seconds');
  IF v_json->>'outcome' <> 'in_progress' THEN
    RAISE EXCEPTION
      'ASSERÇÃO REPROVADA: a nova lease não conta do takeover, devolveu %', v_json;
  END IF;

  -- 7. NENHUM REGISTRO DUPLICADO — takeover retoma a MESMA linha
  SELECT count(*) INTO v_int FROM billing.idempotency_records
   WHERE organization_id = pg_temp.id('org_a') AND key = 'ck-lease';
  IF v_int <> 1 THEN
    RAISE EXCEPTION
      'ASSERÇÃO REPROVADA: o takeover criou registro novo (% linhas para a mesma chave)', v_int;
  END IF;

  -- 8. `completed` NUNCA é retomado, por mais que a lease tenha vencido
  PERFORM public.fn_billing_claim_idempotency(
    pg_temp.id('dono_a'), pg_temp.id('org_a'), 'command', 'mock', 'ck-lease-c',
    'fp-c', 'corr-l', v_inicio);
  PERFORM public.fn_billing_finalize_checkout(
    pg_temp.id('dono_a'), pg_temp.id('org_a'), 'mock', 'acct-1', 'cus-lease',
    'chg-lease', 'pix', 9990, '2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z',
    'ck-lease-c', 'fp-c', 'corr-l', v_inicio);
  v_json := public.fn_billing_claim_idempotency(
    pg_temp.id('dono_a'), pg_temp.id('org_a'), 'command', 'mock', 'ck-lease-c',
    'fp-c', 'corr-l', v_inicio + interval '1 hour');
  IF v_json->>'outcome' <> 'completed' THEN
    RAISE EXCEPTION
      'ASSERÇÃO REPROVADA: reserva concluída foi retomada com a lease vencida (%)', v_json;
  END IF;

  -- ── ESTE BLOCO DEVOLVE O ESTADO COMO ENCONTROU ────────────────────────────
  --
  -- O caso 8 precisa de uma reserva `completed`, e o único caminho para isso é
  -- um `finalize_checkout` de verdade — que cria uma cobrança. O bloco B.6
  -- adiante exige que A enxergue EXATAMENTE uma cobrança, e a primeira
  -- execução desta asserção reprovou lá, com "A enxerga 2 cobrança(s)".
  --
  -- A alternativa seria afrouxar o B.6 para "pelo menos uma", e isso trocaria
  -- uma asserção de isolamento por uma asserção mais fraca só para acomodar
  -- este bloco. Limpar o que se criou é mais barato e não custa cobertura:
  -- `charges` só tem trigger BEFORE UPDATE, então o DELETE passa, e a auditoria
  -- append-only permanece — ninguém a conta depois daqui.
  DELETE FROM billing.charges WHERE external_charge_id = 'chg-lease';
  DELETE FROM billing.customers WHERE external_customer_id = 'cus-lease';
  DELETE FROM billing.idempotency_records
   WHERE organization_id = pg_temp.id('org_a') AND key IN ('ck-lease', 'ck-lease-c');

  SELECT count(*) INTO v_int FROM billing.charges
   WHERE organization_id = pg_temp.id('org_a');
  IF v_int <> 1 THEN
    RAISE EXCEPTION
      'ASSERÇÃO REPROVADA: o bloco da lease não devolveu o estado (% cobrança(s) em A)', v_int;
  END IF;

  RAISE NOTICE
    'billing12B/lease OK: 5min fixos, borda >=, conflito antes e depois, takeover reinicia sem duplicar';
END
$lease$;

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

-- ── B.7 METADADOS CONTRATUAIS (Etapa 12C.1) ────────────────────────────────
--
-- O verificador somente-leitura de 20260810120000 prova o que dá para provar
-- sem escrever. O que SÓ se prova escrevendo está aqui: CHECK rejeitando linha
-- real, recusa a membro comum de verdade, e — o caso mais importante — falha da
-- AUDITORIA desfazendo a operação inteira.

DO $contrato$
DECLARE
  v_json   jsonb;
  v_int    integer;
  v_antes  integer;
  v_txt    text;
BEGIN
  -- B.7.1 TRIAL SEM ACEITE É RECUSADO, E NÃO DEIXA RASTRO.
  --
  -- A organização C não tem assinatura, e tem de continuar sem depois de cada
  -- uma destas tentativas.
  FOREACH v_txt IN ARRAY ARRAY['', '   ', 'termos-v1', '10-08-2026']
  LOOP
    BEGIN
      PERFORM public.fn_billing_start_trial(
        pg_temp.id('dono_c'), pg_temp.id('org_c'), 'essencial', 't1_20', 'monthly',
        10, '00000000000191', '2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z',
        '2026-08-08T00:00:00Z', 9990, '2026-07-30.1', 'corr-c',
        NULL, v_txt, '2026-08-01T00:00:00Z');
      RAISE EXCEPTION
        'ASSERÇÃO REPROVADA: trial com versao [%] foi aceito', v_txt;
    EXCEPTION WHEN invalid_parameter_value THEN NULL;
    END;
  END LOOP;

  BEGIN
    PERFORM public.fn_billing_start_trial(
      pg_temp.id('dono_c'), pg_temp.id('org_c'), 'essencial', 't1_20', 'monthly',
      10, '00000000000191', '2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z',
      '2026-08-08T00:00:00Z', 9990, '2026-07-30.1', 'corr-c',
      NULL, NULL, '2026-08-01T00:00:00Z');
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: trial sem versao de termos foi aceito';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  SELECT count(*) INTO v_int FROM billing.subscriptions
   WHERE organization_id = pg_temp.id('org_c');
  IF v_int <> 0 THEN
    RAISE EXCEPTION
      'ASSERÇÃO REPROVADA: trial recusado deixou % assinatura(s) para tras', v_int;
  END IF;

  -- B.7.2 FALHA DA AUDITORIA DESFAZ A OPERAÇÃO INTEIRA.
  --
  -- Uma constraint NOT VALID recusa QUALQUER evento de aceite novo sem
  -- reprovar os já gravados. Com ela no lugar, fn_billing_start_trial
  -- consegue inserir a assinatura e falha ao auditar — e o que se exige é que
  -- a assinatura NÃO sobreviva. Se sobrevivesse, existiria trial sem prova de
  -- aceite, que é exatamente o estado que esta etapa veio impedir.
  ALTER TABLE billing.audit_events
    ADD CONSTRAINT tmp_falha_auditoria
    CHECK (subject <> 'terms_acceptance'::billing.audit_subject) NOT VALID;

  SELECT count(*) INTO v_antes FROM billing.audit_events
   WHERE organization_id = pg_temp.id('org_c');

  BEGIN
    PERFORM public.fn_billing_start_trial(
      pg_temp.id('dono_c'), pg_temp.id('org_c'), 'essencial', 't1_20', 'monthly',
      10, '00000000000191', '2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z',
      '2026-08-08T00:00:00Z', 9990, '2026-07-30.1', 'corr-c',
      NULL, '2026-08-10', '2026-08-01T00:00:00Z');
    RAISE EXCEPTION
      'ASSERÇÃO REPROVADA: trial concluiu apesar de a auditoria do aceite falhar';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  SELECT count(*) INTO v_int FROM billing.subscriptions
   WHERE organization_id = pg_temp.id('org_c');
  IF v_int <> 0 THEN
    RAISE EXCEPTION
      'ASSERÇÃO REPROVADA: auditoria falhou e a assinatura ficou gravada (%)', v_int;
  END IF;

  SELECT count(*) INTO v_int FROM billing.audit_events
   WHERE organization_id = pg_temp.id('org_c');
  IF v_int <> v_antes THEN
    RAISE EXCEPTION
      'ASSERÇÃO REPROVADA: auditoria parcial sobreviveu (% -> %)', v_antes, v_int;
  END IF;

  ALTER TABLE billing.audit_events DROP CONSTRAINT tmp_falha_auditoria;

  -- Sem a constraint, o MESMO pedido passa. Sem isto, o caso acima poderia
  -- estar reprovando por qualquer outro motivo.
  v_json := public.fn_billing_start_trial(
    pg_temp.id('dono_c'), pg_temp.id('org_c'), 'essencial', 't1_20', 'monthly',
    10, '00000000000191', '2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z',
    '2026-08-08T00:00:00Z', 9990, '2026-07-30.1', 'corr-c',
    '  Financeiro@Fixture-C.test  ', '2026-08-10', '2026-08-01T00:00:00Z');

  IF v_json->>'terms_version' <> '2026-08-10' THEN
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: versao de termos nao voltou no estado (%)', v_json;
  END IF;
  -- Espaços nas pontas são removidos ANTES de gravar.
  IF v_json->>'billing_email' <> 'Financeiro@Fixture-C.test' THEN
    RAISE EXCEPTION
      'ASSERÇÃO REPROVADA: contato financeiro nao foi normalizado (%)', v_json->>'billing_email';
  END IF;

  -- B.7.3 O CHECK DO PAR MORDE, mesmo contra escrita DIRETA do dono da tabela.
  --
  -- As RPCs são a única porta para a aplicação, mas o CHECK existe para o caso
  -- em que uma RPC futura erre. Aqui ele é exercitado por UPDATE direto.
  BEGIN
    UPDATE billing.subscriptions
       SET terms_accepted_at = NULL
     WHERE organization_id = pg_temp.id('org_c');
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: versao sem instante foi aceita';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE billing.subscriptions
       SET terms_version = '   '
     WHERE organization_id = pg_temp.id('org_c');
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: versao so com espacos foi aceita';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE billing.subscriptions
       SET billing_email = repeat('a', 250) || '@empresa.com.br'
     WHERE organization_id = pg_temp.id('org_c');
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: e-mail acima de 254 caracteres foi aceito';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Linha ANTERIOR à 12C.1 continua válida: os três nulos passam.
  UPDATE billing.subscriptions
     SET billing_email = NULL, terms_version = NULL, terms_accepted_at = NULL
   WHERE organization_id = pg_temp.id('org_c');
  UPDATE billing.subscriptions
     SET terms_version = '2026-08-10', terms_accepted_at = '2026-08-01T00:00:00Z',
         billing_email = 'financeiro@fixture-c.test'
   WHERE organization_id = pg_temp.id('org_c');

  RAISE NOTICE
    'billing12B/contrato OK: trial sem aceite recusado, auditoria que falha desfaz tudo, CHECKs mordem';
END
$contrato$;

-- ── B.8 CONTATO FINANCEIRO E NOVO ACEITE, DEPOIS DO TRIAL ──────────────────

DO $pos_trial$
DECLARE
  v_json  jsonb;
  v_int   integer;
  v_txt   text;
BEGIN
  -- SOMENTE OWNER. Colaborador de A é membro de verdade, e mesmo assim recusado
  -- — é a diferença entre "não é da organização" e "não é o dono".
  BEGIN
    PERFORM public.fn_billing_update_billing_email(
      pg_temp.id('colab_a'), pg_temp.id('org_a'),
      'colaborador@fixture-a.test', '2026-08-05T00:00:00Z', 'corr-e');
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: colaborador trocou o contato financeiro';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.fn_billing_accept_terms(
      pg_temp.id('colab_a'), pg_temp.id('org_a'),
      '2026-11-01', '2026-08-05T00:00:00Z', 'corr-e');
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: colaborador aceitou termos';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- E o dono de A não alcança B.
  BEGIN
    PERFORM public.fn_billing_update_billing_email(
      pg_temp.id('dono_a'), pg_temp.id('org_b'),
      'invasor@fixture-a.test', '2026-08-05T00:00:00Z', 'corr-e');
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: dono de A trocou o contato de B';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- O DONO TROCA. E a trilha guarda a MÁSCARA, não o endereço.
  v_json := public.fn_billing_update_billing_email(
    pg_temp.id('dono_a'), pg_temp.id('org_a'),
    'contas@fixture-a.test', '2026-08-05T00:00:00Z', 'corr-e');
  IF v_json->>'billing_email' <> 'contas@fixture-a.test' THEN
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: contato nao foi gravado (%)', v_json;
  END IF;

  SELECT new_value->>'mask' INTO v_txt FROM billing.audit_events
   WHERE organization_id = pg_temp.id('org_a') AND subject::text = 'billing_email'
   ORDER BY id DESC LIMIT 1;
  IF v_txt <> 'c***@fixture-a.test' THEN
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: mascara inesperada na trilha (%)', v_txt;
  END IF;

  SELECT count(*) INTO v_int FROM billing.audit_events
   WHERE organization_id = pg_temp.id('org_a') AND subject::text = 'billing_email'
     AND new_value::text LIKE '%contas@fixture-a.test%';
  IF v_int <> 0 THEN
    RAISE EXCEPTION
      'ASSERÇÃO REPROVADA: o endereco inteiro foi para a trilha append-only';
  END IF;

  -- REPETIR O MESMO VALOR não gera evento novo.
  SELECT count(*) INTO v_int FROM billing.audit_events
   WHERE organization_id = pg_temp.id('org_a') AND subject::text = 'billing_email';
  PERFORM public.fn_billing_update_billing_email(
    pg_temp.id('dono_a'), pg_temp.id('org_a'),
    'contas@fixture-a.test', '2026-08-06T00:00:00Z', 'corr-e');
  IF (SELECT count(*) FROM billing.audit_events
       WHERE organization_id = pg_temp.id('org_a')
         AND subject::text = 'billing_email') <> v_int THEN
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: repetir o mesmo contato gerou evento';
  END IF;

  -- LIMPAR é intenção válida, e vira NULL.
  v_json := public.fn_billing_update_billing_email(
    pg_temp.id('dono_a'), pg_temp.id('org_a'), '   ',
    '2026-08-07T00:00:00Z', 'corr-e');
  IF v_json->>'billing_email' IS NOT NULL THEN
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: limpar o contato nao produziu NULL (%)', v_json;
  END IF;

  -- E-MAIL MALFORMADO é recusado pelo CHECK, e a mensagem do banco cita a
  -- constraint, não o endereço.
  BEGIN
    PERFORM public.fn_billing_update_billing_email(
      pg_temp.id('dono_a'), pg_temp.id('org_a'), 'nao-e-um-email',
      '2026-08-07T00:00:00Z', 'corr-e');
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: e-mail malformado foi aceito';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_txt = MESSAGE_TEXT;
    IF v_txt LIKE '%nao-e-um-email%' THEN
      RAISE EXCEPTION
        'ASSERÇÃO REPROVADA: a mensagem de recusa reproduz o endereco: %', v_txt;
    END IF;
  END;

  -- NOVO ACEITE de versão posterior.
  v_json := public.fn_billing_accept_terms(
    pg_temp.id('dono_a'), pg_temp.id('org_a'),
    '2026-11-01', '2026-08-08T00:00:00Z', 'corr-e');
  IF v_json->>'terms_version' <> '2026-11-01' THEN
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: novo aceite nao gravou a versao (%)', v_json;
  END IF;
  IF v_json->>'terms_accepted_at' IS NULL THEN
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: novo aceite ficou sem instante';
  END IF;

  SELECT count(*) INTO v_int FROM billing.audit_events
   WHERE organization_id = pg_temp.id('org_a') AND subject::text = 'terms_acceptance';
  IF v_int <> 2 THEN
    RAISE EXCEPTION
      'ASSERÇÃO REPROVADA: esperados 2 aceites na trilha (trial + novo), vieram %', v_int;
  END IF;

  -- REPETIÇÃO IDEMPOTENTE: mesma versão, sem evento novo e SEM mexer no
  -- instante original — que é a prova de quando a pessoa aceitou.
  PERFORM public.fn_billing_accept_terms(
    pg_temp.id('dono_a'), pg_temp.id('org_a'),
    '2026-11-01', '2026-09-01T00:00:00Z', 'corr-e');
  SELECT count(*) INTO v_int FROM billing.audit_events
   WHERE organization_id = pg_temp.id('org_a') AND subject::text = 'terms_acceptance';
  IF v_int <> 2 THEN
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: reenvio do mesmo aceite gerou evento (%)', v_int;
  END IF;
  SELECT terms_accepted_at::text INTO v_txt FROM billing.subscriptions
   WHERE organization_id = pg_temp.id('org_a');
  IF v_txt IS DISTINCT FROM (SELECT ('2026-08-08T00:00:00Z'::timestamptz)::text) THEN
    RAISE EXCEPTION
      'ASSERÇÃO REPROVADA: reenvio sobrescreveu o instante do aceite (%)', v_txt;
  END IF;

  -- REGREDIR é recusado pelo BANCO.
  BEGIN
    PERFORM public.fn_billing_accept_terms(
      pg_temp.id('dono_a'), pg_temp.id('org_a'),
      '2026-08-10', '2026-09-01T00:00:00Z', 'corr-e');
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: versao anterior de termos foi aceita';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  -- Sem assinatura, as duas respondem "não há registro" — e não "não existe
  -- organização", que seria informação a mais.
  BEGIN
    PERFORM public.fn_billing_accept_terms(
      pg_temp.id('dono_b'), pg_temp.id('org_b'),
      '2026-11-01', '2026-08-08T00:00:00Z', 'corr-e');
  EXCEPTION WHEN no_data_found THEN
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: B tem assinatura e respondeu no_data_found';
  END;

  RAISE NOTICE
    'billing12B/pos-trial OK: so o dono altera, mascara na trilha, aceite idempotente e sem regressao';
END
$pos_trial$;


ROLLBACK;

-- ═════════════════════════════════════════════════════════════════════════════
-- C. NENHUMA FIXTURE SOBREVIVEU
-- ═════════════════════════════════════════════════════════════════════════════

DO $limpeza$
DECLARE
  v_int integer;
BEGIN
  SELECT count(*) INTO v_int FROM public.organizations
   WHERE slug IN ('fixture-12b-a', 'fixture-12b-b', 'fixture-12b-c');
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
