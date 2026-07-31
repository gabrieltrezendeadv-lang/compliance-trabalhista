-- =============================================================================
-- ASSERÇÃO — a exceção nominal de billing em `public`, conferida no CATÁLOGO
-- =============================================================================
--
-- Uso:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f scripts/ci/assert-billing-rpcs.sql
--
-- SOMENTE LEITURA: `BEGIN TRANSACTION READ ONLY` … `ROLLBACK`. Nenhuma fixture.
--
-- ── POR QUE ESTE ARQUIVO EXISTE ─────────────────────────────────────────────
--
-- A Etapa 12A estabeleceu "nenhum objeto de billing em `public`". A 12B abre
-- uma exceção — as dezesseis RPCs — e uma exceção sem vigia é só uma regra
-- revogada.
--
-- Os blocos dessas dezesseis funções são RETIRADOS da âncora textual do
-- `migration-rebuild-verify` por `scripts/ci/split-public-rpcs.mjs`. Este
-- arquivo é a contrapartida, e ele é MAIS FORTE do que o diff que substitui:
-- os dumps são tirados com `--no-owner --no-privileges`, então a comparação
-- textual nunca enxergou proprietário, `SECURITY DEFINER` nem ACL. O catálogo
-- enxerga os três.
--
-- ── A LISTA É ESCRITA À MÃO, DE PROPÓSITO ───────────────────────────────────
--
-- `scripts/ci/billing-rpc-allowlist.mjs` tem a mesma lista. Este arquivo NÃO a
-- importa e não pode importar: um verificador que lê a declaração do verificado
-- concorda com ele por construção, e concordância por construção não é prova.
-- São duas cópias independentes; divergir entre elas REPROVA, que é o
-- resultado desejado.
--
-- ── O QUE É EXIGIDO DE CADA RPC ─────────────────────────────────────────────
--
--   assinatura exata · tipo de retorno · volatilidade · SECURITY DEFINER ·
--   owner igual ao dono do schema · search_path VAZIO · EXECUTE só para
--   service_role · anon e authenticated recusados de fato
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN TRANSACTION READ ONLY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. O CONJUNTO EXATO
-- ─────────────────────────────────────────────────────────────────────────────

-- Nada de tabela temporária: numa transação READ ONLY isso é território
-- discutível, e uma asserção não pode depender de um detalhe discutível. A
-- lista esperada é um array literal, e cada elemento é
-- `assinatura|retorno|volatilidade` — leitura é STABLE (`s`), escrita é
-- VOLATILE (`v`), e todas devolvem jsonb.
DO $conjunto$
DECLARE
  v_txt   text;
  v_int   integer;
  v_owner oid;
  v_esperadas text[] := ARRAY[
    'fn_billing_read_state(uuid, uuid)|jsonb|s',
    'fn_billing_read_catalog(uuid, uuid, text)|jsonb|s',
    'fn_billing_read_ledger(uuid, uuid)|jsonb|s',
    'fn_billing_start_trial(uuid, uuid, text, text, text, integer, text, timestamp with time zone, timestamp with time zone, timestamp with time zone, integer, text, text)|jsonb|v',
    'fn_billing_change_plan(uuid, uuid, text, text, text, text, timestamp with time zone, timestamp with time zone, integer, text, text, text, text, text, timestamp with time zone)|jsonb|v',
    'fn_billing_schedule_downgrade(uuid, uuid, text, text, text, text, timestamp with time zone)|jsonb|v',
    'fn_billing_cancel_at_period_end(uuid, uuid, text, text, timestamp with time zone)|jsonb|v',
    'fn_billing_transition_state(uuid, uuid, text, text, text, text, timestamp with time zone)|jsonb|v',
    'fn_billing_record_worker_count(uuid, uuid, integer, text, timestamp with time zone)|jsonb|v',
    'fn_billing_claim_idempotency(uuid, uuid, text, text, text, text, text, timestamp with time zone)|jsonb|v',
    'fn_billing_fail_idempotency(uuid, uuid, text, text, text, text, text, timestamp with time zone)|jsonb|v',
    'fn_billing_finalize_checkout(uuid, uuid, text, text, text, text, text, integer, timestamp with time zone, timestamp with time zone, text, text, text, timestamp with time zone)|jsonb|v',
    'fn_billing_apply_provider_event(text, text, text, text, text, timestamp with time zone, text, timestamp with time zone)|jsonb|v',
    'fn_billing_grant_courtesy(uuid, uuid, text, timestamp with time zone, timestamp with time zone, text, text)|jsonb|v',
    'fn_billing_revoke_courtesy(uuid, uuid, uuid, timestamp with time zone, text, text)|jsonb|v',
    'fn_billing_save_grandfathering(uuid, uuid, timestamp with time zone, timestamp with time zone, text)|jsonb|v'
  ];
BEGIN
  IF array_length(v_esperadas, 1) <> 16 THEN
    RAISE EXCEPTION 'a lista esperada deste verificador tem % entradas, deveria ter 16',
      array_length(v_esperadas, 1);
  END IF;

  -- 1.1 Nenhuma AUSENTE, e retorno/volatilidade conferem na mesma passada.
  SELECT string_agg(split_part(e, '|', 1), E'\n  ' ORDER BY e) INTO v_txt
    FROM unnest(v_esperadas) AS e
   WHERE NOT EXISTS (
     SELECT 1
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
            = split_part(e, '|', 1)
        AND pg_catalog.format_type(p.prorettype, NULL) = split_part(e, '|', 2)
        AND p.provolatile::text = split_part(e, '|', 3)
   );
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION
      E'RPC(s) AUSENTE(S), com assinatura, retorno ou volatilidade diferente:\n  %', v_txt;
  END IF;

  -- 1.2 Nenhuma EXTRA. É aqui que uma sobrecarga acidental ou maliciosa morre:
  --     `fn_billing_read_state(uuid, uuid, text)` seria outra função, com o
  --     mesmo nome, escolhida pelo PostgREST conforme o que o chamador manda.
  SELECT string_agg(
           p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
           E'\n  ' ORDER BY p.proname)
    INTO v_txt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_billing\_%'
     AND NOT EXISTS (
       SELECT 1 FROM unnest(v_esperadas) AS e
        WHERE split_part(e, '|', 1)
              = p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
     );
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION E'RPC(s) de billing NÃO AUTORIZADA(S) em public:\n  %', v_txt;
  END IF;

  SELECT count(*) INTO v_int
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_billing\_%';
  IF v_int <> 16 THEN
    RAISE EXCEPTION 'esperadas 16 RPCs de billing, encontradas %', v_int;
  END IF;

  -- 1.3 SECURITY DEFINER, owner esperado e search_path VAZIO.
  --
  -- O owner esperado é o dono das tabelas de billing: as funções rodam como
  -- ele, e é por isso que alcançam um schema em que `service_role` não tem
  -- nem USAGE. Um owner diferente significaria privilégio diferente do
  -- revisado.
  SELECT c.relowner INTO v_owner FROM pg_class c WHERE c.oid = 'billing.subscriptions'::regclass;

  SELECT string_agg(
           format('%s [secdef=%s owner=%s search_path=%s]',
                  p.proname, p.prosecdef, pg_get_userbyid(p.proowner),
                  COALESCE(array_to_string(p.proconfig, ','), '(nenhum)')),
           E'\n  ' ORDER BY p.proname)
    INTO v_txt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_billing\_%'
     AND (NOT p.prosecdef
          OR p.proowner <> v_owner
          OR NOT EXISTS (
               SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) AS cfg
                WHERE cfg IN ('search_path=', 'search_path=""')
             ));
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION
      E'RPC(s) sem SECURITY DEFINER, com owner inesperado ou sem search_path vazio:\n  %',
      v_txt;
  END IF;

  RAISE NOTICE 'billingRPC/catalogo OK: 16 assinaturas exatas, SECURITY DEFINER, owner %, search_path vazio',
    pg_get_userbyid(v_owner);
END
$conjunto$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. PRIVILÉGIO DE EXECUÇÃO
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Duas perguntas diferentes, e as duas precisam ser feitas:
--
--   * a ACL explodida mostra alguém além de service_role? (`aclexplode`)
--   * o PostgreSQL, perguntado diretamente, deixa anon executar?
--     (`has_function_privilege`)
--
-- A primeira pega o GRANT indevido. A segunda pega herança de papel — anon
-- ganhando EXECUTE por pertencer a um grupo que tem — que a primeira não veria.

DO $execucao$
DECLARE
  v_txt text;
BEGIN
  SELECT string_agg(format('%s → %s (%s)', p.proname,
                           CASE WHEN a.grantee = 0 THEN 'PUBLIC'
                                ELSE pg_get_userbyid(a.grantee) END,
                           a.privilege_type),
                    E'\n  ')
    INTO v_txt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
   WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_billing\_%'
     AND a.grantee <> p.proowner
     AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) <> 'service_role');
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION E'EXECUTE indevido em RPC de billing:\n  %', v_txt;
  END IF;

  -- Pergunta direta ao PostgreSQL, papel por papel.
  SELECT string_agg(format('%s executável por %s', p.oid::regprocedure::text, papel),
                    E'\n  ')
    INTO v_txt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN unnest(ARRAY['anon', 'authenticated']) AS papel
   WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_billing\_%'
     AND has_function_privilege(papel, p.oid, 'EXECUTE');
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION E'papel do PostgREST alcança RPC de billing:\n  %', v_txt;
  END IF;

  -- E o service_role tem de conseguir, senão a aplicação não funciona — a
  -- asserção não pode passar por "ninguém executa nada".
  SELECT string_agg(p.oid::regprocedure::text, E'\n  ')
    INTO v_txt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_billing\_%'
     AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE');
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION E'service_role NÃO alcança RPC(s) — a aplicação ficaria sem porta:\n  %', v_txt;
  END IF;

  RAISE NOTICE 'billingRPC/ACL OK: EXECUTE só para service_role; anon e authenticated recusados';
END
$execucao$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. A EXCEÇÃO É SÓ PARA FUNÇÃO
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Nenhuma tabela, view, sequence ou tipo de billing em `public`. A allowlist
-- não cobre esses, e não deve cobrir: se um dia cobrir, este bloco reprova
-- antes.

DO $somentefuncao$
DECLARE
  v_txt text;
BEGIN
  SELECT string_agg(format('%s (%s)', c.relname, c.relkind), ', ' ORDER BY c.relname)
    INTO v_txt
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('customers', 'charges', 'idempotency_records',
                       'courtesy_revocations', 'provider_events',
                       'tiers', 'price_catalog', 'subscriptions',
                       'price_snapshots', 'courtesies', 'audit_events');
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'objeto de billing indevido em public: %', v_txt;
  END IF;

  SELECT string_agg(t.typname, ', ' ORDER BY t.typname)
    INTO v_txt
    FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
   WHERE n.nspname = 'public'
     AND t.typname IN ('charge_status', 'charge_method', 'idempotency_scope',
                       'idempotency_state', 'plan_slug', 'tier_slug',
                       'billing_period', 'subscription_state', 'audit_subject');
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'tipo de billing indevido em public: %', v_txt;
  END IF;

  RAISE NOTICE 'billingRPC/escopo OK: a exceção nominal vale só para função';
END
$somentefuncao$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. O SCHEMA `billing` CONTINUA FECHADO
-- ─────────────────────────────────────────────────────────────────────────────
--
-- É a outra metade da decisão: as RPCs existem em `public` PRECISAMENTE para
-- que `billing` não precise ser exposto. Se `service_role` recuperar acesso
-- direto, a porta única deixa de ser única — e o filtro por organização volta a
-- ser a única barreira entre tenants, que é o desenho que esta etapa
-- abandonou.

DO $fechado$
DECLARE
  v_txt text;
BEGIN
  IF has_schema_privilege('service_role', 'billing', 'USAGE') THEN
    RAISE EXCEPTION 'service_role recuperou USAGE no schema billing';
  END IF;
  IF has_schema_privilege('anon', 'billing', 'USAGE')
     OR has_schema_privilege('authenticated', 'billing', 'USAGE') THEN
    RAISE EXCEPTION 'papel do PostgREST tem USAGE no schema billing';
  END IF;

  SELECT string_agg(format('%s → %s em %s',
                           CASE WHEN a.grantee = 0 THEN 'PUBLIC'
                                ELSE pg_get_userbyid(a.grantee) END,
                           a.privilege_type, c.relname),
                    E'\n  ' ORDER BY c.relname)
    INTO v_txt
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
   WHERE n.nspname = 'billing' AND c.relkind = 'r'
     AND a.grantee <> c.relowner
     AND (a.grantee = 0
          OR pg_get_userbyid(a.grantee) IN ('anon', 'authenticated', 'service_role'));
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION E'privilégio direto sobrevivente em billing:\n  %', v_txt;
  END IF;

  RAISE NOTICE 'billingRPC/fechamento OK: billing sem USAGE e sem privilégio direto para nenhum papel';
END
$fechado$;

ROLLBACK;
