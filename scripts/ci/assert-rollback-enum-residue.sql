-- =============================================================================
-- RESÍDUO DO ROLLBACK DA 12C.1 — o conjunto EXATO de rótulos que sobra
-- =============================================================================
--
-- Uso:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f scripts/ci/assert-rollback-enum-residue.sql
--
-- Roda DEPOIS do rollback de `20260810120000` e ANTES do rollback da 12B — que
-- derruba o schema `billing` inteiro e levaria o enum junto.
--
-- ── POR QUE ISTO NÃO MORA DENTRO DO ROLLBACK ────────────────────────────────
--
-- Uma asserção de "o enum tem exatamente estes onze rótulos" dentro do arquivo
-- de rollback seria uma afirmação ETERNA: a 12C.2, a 12D e qualquer etapa que
-- acrescente um assunto de auditoria passariam a reprovar ao reverter a 12C.1,
-- por uma mudança que não é dela. O conjunto exato é fato DESTA etapa, e o
-- lugar dele é o ensaio de rollback desta etapa.
--
-- O arquivo de rollback continua emitindo o aviso; o que se prova aqui é o
-- comportamento.
--
-- ── O QUE SE PROVA ──────────────────────────────────────────────────────────
--
--   1. os nove rótulos anteriores à 12C.1 continuam presentes, com os nomes
--      que sempre tiveram — renomear um é tão grave quanto removê-lo;
--   2. `terms_acceptance` e `billing_email` continuam presentes;
--   3. o total é ONZE: nenhum rótulo extra entrou, nenhum sumiu;
--   4. nada mais da 12C.1 sobreviveu — coluna, RPC, auxiliar ou privilégio;
--   5. os dois rótulos residuais não HABILITAM nada: nenhuma função instalada
--      os menciona, e ninguém pode chamar quem escreveria com eles.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN TRANSACTION READ ONLY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. O conjunto EXATO de rótulos de `billing.audit_subject`
-- ─────────────────────────────────────────────────────────────────────────────

DO $enum$
DECLARE
  -- Os NOVE anteriores: sete da 12A, dois da 12B.
  v_anteriores text[] := ARRAY[
    'worker_count', 'tier_change', 'plan_change', 'courtesy',
    'grandfathering', 'subscription_state', 'price_catalog',
    'payment', 'charge'
  ];
  -- Os DOIS que a 12C.1 acrescentou e o PostgreSQL não sabe remover.
  v_residuos text[] := ARRAY['terms_acceptance', 'billing_email'];
  v_real     text[];
  v_txt      text;
  v_int      integer;
BEGIN
  SELECT array_agg(en.enumlabel::text ORDER BY en.enumlabel)
    INTO v_real
    FROM pg_enum en
    JOIN pg_type t ON t.oid = en.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
   WHERE n.nspname = 'billing' AND t.typname = 'audit_subject';

  IF v_real IS NULL THEN
    RAISE EXCEPTION
      'RESIDUO 20260810120000: billing.audit_subject nao existe — o rollback foi longe demais';
  END IF;

  -- 1.1 AUSENTE ou RENOMEADO. Um rótulo renomeado some desta lista e aparece
  -- como extra em 1.3 — as duas asserções juntas é que o pegam.
  SELECT string_agg(e, ', ' ORDER BY e) INTO v_txt
    FROM unnest(v_anteriores) AS e
   WHERE NOT (e = ANY(v_real));
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION
      'RESIDUO 20260810120000: rotulo ANTERIOR a 12C.1 desapareceu do enum: %', v_txt;
  END IF;

  -- 1.2 Os dois resíduos declarados continuam lá. Se sumissem, a decisão
  -- documentada estaria errada — e o rollback teria feito algo que não sabe
  -- fazer.
  SELECT string_agg(e, ', ' ORDER BY e) INTO v_txt
    FROM unnest(v_residuos) AS e
   WHERE NOT (e = ANY(v_real));
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION
      'RESIDUO 20260810120000: rotulo residual declarado nao esta no enum: %', v_txt;
  END IF;

  -- 1.3 EXTRA. Qualquer rótulo fora das duas listas é resíduo que ninguém
  -- declarou — inclusive o lado renomeado de um rename.
  SELECT string_agg(e, ', ' ORDER BY e) INTO v_txt
    FROM unnest(v_real) AS e
   WHERE NOT (e = ANY(v_anteriores)) AND NOT (e = ANY(v_residuos));
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION
      'RESIDUO 20260810120000: rotulo NAO DECLARADO no enum apos o rollback: %', v_txt;
  END IF;

  -- 1.4 E a contagem fecha: 9 + 2, exatamente.
  v_int := array_length(v_real, 1);
  IF v_int <> array_length(v_anteriores, 1) + array_length(v_residuos, 1) THEN
    RAISE EXCEPTION
      'RESIDUO 20260810120000: enum tem % rotulo(s), esperados % (9 anteriores + 2 residuos): %',
      v_int,
      array_length(v_anteriores, 1) + array_length(v_residuos, 1),
      array_to_string(v_real, ', ');
  END IF;

  RAISE NOTICE
    'RESIDUO 20260810120000 OK: % rotulos — os 9 anteriores intactos e SOMENTE terms_acceptance e billing_email como residuo',
    v_int;
END
$enum$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Nada mais da 12C.1 sobreviveu
-- ─────────────────────────────────────────────────────────────────────────────

DO $resto$
DECLARE
  v_txt text;
  v_int integer;
BEGIN
  -- 2.1 As três colunas.
  SELECT string_agg(c.column_name, ', ' ORDER BY c.column_name) INTO v_txt
    FROM information_schema.columns c
   WHERE c.table_schema = 'billing' AND c.table_name = 'subscriptions'
     AND c.column_name IN ('billing_email', 'terms_version', 'terms_accepted_at');
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'RESIDUO 20260810120000: coluna sobreviveu: %', v_txt;
  END IF;

  -- 2.2 Os três CHECKs.
  SELECT string_agg(c.conname, ', ' ORDER BY c.conname) INTO v_txt
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'billing' AND t.relname = 'subscriptions'
     AND c.conname IN ('subscriptions_termos_par_completo',
                       'subscriptions_termos_versao_valida',
                       'subscriptions_billing_email_valido');
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'RESIDUO 20260810120000: CHECK sobreviveu: %', v_txt;
  END IF;

  -- 2.3 As duas RPCs e a assinatura nova de start_trial.
  SELECT string_agg(e, ', ' ORDER BY e) INTO v_txt
    FROM unnest(ARRAY[
      'public.fn_billing_update_billing_email(uuid, uuid, text, timestamp with time zone, text)',
      'public.fn_billing_accept_terms(uuid, uuid, text, timestamp with time zone, text)',
      'public.fn_billing_start_trial(uuid, uuid, text, text, text, integer, text, '
        'timestamp with time zone, timestamp with time zone, timestamp with time zone, '
        'integer, text, text, text, text, timestamp with time zone)'
    ]) AS e
   WHERE to_regprocedure(e) IS NOT NULL;
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'RESIDUO 20260810120000: RPC da 12C.1 sobreviveu: %', v_txt;
  END IF;

  -- 2.4 Os quatro auxiliares internos.
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_txt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'billing'
     AND p.proname IN ('fn_mask_email', 'fn_normalize_email',
                       'fn_require_email', 'fn_require_terms_version');
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'RESIDUO 20260810120000: auxiliar da 12C.1 sobreviveu: %', v_txt;
  END IF;

  -- 2.5 O regime de privilégio voltou ao da 12B: dezesseis, só service_role.
  SELECT count(*) INTO v_int
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_billing\_%';
  IF v_int <> 16 THEN
    RAISE EXCEPTION
      'RESIDUO 20260810120000: % RPCs em public apos reverter, esperadas 16', v_int;
  END IF;

  SELECT string_agg(format('%s para %s', p.oid::regprocedure::text, papel), ', ')
    INTO v_txt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN unnest(ARRAY['anon', 'authenticated']) AS papel
   WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_billing\_%'
     AND has_function_privilege(papel, p.oid, 'EXECUTE');
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'RESIDUO 20260810120000: EXECUTE indevido apos reverter: %', v_txt;
  END IF;

  RAISE NOTICE
    'RESIDUO 20260810120000 OK: nenhuma coluna, CHECK, RPC, auxiliar ou privilegio da 12C.1 sobreviveu';
END
$resto$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Os dois rótulos residuais não HABILITAM nada
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Rótulo de enum não concede privilégio e não guarda dado. O que o tornaria
-- vivo seria alguma função instalada continuar escrevendo com ele — e nenhuma
-- continua: `fn_billing_start_trial` voltou ao corpo da 12B e as duas RPCs da
-- 12C.1 sumiram.

DO $inerte$
DECLARE
  v_txt text;
  v_int integer;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_txt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('public', 'billing')
     AND p.prokind = 'f'
     AND pg_get_functiondef(p.oid) ~ '(terms_acceptance|billing_email)';
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION
      'RESIDUO 20260810120000: funcao instalada ainda escreve com os rotulos residuais: %', v_txt;
  END IF;

  -- E o único caminho que poderia escrever com eles — `billing.fn_audit` —
  -- continua fora do alcance de todo papel do PostgREST.
  SELECT count(*) INTO v_int
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN unnest(ARRAY['anon', 'authenticated', 'service_role']) AS papel
   WHERE n.nspname = 'billing'
     AND has_function_privilege(papel, p.oid, 'EXECUTE');
  IF v_int <> 0 THEN
    RAISE EXCEPTION
      'RESIDUO 20260810120000: % auxiliar(es) de billing alcancavel(is) apos reverter', v_int;
  END IF;

  RAISE NOTICE
    'RESIDUO 20260810120000 OK: os dois rotulos sao inertes — nenhuma funcao os menciona, nenhum papel alcanca quem escreveria';
END
$inerte$;

ROLLBACK;
