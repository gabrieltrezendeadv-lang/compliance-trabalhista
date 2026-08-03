-- =============================================================================
-- REMOÇÃO DAS FIXTURES DO CONTRATO, E CONFERÊNCIA DE QUE NADA SOBROU
-- =============================================================================
--
-- Uso:
--   bash scripts/ci/teardown-contract-fixtures.sh
--
-- NÃO invoque este arquivo direto pelo psql. O wrapper decide o destino ANTES
-- de conectar e recusa qualquer coisa que não seja loopback; chamar o .sql
-- direto pula essa decisão. Ver o cabeçalho de `teardown-contract-fixtures.sh`.
--
-- ── O QUE ESTE ARQUIVO PODE FAZER, E POR QUE É CERCADO ──────────────────────
--
-- Esta é a única operação do repositório que afrouxa uma proteção de billing:
-- `SET LOCAL session_replication_role = replica` desliga os triggers de
-- imutabilidade para poder apagar. Cinco cercas, e cada uma tem uma mutação em
-- tests/contract-fixture-teardown-guard.mjs que a reprova se sumir:
--
--   1. destino loopback ..... decidido no wrapper, antes de qualquer conexão
--   2. proprietário ......... quem não é dono do schema billing não passa daqui
--   3. LOCAL ................ o afrouxamento morre no COMMIT, e isso é conferido
--   4. prefixo determinístico  todo DELETE filtra pelo UUID das fixtures
--   5. conferência .......... removidas = existentes, e zero sobreviventes
--
-- A ordem dos DELETEs é a das dependências: primeiro o que referencia, depois o
-- que é referenciado. `ON DELETE RESTRICT` em billing é deliberado — nada de
-- billing some por cascata, e por isso a remoção é explícita, tabela por tabela.
-- =============================================================================

\set ON_ERROR_STOP on

-- Identifica as fixtures pelo prefixo determinístico do UUID. Este é o ÚNICO
-- lugar em que o prefixo é escrito: os blocos DO o leem de `_contrato_prefixo`,
-- porque dentro de string dollar-quoted o psql não interpola variável, e um
-- literal repetido é um literal que pode divergir.
\set PREFIXO '0c07a000-0000-4000-8000-%'

BEGIN;

CREATE TEMP TABLE _contrato_prefixo(p text NOT NULL);
INSERT INTO _contrato_prefixo VALUES (:'PREFIXO');

-- ── CERCA 2: SOMENTE O PROPRIETÁRIO ─────────────────────────────────────────
DO $precondicoes$
DECLARE
  v_dono     text;
  v_prefixo  text;
BEGIN
  SELECT p INTO v_prefixo FROM _contrato_prefixo;

  IF v_prefixo IS NULL OR length(v_prefixo) < 8 OR right(v_prefixo, 1) <> '%' THEN
    RAISE EXCEPTION 'contrato/teardown: prefixo de fixture ausente ou amplo demais (%)', v_prefixo;
  END IF;

  SELECT pg_catalog.pg_get_userbyid(nspowner) INTO v_dono
    FROM pg_catalog.pg_namespace WHERE nspname = 'billing';

  IF v_dono IS NULL THEN
    RAISE EXCEPTION 'contrato/teardown: schema billing inexistente';
  END IF;

  -- Membro do papel dono basta: no CI o psql conecta como `postgres`, que é o
  -- próprio dono. Quem não for é recusado ANTES de qualquer DELETE.
  IF NOT pg_catalog.pg_has_role(current_user, v_dono::name, 'MEMBER') THEN
    RAISE EXCEPTION 'contrato/teardown: % nao e proprietario de billing (dono: %)',
      current_user, v_dono
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RAISE NOTICE 'contrato/teardown: proprietario % confirmado, prefixo %', current_user, v_prefixo;
END
$precondicoes$;

-- ── CERCA 3: O AFROUXAMENTO É LOCAL ─────────────────────────────────────────
--
-- `tg_price_snapshot_immutable` e `tg_audit_events_append_only` recusam DELETE
-- — e é exatamente para isso que existem. `SET LOCAL` limita o efeito a esta
-- transação: o COMMIT o desfaz, nenhuma outra sessão enxerga o afrouxamento, e
-- a verificação pós-COMMIT no fim deste arquivo prova a restauração.
SET LOCAL session_replication_role = replica;

-- Aqui só se confirma que o afrouxamento ENTROU em vigor. Que ele é LOCAL não
-- se decide por catálogo: `pg_settings.source` registra 'session' tanto para
-- `SET` quanto para `SET LOCAL`, e um teste baseado nisso daria falso veredito.
-- A prova de que é LOCAL é comportamental e vem depois do COMMIT, no bloco
-- `confirmar_restauracao`; a prova textual está em
-- tests/contract-fixture-teardown-guard.mjs, que reprova `SET` sem `LOCAL`.
DO $confirmar_afrouxamento$
DECLARE
  v_atual text;
BEGIN
  SELECT setting INTO v_atual
    FROM pg_catalog.pg_settings WHERE name = 'session_replication_role';

  IF v_atual <> 'replica' THEN
    RAISE EXCEPTION 'contrato/teardown: session_replication_role e %, esperado replica', v_atual;
  END IF;
END
$confirmar_afrouxamento$;

-- ── CERCA 5a: QUANTAS EXISTEM ANTES ─────────────────────────────────────────
CREATE TEMP TABLE _contrato_antes(tabela text PRIMARY KEY, n bigint NOT NULL);
CREATE TEMP TABLE _contrato_removidas(tabela text PRIMARY KEY, n bigint NOT NULL);

INSERT INTO _contrato_antes(tabela, n)
SELECT 'billing.provider_events', count(*) FROM billing.provider_events
 WHERE organization_id::text LIKE :'PREFIXO';
INSERT INTO _contrato_antes(tabela, n)
SELECT 'billing.charges', count(*) FROM billing.charges
 WHERE organization_id::text LIKE :'PREFIXO';
INSERT INTO _contrato_antes(tabela, n)
SELECT 'billing.idempotency_records', count(*) FROM billing.idempotency_records
 WHERE organization_id::text LIKE :'PREFIXO';
INSERT INTO _contrato_antes(tabela, n)
SELECT 'billing.customers', count(*) FROM billing.customers
 WHERE organization_id::text LIKE :'PREFIXO';
INSERT INTO _contrato_antes(tabela, n)
SELECT 'billing.courtesy_revocations', count(*) FROM billing.courtesy_revocations
 WHERE organization_id::text LIKE :'PREFIXO';
INSERT INTO _contrato_antes(tabela, n)
SELECT 'billing.courtesies', count(*) FROM billing.courtesies
 WHERE organization_id::text LIKE :'PREFIXO';
INSERT INTO _contrato_antes(tabela, n)
SELECT 'billing.grandfathered_organizations', count(*) FROM billing.grandfathered_organizations
 WHERE organization_id::text LIKE :'PREFIXO';
INSERT INTO _contrato_antes(tabela, n)
SELECT 'billing.price_snapshots', count(*) FROM billing.price_snapshots
 WHERE subscription_id IN (
   SELECT id FROM billing.subscriptions WHERE organization_id::text LIKE :'PREFIXO'
 );
INSERT INTO _contrato_antes(tabela, n)
SELECT 'billing.audit_events', count(*) FROM billing.audit_events
 WHERE organization_id::text LIKE :'PREFIXO';
INSERT INTO _contrato_antes(tabela, n)
SELECT 'billing.subscriptions', count(*) FROM billing.subscriptions
 WHERE organization_id::text LIKE :'PREFIXO';
INSERT INTO _contrato_antes(tabela, n)
SELECT 'public.organization_members', count(*) FROM public.organization_members
 WHERE tenant_id::text LIKE :'PREFIXO';
INSERT INTO _contrato_antes(tabela, n)
SELECT 'public.organizations', count(*) FROM public.organizations
 WHERE id::text LIKE :'PREFIXO';
INSERT INTO _contrato_antes(tabela, n)
SELECT 'public.profiles', count(*) FROM public.profiles
 WHERE id::text LIKE :'PREFIXO';
INSERT INTO _contrato_antes(tabela, n)
SELECT 'auth.users', count(*) FROM auth.users
 WHERE id::text LIKE :'PREFIXO';

-- ── CERCA 4: TODO DELETE FILTRA PELO PREFIXO ────────────────────────────────
--
-- Cada statement apaga e contabiliza no mesmo comando. Não há DELETE sem WHERE
-- e não há TRUNCATE neste arquivo — `tests/contract-fixture-teardown-guard.mjs`
-- reprova ambos, e reprova um WHERE que não cite o prefixo.

WITH r AS (
  DELETE FROM billing.provider_events
   WHERE organization_id::text LIKE :'PREFIXO' RETURNING 1)
INSERT INTO _contrato_removidas(tabela, n) SELECT 'billing.provider_events', count(*) FROM r;

WITH r AS (
  DELETE FROM billing.charges
   WHERE organization_id::text LIKE :'PREFIXO' RETURNING 1)
INSERT INTO _contrato_removidas(tabela, n) SELECT 'billing.charges', count(*) FROM r;

WITH r AS (
  DELETE FROM billing.idempotency_records
   WHERE organization_id::text LIKE :'PREFIXO' RETURNING 1)
INSERT INTO _contrato_removidas(tabela, n) SELECT 'billing.idempotency_records', count(*) FROM r;

WITH r AS (
  DELETE FROM billing.customers
   WHERE organization_id::text LIKE :'PREFIXO' RETURNING 1)
INSERT INTO _contrato_removidas(tabela, n) SELECT 'billing.customers', count(*) FROM r;

WITH r AS (
  DELETE FROM billing.courtesy_revocations
   WHERE organization_id::text LIKE :'PREFIXO' RETURNING 1)
INSERT INTO _contrato_removidas(tabela, n) SELECT 'billing.courtesy_revocations', count(*) FROM r;

WITH r AS (
  DELETE FROM billing.courtesies
   WHERE organization_id::text LIKE :'PREFIXO' RETURNING 1)
INSERT INTO _contrato_removidas(tabela, n) SELECT 'billing.courtesies', count(*) FROM r;

WITH r AS (
  DELETE FROM billing.grandfathered_organizations
   WHERE organization_id::text LIKE :'PREFIXO' RETURNING 1)
INSERT INTO _contrato_removidas(tabela, n) SELECT 'billing.grandfathered_organizations', count(*) FROM r;

WITH r AS (
  DELETE FROM billing.price_snapshots
   WHERE subscription_id IN (
     SELECT id FROM billing.subscriptions WHERE organization_id::text LIKE :'PREFIXO'
   ) RETURNING 1)
INSERT INTO _contrato_removidas(tabela, n) SELECT 'billing.price_snapshots', count(*) FROM r;

WITH r AS (
  DELETE FROM billing.audit_events
   WHERE organization_id::text LIKE :'PREFIXO' RETURNING 1)
INSERT INTO _contrato_removidas(tabela, n) SELECT 'billing.audit_events', count(*) FROM r;

WITH r AS (
  DELETE FROM billing.subscriptions
   WHERE organization_id::text LIKE :'PREFIXO' RETURNING 1)
INSERT INTO _contrato_removidas(tabela, n) SELECT 'billing.subscriptions', count(*) FROM r;

WITH r AS (
  DELETE FROM public.organization_members
   WHERE tenant_id::text LIKE :'PREFIXO' RETURNING 1)
INSERT INTO _contrato_removidas(tabela, n) SELECT 'public.organization_members', count(*) FROM r;

WITH r AS (
  DELETE FROM public.organizations
   WHERE id::text LIKE :'PREFIXO' RETURNING 1)
INSERT INTO _contrato_removidas(tabela, n) SELECT 'public.organizations', count(*) FROM r;

WITH r AS (
  DELETE FROM public.profiles
   WHERE id::text LIKE :'PREFIXO' RETURNING 1)
INSERT INTO _contrato_removidas(tabela, n) SELECT 'public.profiles', count(*) FROM r;

WITH r AS (
  DELETE FROM auth.users
   WHERE id::text LIKE :'PREFIXO' RETURNING 1)
INSERT INTO _contrato_removidas(tabela, n) SELECT 'auth.users', count(*) FROM r;

-- ── CERCA 5b: REMOVIDAS = EXISTENTES, TABELA A TABELA ───────────────────────
--
-- Uma limpeza que não confere o resultado não é limpeza. Se um trigger, uma
-- policy ou uma FK tivesse bloqueado silenciosamente um DELETE, `removidas`
-- ficaria abaixo de `antes` e o passo REPROVA aqui — dentro da transação, antes
-- do COMMIT.
DO $conferir_removidas$
DECLARE
  v_divergencia text;
  v_total       bigint;
BEGIN
  SELECT string_agg(format('%s: existiam %s, removidas %s',
                           coalesce(a.tabela, r.tabela), coalesce(a.n, -1), coalesce(r.n, -1)),
                    E'\n  ' ORDER BY coalesce(a.tabela, r.tabela))
    INTO v_divergencia
    FROM _contrato_antes a
    FULL JOIN _contrato_removidas r ON r.tabela = a.tabela
   WHERE a.n IS DISTINCT FROM r.n;

  IF v_divergencia IS NOT NULL THEN
    RAISE EXCEPTION E'contrato/teardown: DELETE nao removeu tudo o que existia —\n  %', v_divergencia;
  END IF;

  SELECT sum(n) INTO v_total FROM _contrato_removidas;

  RAISE NOTICE 'contrato/teardown: % linha(s) de fixture removida(s) em % tabela(s), conferidas uma a uma',
    coalesce(v_total, 0), (SELECT count(*) FROM _contrato_removidas);
END
$conferir_removidas$;

COMMIT;

-- ── CERCA 3 (prova): O COMMIT RESTAUROU A CONFIGURAÇÃO ──────────────────────
--
-- Fora da transação. Se o `SET` tivesse sido global, `session_replication_role`
-- continuaria em `replica` aqui, e a sessão seguiria com os triggers desligados.
DO $confirmar_restauracao$
DECLARE
  v_atual text;
BEGIN
  SELECT setting INTO v_atual
    FROM pg_catalog.pg_settings WHERE name = 'session_replication_role';

  IF v_atual <> 'origin' THEN
    RAISE EXCEPTION
      'contrato/teardown: session_replication_role continua % apos o COMMIT — o afrouxamento vazou da transacao',
      v_atual;
  END IF;

  RAISE NOTICE 'contrato/teardown: session_replication_role restaurado para origin pelo COMMIT';
END
$confirmar_restauracao$;

-- ─────────────────────────────────────────────────────────────────────────────
-- CERCA 5c: nenhuma fixture sobreviveu
-- ─────────────────────────────────────────────────────────────────────────────

DO $conferir$
DECLARE
  v_txt     text;
  v_prefixo text;
BEGIN
  SELECT p INTO v_prefixo FROM _contrato_prefixo;

  SELECT string_agg(format('%s=%s', origem, quantidade), ', ')
    INTO v_txt
    FROM (
      SELECT 'billing.subscriptions' AS origem, count(*) AS quantidade
        FROM billing.subscriptions
       WHERE organization_id::text LIKE v_prefixo
      UNION ALL
      SELECT 'billing.charges', count(*) FROM billing.charges
       WHERE organization_id::text LIKE v_prefixo
      UNION ALL
      SELECT 'billing.idempotency_records', count(*) FROM billing.idempotency_records
       WHERE organization_id::text LIKE v_prefixo
      UNION ALL
      SELECT 'billing.provider_events', count(*) FROM billing.provider_events
       WHERE organization_id::text LIKE v_prefixo
      UNION ALL
      SELECT 'billing.customers', count(*) FROM billing.customers
       WHERE organization_id::text LIKE v_prefixo
      UNION ALL
      SELECT 'billing.courtesies', count(*) FROM billing.courtesies
       WHERE organization_id::text LIKE v_prefixo
      UNION ALL
      SELECT 'billing.courtesy_revocations', count(*) FROM billing.courtesy_revocations
       WHERE organization_id::text LIKE v_prefixo
      UNION ALL
      SELECT 'billing.grandfathered_organizations', count(*) FROM billing.grandfathered_organizations
       WHERE organization_id::text LIKE v_prefixo
      UNION ALL
      SELECT 'billing.audit_events', count(*) FROM billing.audit_events
       WHERE organization_id::text LIKE v_prefixo
      UNION ALL
      SELECT 'public.organizations', count(*) FROM public.organizations
       WHERE id::text LIKE v_prefixo
      UNION ALL
      SELECT 'public.organization_members', count(*) FROM public.organization_members
       WHERE tenant_id::text LIKE v_prefixo
      UNION ALL
      SELECT 'public.profiles', count(*) FROM public.profiles
       WHERE id::text LIKE v_prefixo
      UNION ALL
      SELECT 'auth.users', count(*) FROM auth.users
       WHERE id::text LIKE v_prefixo
    ) s
   WHERE quantidade > 0;

  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'contrato/teardown: fixture(s) sobreviveram — %', v_txt;
  END IF;

  RAISE NOTICE 'contrato/teardown OK: nenhuma fixture sobreviveu';
END
$conferir$;
