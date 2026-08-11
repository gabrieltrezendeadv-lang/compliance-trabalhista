-- =============================================================================
-- VERIFICAÇÃO INDEPENDENTE — 20260802093000_billing_orchestration
-- =============================================================================
--
-- Roda DEPOIS da aplicação e é independente das pós-condições da própria
-- migration: aquelas rodam dentro da transação que aplica, escritas pela mesma
-- pessoa e com as mesmas suposições. Quando a suposição está errada, erram
-- junto.
--
-- Onde a migration explode ACL com `aclexplode`, aqui se pergunta ao PostgreSQL
-- por `has_table_privilege` / `has_schema_privilege` / `has_function_privilege`.
-- Dois caminhos para o mesmo fato.
--
-- SOMENTE LEITURA: `BEGIN TRANSACTION READ ONLY` … `ROLLBACK`. Nenhuma fixture.
--
-- Complemento obrigatório: `scripts/ci/assert-billing-rpcs.sql`, que confere o
-- conjunto EXATO de assinaturas. Aqui se confere que a orquestração foi
-- instalada; lá, que a exceção nominal em `public` não cresceu.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN TRANSACTION READ ONLY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Estrutura: 5 tabelas novas, 14 no total, RLS ligada, zero policy
-- ─────────────────────────────────────────────────────────────────────────────

DO $estrutura$
DECLARE
  v_faltando text;
  v_int      integer;
BEGIN
  SELECT string_agg(t.esperada, ', ' ORDER BY t.esperada)
    INTO v_faltando
    FROM unnest(ARRAY['customers', 'charges', 'idempotency_records',
                      'courtesy_revocations', 'provider_events'])
         AS t(esperada)
   WHERE to_regclass('billing.' || quote_ident(t.esperada)) IS NULL;
  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION 'VERIF 20260802093000: tabela(s) ausente(s): %', v_faltando;
  END IF;

  -- A fundação da 12A tem de continuar inteira: esta migration é aditiva no
  -- que diz respeito a OBJETO. Privilégio ela restringe — ver seção 4.
  SELECT string_agg(t.esperada, ', ' ORDER BY t.esperada)
    INTO v_faltando
    FROM unnest(ARRAY[
      'tiers', 'price_catalog', 'subscriptions', 'price_snapshots',
      'grandfathering_cutoff', 'grandfathered_organizations',
      'courtesies', 'audit_events', 'legacy_plan_state'
    ]) AS t(esperada)
   WHERE to_regclass('billing.' || quote_ident(t.esperada)) IS NULL;
  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION
      'VERIF 20260802093000: a 12B removeu tabela da 12A: %', v_faltando;
  END IF;

  SELECT count(*) INTO v_int
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'billing' AND c.relkind = 'r';
  IF v_int <> 14 THEN
    RAISE EXCEPTION 'VERIF 20260802093000: billing tem % tabela(s), esperadas 14', v_int;
  END IF;

  SELECT count(*) INTO v_int
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'billing' AND c.relkind = 'r' AND NOT c.relrowsecurity;
  IF v_int <> 0 THEN
    RAISE EXCEPTION 'VERIF 20260802093000: % tabela(s) sem RLS', v_int;
  END IF;

  SELECT count(*) INTO v_int
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'billing';
  IF v_int <> 0 THEN
    RAISE EXCEPTION 'VERIF 20260802093000: billing ganhou % policy(ies)', v_int;
  END IF;

  RAISE NOTICE 'VERIF 20260802093000 OK: 14 tabelas, RLS em todas, 0 policies';
END
$estrutura$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Idempotência com máquina de estados e fingerprint
-- ─────────────────────────────────────────────────────────────────────────────
--
-- É a correção central da revisão. Sem `status`, a reserva gravava o resultado
-- ANTES do efeito, e uma falha no meio prendia a chave com um resultado que
-- nunca aconteceu. Sem `request_fingerprint`, a mesma chave com outro pedido
-- devolvia o resultado do primeiro, em silêncio.

DO $idempotencia$
DECLARE
  v_faltando text;
BEGIN
  SELECT string_agg(t.esperada, ', ' ORDER BY t.esperada)
    INTO v_faltando
    FROM unnest(ARRAY['status', 'request_fingerprint', 'error_code',
                      'correlation_id', 'started_at', 'completed_at', 'failed_at'])
         AS t(esperada)
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'billing' AND table_name = 'idempotency_records'
        AND column_name = t.esperada
   );
  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION
      'VERIF 20260802093000: idempotency_records sem coluna(s): %', v_faltando;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'billing' AND t.typname = 'idempotency_state'
  ) THEN
    RAISE EXCEPTION 'VERIF 20260802093000: o tipo idempotency_state nao existe';
  END IF;

  -- Os três estados, e exatamente eles, nesta ordem.
  IF (SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder)
        FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE n.nspname = 'billing' AND t.typname = 'idempotency_state')
     <> ARRAY['in_progress', 'completed', 'failed'] THEN
    RAISE EXCEPTION 'VERIF 20260802093000: os rotulos de idempotency_state divergem';
  END IF;

  -- `request_fingerprint` NOT NULL: sem fingerprint não há como distinguir
  -- repetição de reuso de chave.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'billing' AND table_name = 'idempotency_records'
       AND column_name = 'request_fingerprint' AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'VERIF 20260802093000: request_fingerprint aceita nulo';
  END IF;

  -- Resultado só quando completou.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'idempotency_resultado_so_completo'
       AND conrelid = 'billing.idempotency_records'::regclass
  ) THEN
    RAISE EXCEPTION
      'VERIF 20260802093000: falta a constraint que impede resultado em registro nao completo';
  END IF;

  RAISE NOTICE 'VERIF 20260802093000 OK: idempotencia com estado, fingerprint e carimbos';
END
$idempotencia$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2.1 LEASE DA RESERVA
--
-- Verificador INDEPENDENTE: lê a definição instalada no banco, não o arquivo da
-- migration. Se alguém aplicar uma versão sem a lease — ou com a borda trocada
-- por `>` —, a reserva abandonada volta a travar a chave para sempre e a
-- reserva viva volta a poder ser roubada.
-- ─────────────────────────────────────────────────────────────────────────────

DO $lease$
DECLARE
  v_src text;
BEGIN
  SELECT pg_get_functiondef(
           to_regprocedure('public.fn_billing_claim_idempotency(uuid, uuid, text, text, text, text, text, timestamp with time zone)')
         ) INTO v_src;

  IF v_src IS NULL THEN
    RAISE EXCEPTION
      'VERIF 20260802093000: fn_billing_claim_idempotency ausente com a assinatura esperada';
  END IF;

  IF position('''5 minutes''' IN v_src) = 0 THEN
    RAISE EXCEPTION
      'VERIF 20260802093000: a lease de 5 minutos nao esta na funcao instalada';
  END IF;

  IF position('p_now < v_rec.started_at' IN v_src) = 0 THEN
    RAISE EXCEPTION
      'VERIF 20260802093000: a funcao instalada nao compara p_now com started_at — nao ha expiracao';
  END IF;

  IF position('FOR UPDATE' IN v_src) = 0 THEN
    RAISE EXCEPTION
      'VERIF 20260802093000: a funcao instalada perdeu o FOR UPDATE do registro de idempotencia';
  END IF;

  -- A duração NÃO pode ter virado parâmetro: lease enviada pelo cliente
  -- permitiria pedir zero e tomar uma reserva viva.
  IF EXISTS (
    SELECT 1
      FROM unnest(COALESCE(
             (SELECT p.proargnames FROM pg_proc p
               WHERE p.oid = to_regprocedure('public.fn_billing_claim_idempotency(uuid, uuid, text, text, text, text, text, timestamp with time zone)')),
             ARRAY[]::text[])) AS arg
     WHERE arg ILIKE '%lease%'
  ) THEN
    RAISE EXCEPTION
      'VERIF 20260802093000: a duracao da lease virou parametro — politica do servidor nao se negocia com o cliente';
  END IF;

  RAISE NOTICE 'VERIF 20260802093000 OK: lease de 5min na funcao instalada, com FOR UPDATE e sem parametro de duracao';
END
$lease$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Unicidades GLOBAIS e triggers de cobrança
-- ─────────────────────────────────────────────────────────────────────────────

DO $integridade$
DECLARE
  v_faltando text;
  v_cols     text;
BEGIN
  SELECT string_agg(t.esperada, ', ' ORDER BY t.esperada)
    INTO v_faltando
    FROM unnest(ARRAY['idempotency_chave_unica', 'charges_externo_unico',
                      'charges_comando_unico', 'customers_externo_unico',
                      'provider_events_unico'])
         AS t(esperada)
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_constraint WHERE conname = t.esperada AND contype = 'u'
   );
  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION 'VERIF 20260802093000: unicidade(s) ausente(s): %', v_faltando;
  END IF;

  -- A unicidade do identificador externo da cobrança NÃO pode conter
  -- `organization_id`: por tenant, o mesmo identificador do mesmo provider
  -- poderia existir em duas organizações, e um evento seria aplicável ao
  -- tenant errado.
  SELECT string_agg(a.attname, ',' ORDER BY a.attnum) INTO v_cols
    FROM pg_constraint c
    JOIN unnest(c.conkey) AS k(attnum) ON true
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
   WHERE c.conname = 'charges_externo_unico';
  IF v_cols LIKE '%organization_id%' THEN
    RAISE EXCEPTION
      'VERIF 20260802093000: charges_externo_unico voltou a ser por tenant (%)', v_cols;
  END IF;

  SELECT string_agg(a.attname, ',' ORDER BY a.attnum) INTO v_cols
    FROM pg_constraint c
    JOIN unnest(c.conkey) AS k(attnum) ON true
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
   WHERE c.conname = 'provider_events_unico';
  IF v_cols LIKE '%organization_id%' THEN
    RAISE EXCEPTION
      'VERIF 20260802093000: provider_events_unico inclui organization_id (%)', v_cols;
  END IF;

  -- As quatro triggers de integridade: duas da 12A, duas da 12B.
  SELECT string_agg(t.esperada, ', ' ORDER BY t.esperada)
    INTO v_faltando
    FROM unnest(ARRAY['tg_price_snapshot_immutable', 'tg_audit_events_append_only',
                      'tg_charges_immutable', 'tg_charges_transition'])
         AS t(esperada)
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'billing' AND NOT tg.tgisinternal AND tg.tgname = t.esperada
   );
  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION 'VERIF 20260802093000: trigger(s) ausente(s): %', v_faltando;
  END IF;

  RAISE NOTICE 'VERIF 20260802093000 OK: unicidades globais e 4 triggers de integridade';
END
$integridade$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. A porta única: nenhum privilégio direto, e as 16 RPCs alcançáveis
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Mudança de regime da 12B: o `service_role` deixa de alcançar `billing`
-- diretamente. Antes ele lia e escrevia nas tabelas e, como tem BYPASSRLS, o
-- filtro por organização no cliente era a única barreira entre tenants.

DO $porta$
DECLARE
  v_txt text;
  v_int integer;
BEGIN
  IF has_schema_privilege('service_role', 'billing', 'USAGE') THEN
    RAISE EXCEPTION 'VERIF 20260802093000: service_role ainda tem USAGE em billing';
  END IF;
  IF has_schema_privilege('anon', 'billing', 'USAGE')
     OR has_schema_privilege('authenticated', 'billing', 'USAGE') THEN
    RAISE EXCEPTION 'VERIF 20260802093000: papel do PostgREST tem USAGE em billing';
  END IF;

  SELECT string_agg(format('%s em %s', papel, c.relname), ', ' ORDER BY c.relname)
    INTO v_txt
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN unnest(ARRAY['anon', 'authenticated', 'service_role']) AS papel
   WHERE n.nspname = 'billing' AND c.relkind = 'r'
     AND has_table_privilege(papel, c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE');
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'VERIF 20260802093000: privilegio direto sobrevivente: %', v_txt;
  END IF;

  -- E as dezesseis DESTA migration existem e são executáveis pelo
  -- service_role — senão a aplicação ficaria sem porta nenhuma, que é o
  -- defeito que esta migration veio corrigir.
  --
  -- ── POR NOME, E NÃO POR TOTAL ─────────────────────────────────────────────
  --
  -- Este bloco exigia `count(*) = 16`. A 12C.1 acrescentou duas RPCs, e um
  -- total fixo passaria a reprovar a instalação CORRETA — o verificador da 12B
  -- roda contra um banco que já tem a 12C.1 aplicada.
  --
  -- A troca não afrouxa: exigir cada um dos dezesseis NOMES é mais forte do que
  -- exigir que eles sejam dezesseis, porque um total certo com um nome trocado
  -- passava antes e não passa agora. A TOTALIDADE — nenhuma RPC além das
  -- autorizadas — continua exigida, em `scripts/ci/assert-billing-rpcs.sql`,
  -- que roda no mesmo job e confere o conjunto EXATO por assinatura.
  SELECT string_agg(e, ', ' ORDER BY e) INTO v_txt
    FROM unnest(ARRAY[
      'fn_billing_read_state', 'fn_billing_read_catalog', 'fn_billing_read_ledger',
      'fn_billing_start_trial', 'fn_billing_change_plan',
      'fn_billing_schedule_downgrade', 'fn_billing_cancel_at_period_end',
      'fn_billing_transition_state', 'fn_billing_record_worker_count',
      'fn_billing_claim_idempotency', 'fn_billing_fail_idempotency',
      'fn_billing_finalize_checkout', 'fn_billing_apply_provider_event',
      'fn_billing_grant_courtesy', 'fn_billing_revoke_courtesy',
      'fn_billing_save_grandfathering'
    ]) AS e
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = e
        AND has_function_privilege('service_role', p.oid, 'EXECUTE')
   );
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION
      'VERIF 20260802093000: RPC(s) da 12B ausente(s) ou fora do alcance do service_role: %',
      v_txt;
  END IF;

  -- E nenhuma delas pode estar SOBRECARREGADA: duas versões do mesmo nome
  -- deixam o PostgREST escolher pela forma do corpo JSON.
  -- O `count(*)` precisa ficar numa subconsulta: agregar dentro de `string_agg`
  -- é aninhar agregação, e o PostgreSQL recusa com "aggregate function calls
  -- cannot be nested".
  SELECT string_agg(x.rotulo, ', ' ORDER BY x.rotulo) INTO v_txt
    FROM (
      SELECT format('%s (%s versoes)', p.proname, count(*)) AS rotulo
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_billing\_%'
       GROUP BY p.proname
      HAVING count(*) > 1
    ) x;
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'VERIF 20260802093000: RPC sobrecarregada: %', v_txt;
  END IF;

  SELECT count(*) INTO v_int
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_billing\_%'
     AND has_function_privilege('service_role', p.oid, 'EXECUTE');
  IF v_int < 16 THEN
    RAISE EXCEPTION
      'VERIF 20260802093000: service_role alcanca % RPC(s), menos que as 16 da 12B', v_int;
  END IF;

  SELECT string_agg(p.oid::regprocedure::text, ', ')
    INTO v_txt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN unnest(ARRAY['anon', 'authenticated']) AS papel
   WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_billing\_%'
     AND has_function_privilege(papel, p.oid, 'EXECUTE');
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'VERIF 20260802093000: anon/authenticated alcancam RPC: %', v_txt;
  END IF;

  RAISE NOTICE
    'VERIF 20260802093000 OK: billing fechado, as 16 RPCs da 12B alcancaveis so pelo service_role (total instalado: %)',
    v_int;
END
$porta$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Auditoria e ausência de objeto de billing em public
-- ─────────────────────────────────────────────────────────────────────────────

DO $resto$
DECLARE
  v_faltando text;
  v_int      integer;
BEGIN
  SELECT string_agg(t.esperada, ', ' ORDER BY t.esperada)
    INTO v_faltando
    FROM unnest(ARRAY['subscription_id', 'origin', 'idempotency_key', 'correlation_id'])
         AS t(esperada)
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'billing' AND table_name = 'audit_events'
        AND column_name = t.esperada
   );
  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION
      'VERIF 20260802093000: audit_events sem coluna(s): %', v_faltando;
  END IF;

  -- A exceção nominal vale SÓ para função: nenhuma tabela ou tipo em public.
  SELECT count(*) INTO v_int
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('customers', 'charges', 'idempotency_records',
                       'courtesy_revocations', 'provider_events');
  IF v_int <> 0 THEN
    RAISE EXCEPTION 'VERIF 20260802093000: % tabela(s) da 12B em public', v_int;
  END IF;

  SELECT count(*) INTO v_int
    FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
   WHERE n.nspname = 'public'
     AND t.typname IN ('charge_status', 'charge_method', 'idempotency_scope',
                       'idempotency_state');
  IF v_int <> 0 THEN
    RAISE EXCEPTION 'VERIF 20260802093000: % tipo(s) da 12B em public', v_int;
  END IF;

  RAISE NOTICE
    'VERIF 20260802093000 OK: auditoria completa, nenhuma tabela ou tipo em public';
END
$resto$;

ROLLBACK;
