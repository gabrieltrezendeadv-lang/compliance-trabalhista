-- =============================================================================
-- VERIFICAÇÃO INDEPENDENTE — 20260810120000_billing_contract_metadata
-- =============================================================================
--
-- Roda DEPOIS da aplicação e é independente das pós-condições da própria
-- migration: aquelas rodam dentro da transação que aplica, escritas pela mesma
-- pessoa e com as mesmas suposições. Quando a suposição está errada, erram
-- junto. Aqui se pergunta de outro jeito — `has_function_privilege`,
-- `pg_get_constraintdef`, `convalidated` — e se EXECUTA o que dá para executar
-- sem escrever.
--
-- SOMENTE LEITURA: `BEGIN TRANSACTION READ ONLY` … `ROLLBACK`. Nenhuma fixture.
-- Roda contra produção pela rota de aplicação, e não pode deixar rastro.
--
-- ── COMO SE PROVA RECUSA SEM PODER ESCREVER ─────────────────────────────────
--
-- A transação é READ ONLY, então uma RPC que CHEGUE a escrever falha com
-- `25006 read_only_sql_transaction`. Uma RPC que RECUSE antes de escrever falha
-- com o código do domínio — `22023` para entrada inválida, `42501` para
-- autorização. Os dois códigos são diferentes, e cada asserção abaixo exige o
-- código exato.
--
-- Isso torna a leitura uma prova de verdade: se alguém apagar a exigência de
-- aceite, a chamada deixa de parar em `22023` e passa a bater em `25006` — e a
-- asserção reprova, dizendo qual código veio.
--
-- ── O QUE NÃO SE PROVA AQUI, E ONDE SE PROVA ────────────────────────────────
--
-- Recusa a MEMBRO COMUM (não-owner) e rejeição efetiva dos CHECKs por INSERT
-- exigem fixture — organização, membro com papel, linha gravada. Isso não cabe
-- numa verificação somente-leitura contra produção, e está em
-- `scripts/ci/assert-billing-orchestration.sql`, que roda na stack descartável
-- com fixtures reais, e no contrato memória × PostgREST.
--
-- Aqui se prova a metade que não depende de fixture: o TEXTO instalado das
-- constraints, a ORDEM instalada das RPCs (autorização antes de tudo, aceite
-- antes de qualquer escrita) e as recusas que independem de quem chama.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN TRANSACTION READ ONLY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. As três colunas: existência, tipo e NULIDADE
-- ─────────────────────────────────────────────────────────────────────────────

DO $colunas$
DECLARE
  v_txt text;
  v_int integer;
BEGIN
  SELECT string_agg(e, ', ' ORDER BY e) INTO v_txt
    FROM unnest(ARRAY['billing_email', 'terms_version', 'terms_accepted_at']) AS e
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'billing' AND c.table_name = 'subscriptions'
        AND c.column_name = e
   );
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'VERIF 20260810120000: coluna ausente: %', v_txt;
  END IF;

  SELECT string_agg(format('%s=%s', c.column_name, c.data_type), ', ')
    INTO v_txt
    FROM information_schema.columns c
   WHERE c.table_schema = 'billing' AND c.table_name = 'subscriptions'
     AND ((c.column_name IN ('billing_email', 'terms_version') AND c.data_type <> 'text')
       OR (c.column_name = 'terms_accepted_at' AND c.data_type <> 'timestamp with time zone'));
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'VERIF 20260810120000: tipo divergente: %', v_txt;
  END IF;

  -- NULIDADE É REQUISITO, não descuido. Linha anterior à 12C.1 não tem aceite,
  -- e `NOT NULL` aqui obrigaria a inventar um — falsificando prova contratual.
  SELECT count(*) INTO v_int
    FROM information_schema.columns c
   WHERE c.table_schema = 'billing' AND c.table_name = 'subscriptions'
     AND c.column_name IN ('billing_email', 'terms_version', 'terms_accepted_at')
     AND c.is_nullable = 'YES';
  IF v_int <> 3 THEN
    RAISE EXCEPTION
      'VERIF 20260810120000: apenas % das 3 colunas contratuais aceitam NULL', v_int;
  END IF;

  RAISE NOTICE 'VERIF 20260810120000 OK: 3 colunas contratuais, tipadas e anulaveis';
END
$colunas$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. As três constraints, pelo TEXTO instalado — e VALIDADAS
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `convalidated` é o que prova a compatibilidade com linhas preexistentes: o
-- PostgreSQL só marca a constraint validada depois de conferi-la contra TODAS
-- as linhas da tabela. Uma constraint acrescentada com `NOT VALID` passaria a
-- existir sem nunca ter olhado o que já estava lá.

DO $constraints$
DECLARE
  v_txt text;
  v_def text;
BEGIN
  SELECT string_agg(e, ', ' ORDER BY e) INTO v_txt
    FROM unnest(ARRAY[
      'subscriptions_termos_par_completo',
      'subscriptions_termos_versao_valida',
      'subscriptions_billing_email_valido'
    ]) AS e
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'billing' AND t.relname = 'subscriptions'
        AND c.conname = e AND c.contype = 'c' AND c.convalidated
   );
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION
      'VERIF 20260810120000: CHECK ausente ou nao validado: %', v_txt;
  END IF;

  -- PAR COMPLETO. O texto tem de comparar as DUAS colunas por igualdade de
  -- nulidade — que é a única forma de "os dois ou nenhum".
  SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'billing' AND t.relname = 'subscriptions'
     AND c.conname = 'subscriptions_termos_par_completo';
  IF v_def !~ 'terms_version IS NULL' OR v_def !~ 'terms_accepted_at IS NULL'
     OR v_def !~ '=' THEN
    RAISE EXCEPTION
      'VERIF 20260810120000: par termos/instante nao e mais casado: %', v_def;
  END IF;

  -- VERSÃO. Formato de data, que é o que sustenta a comparação lexical usada
  -- para proibir regressão de versão.
  SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'billing' AND t.relname = 'subscriptions'
     AND c.conname = 'subscriptions_termos_versao_valida';
  IF v_def !~ '\[0-9\]\{4\}' OR v_def !~ 'terms_version' THEN
    RAISE EXCEPTION
      'VERIF 20260810120000: versao de termos sem exigencia de formato: %', v_def;
  END IF;

  -- E-MAIL. Limite de tamanho seguro e forma mínima.
  SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'billing' AND t.relname = 'subscriptions'
     AND c.conname = 'subscriptions_billing_email_valido';
  IF v_def !~ '254' THEN
    RAISE EXCEPTION
      'VERIF 20260810120000: e-mail financeiro sem limite de tamanho: %', v_def;
  END IF;
  IF v_def !~ '@' THEN
    RAISE EXCEPTION
      'VERIF 20260810120000: e-mail financeiro sem exigencia de forma: %', v_def;
  END IF;

  RAISE NOTICE
    'VERIF 20260810120000 OK: 3 CHECKs instalados e validados contra as linhas existentes';
END
$constraints$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Linhas preexistentes continuam válidas
-- ─────────────────────────────────────────────────────────────────────────────

DO $preexistentes$
DECLARE
  v_total    integer;
  v_sem      integer;
  v_quebrado integer;
BEGIN
  SELECT count(*) INTO v_total FROM billing.subscriptions;
  SELECT count(*) INTO v_sem   FROM billing.subscriptions
   WHERE terms_version IS NULL AND terms_accepted_at IS NULL;

  -- Desemparelhamento não pode existir NEM nas linhas antigas. Se existir, o
  -- CHECK foi acrescentado sem validar, e a seção 2 já teria reprovado — esta
  -- é a conferência pelo outro lado, olhando o dado e não o catálogo.
  SELECT count(*) INTO v_quebrado FROM billing.subscriptions
   WHERE (terms_version IS NULL) <> (terms_accepted_at IS NULL);
  IF v_quebrado > 0 THEN
    RAISE EXCEPTION
      'VERIF 20260810120000: % assinatura(s) com termos desemparelhados', v_quebrado;
  END IF;

  RAISE NOTICE
    'VERIF 20260810120000 OK: % assinatura(s), % sem aceite — nulidade preservada',
    v_total, v_sem;
END
$preexistentes$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Regras de versão e de e-mail, EXECUTADAS
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Os auxiliares são chamados diretamente porque este script roda como dono do
-- schema, não como `service_role`. É o caminho que as três RPCs percorrem, e
-- exercitá-lo aqui prova a regra sem precisar de fixture.

DO $regras$
DECLARE
  v_estado text;
  v_saida  text;
BEGIN
  -- 4.1 Versão vazia, só espaços e malformada: TODAS recusadas. `NULL` fica
  -- fora do laço e é conferido logo abaixo, em separado.
  FOR v_saida IN
    SELECT e FROM unnest(ARRAY['', '   ', 'inventada', '10-08-2026',
                               '2026-8-10', '2026-08-10 ok']::text[]) AS e
  LOOP
    BEGIN
      PERFORM billing.fn_require_terms_version(v_saida);
      v_estado := 'ACEITOU';
    EXCEPTION WHEN OTHERS THEN
      v_estado := SQLSTATE;
    END;
    IF v_estado <> '22023' THEN
      RAISE EXCEPTION
        'VERIF 20260810120000: versao [%] deveria ser recusada com 22023, veio %',
        coalesce(v_saida, 'NULO'), v_estado;
    END IF;
  END LOOP;

  -- Ausência total da versão — o caso do cliente que simplesmente não manda o
  -- campo — recusada com o MESMO código das malformadas.
  BEGIN
    PERFORM billing.fn_require_terms_version(NULL);
    v_estado := 'ACEITOU';
  EXCEPTION WHEN OTHERS THEN
    v_estado := SQLSTATE;
  END;
  IF v_estado <> '22023' THEN
    RAISE EXCEPTION
      'VERIF 20260810120000: versao NULA deveria ser recusada com 22023, veio %', v_estado;
  END IF;

  -- 4.2 Versão bem formada passa, e volta sem espaços nas pontas.
  SELECT billing.fn_require_terms_version('  2026-08-10  ') INTO v_saida;
  IF v_saida <> '2026-08-10' THEN
    RAISE EXCEPTION
      'VERIF 20260810120000: versao valida deveria voltar normalizada, veio [%]', v_saida;
  END IF;

  -- 4.3 E-mail vazio vira NULL — determinístico, e é a regra declarada.
  SELECT billing.fn_normalize_email('   ') INTO v_saida;
  IF v_saida IS NOT NULL THEN
    RAISE EXCEPTION
      'VERIF 20260810120000: e-mail so com espacos deveria virar NULL, veio [%]', v_saida;
  END IF;
  SELECT billing.fn_normalize_email('') INTO v_saida;
  IF v_saida IS NOT NULL THEN
    RAISE EXCEPTION 'VERIF 20260810120000: e-mail vazio deveria virar NULL';
  END IF;
  SELECT billing.fn_normalize_email(NULL) INTO v_saida;
  IF v_saida IS NOT NULL THEN
    RAISE EXCEPTION 'VERIF 20260810120000: e-mail nulo deveria continuar NULL';
  END IF;
  SELECT billing.fn_normalize_email('  financeiro@empresa.com.br  ') INTO v_saida;
  IF v_saida <> 'financeiro@empresa.com.br' THEN
    RAISE EXCEPTION
      'VERIF 20260810120000: e-mail deveria voltar sem espacos, veio [%]', v_saida;
  END IF;

  -- 4.4 E-mail malformado é recusado, e a recusa NÃO reproduz o endereço.
  --
  -- Deixar o CHECK recusar também funcionaria, mas a mensagem dele traz
  -- `Failing row contains (...)` — a linha inteira, endereço incluído — e
  -- essa mensagem vai para log.
  FOR v_saida IN
    SELECT e FROM unnest(ARRAY['nao-e-um-email', 'sem arroba.com',
                               'com espaco@empresa.com.br',
                               'sem-ponto@empresa']::text[]) AS e
  LOOP
    BEGIN
      PERFORM billing.fn_require_email(v_saida);
      v_estado := 'ACEITOU';
    EXCEPTION WHEN OTHERS THEN
      v_estado := SQLSTATE;
      IF SQLERRM LIKE '%' || v_saida || '%' THEN
        RAISE EXCEPTION
          'VERIF 20260810120000: a recusa reproduz o endereco recebido: %', SQLERRM;
      END IF;
    END;
    IF v_estado <> '22023' THEN
      RAISE EXCEPTION
        'VERIF 20260810120000: e-mail [%] deveria ser recusado com 22023, veio %',
        v_saida, v_estado;
    END IF;
  END LOOP;

  SELECT billing.fn_require_email('  financeiro@empresa.com.br  ') INTO v_saida;
  IF v_saida <> 'financeiro@empresa.com.br' THEN
    RAISE EXCEPTION
      'VERIF 20260810120000: e-mail valido deveria passar normalizado, veio [%]', v_saida;
  END IF;

  -- 4.5 A máscara não devolve o endereço.
  SELECT billing.fn_mask_email('financeiro@empresa.com.br') INTO v_saida;
  IF v_saida <> 'f***@empresa.com.br' THEN
    RAISE EXCEPTION
      'VERIF 20260810120000: mascara inesperada: [%]', v_saida;
  END IF;
  IF v_saida ~ 'financeiro' THEN
    RAISE EXCEPTION
      'VERIF 20260810120000: a mascara devolveu a parte local do endereco';
  END IF;

  RAISE NOTICE
    'VERIF 20260810120000 OK: versao e e-mail malformados recusados sem reproduzir o valor, mascara sem endereco';
END
$regras$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Trial sem termos é RECUSADO, e autorização vem antes
-- ─────────────────────────────────────────────────────────────────────────────

DO $trial$
DECLARE
  v_estado text;
  v_msg_a  text;
  v_msg_b  text;
  v_estado_a text;
  v_estado_b text;
  v_org    uuid;
  v_modo   text;
BEGIN
  -- 5.1 Ator desconhecido: RECUSA DE AUTORIZAÇÃO, e ela vem ANTES de qualquer
  -- validação de conteúdo. Se viesse depois, este caso responderia 22023.
  BEGIN
    PERFORM public.fn_billing_start_trial(
      gen_random_uuid(), gen_random_uuid(), 'essencial', 'ate_50', 'monthly',
      10, '00.000.000/0001-00', now(), now() + interval '30 days',
      now() + interval '7 days', 9900, 'v1', 'verif-12c1',
      NULL, '2026-08-10', now()
    );
    v_estado := 'ACEITOU';
  EXCEPTION WHEN OTHERS THEN
    v_estado := SQLSTATE;
  END;
  IF v_estado <> '42501' THEN
    RAISE EXCEPTION
      'VERIF 20260810120000: trial de ator desconhecido deveria dar 42501, veio %', v_estado;
  END IF;

  -- 5.2 Organização ALHEIA e organização INEXISTENTE: mesma recusa, mesma
  -- mensagem. Distingui-las entregaria "esta organizacao existe" a quem varre
  -- identificadores.
  SELECT o.id INTO v_org FROM public.organizations o LIMIT 1;
  v_modo := CASE WHEN v_org IS NULL THEN 'duas inexistentes' ELSE 'alheia x inexistente' END;

  BEGIN
    PERFORM public.fn_billing_update_billing_email(
      gen_random_uuid(), coalesce(v_org, gen_random_uuid()),
      'financeiro@empresa.com.br', now(), 'verif-12c1');
    v_estado_a := 'ACEITOU';
  EXCEPTION WHEN OTHERS THEN
    v_estado_a := SQLSTATE; v_msg_a := SQLERRM;
  END;

  BEGIN
    PERFORM public.fn_billing_update_billing_email(
      gen_random_uuid(), gen_random_uuid(),
      'financeiro@empresa.com.br', now(), 'verif-12c1');
    v_estado_b := 'ACEITOU';
  EXCEPTION WHEN OTHERS THEN
    v_estado_b := SQLSTATE; v_msg_b := SQLERRM;
  END;

  IF v_estado_a <> '42501' OR v_estado_b <> '42501' THEN
    RAISE EXCEPTION
      'VERIF 20260810120000: e-mail sem autorizacao deveria dar 42501, veio % e %',
      v_estado_a, v_estado_b;
  END IF;
  IF v_msg_a IS DISTINCT FROM v_msg_b THEN
    RAISE EXCEPTION
      'VERIF 20260810120000: recusas DISTINGUIVEIS entre organizacoes: [%] vs [%]',
      v_msg_a, v_msg_b;
  END IF;

  -- 5.3 O mesmo para o aceite.
  BEGIN
    PERFORM public.fn_billing_accept_terms(
      gen_random_uuid(), coalesce(v_org, gen_random_uuid()),
      '2026-08-10', now(), 'verif-12c1');
    v_estado_a := 'ACEITOU';
  EXCEPTION WHEN OTHERS THEN
    v_estado_a := SQLSTATE; v_msg_a := SQLERRM;
  END;
  BEGIN
    PERFORM public.fn_billing_accept_terms(
      gen_random_uuid(), gen_random_uuid(),
      '2026-08-10', now(), 'verif-12c1');
    v_estado_b := 'ACEITOU';
  EXCEPTION WHEN OTHERS THEN
    v_estado_b := SQLSTATE; v_msg_b := SQLERRM;
  END;
  IF v_estado_a <> '42501' OR v_estado_b <> '42501' THEN
    RAISE EXCEPTION
      'VERIF 20260810120000: aceite sem autorizacao deveria dar 42501, veio % e %',
      v_estado_a, v_estado_b;
  END IF;
  IF v_msg_a IS DISTINCT FROM v_msg_b THEN
    RAISE EXCEPTION
      'VERIF 20260810120000: recusas de aceite DISTINGUIVEIS: [%] vs [%]', v_msg_a, v_msg_b;
  END IF;

  RAISE NOTICE
    'VERIF 20260810120000 OK: autorizacao antes de tudo, recusa indistinguivel (modo: %)', v_modo;
END
$trial$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. A ORDEM instalada: autorização → aceite → escrita
-- ─────────────────────────────────────────────────────────────────────────────
--
-- A seção 5 não alcança "trial de um OWNER sem termos" porque isso exige
-- fixture. Esta seção fecha a lacuna pelo outro lado: lê o corpo INSTALADO e
-- exige que a exigência de aceite esteja entre a autorização e o INSERT.
--
-- Ler o corpo instalado, e não o arquivo, é o ponto: pega o hotfix aplicado
-- direto no banco que o repositório nunca viu.

DO $ordem$
DECLARE
  v_def   text;
  p_auth  integer;
  p_terms integer;
  p_write integer;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fn_billing_start_trial';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'VERIF 20260810120000: fn_billing_start_trial nao instalada';
  END IF;

  p_auth  := position('fn_require_member' in v_def);
  p_terms := position('fn_require_terms_version' in v_def);
  -- A lista de colunas do INSERT identifica a escrita sem que este arquivo
  -- precise conter o comando: `billing.subscriptions (` só aparece ali, e
  -- `scripts/ci/assert-billing-orchestration.sql` prova o resto por execução.
  p_write := position('billing.subscriptions (' in v_def);

  IF p_auth = 0 THEN
    RAISE EXCEPTION 'VERIF 20260810120000: start_trial instalada nao autoriza';
  END IF;
  IF p_terms = 0 THEN
    RAISE EXCEPTION
      'VERIF 20260810120000: start_trial instalada nao exige aceite dos termos';
  END IF;
  IF p_write = 0 THEN
    RAISE EXCEPTION 'VERIF 20260810120000: start_trial instalada nao grava assinatura';
  END IF;
  IF NOT (p_auth < p_terms AND p_terms < p_write) THEN
    RAISE EXCEPTION
      'VERIF 20260810120000: ordem errada em start_trial — autorizacao %, aceite %, escrita %',
      p_auth, p_terms, p_write;
  END IF;

  -- E o aceite é auditado NA MESMA função, logo na mesma transação.
  IF position('terms_acceptance' in v_def) = 0 THEN
    RAISE EXCEPTION
      'VERIF 20260810120000: start_trial instalada nao audita o aceite';
  END IF;
  IF position('terms_acceptance' in v_def) < p_write THEN
    RAISE EXCEPTION
      'VERIF 20260810120000: start_trial audita o aceite ANTES de gravar a assinatura';
  END IF;

  -- E-MAIL: owner exigido, e auditoria mascarada.
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fn_billing_update_billing_email';

  p_auth  := position('fn_require_member' in v_def);
  p_write := position('UPDATE billing.subscriptions' in v_def);
  IF p_auth = 0 OR p_write = 0 OR p_auth > p_write THEN
    RAISE EXCEPTION
      'VERIF 20260810120000: update_billing_email nao autoriza antes de escrever';
  END IF;
  IF v_def !~ 'fn_require_member\s*\([^)]*true' THEN
    RAISE EXCEPTION
      'VERIF 20260810120000: update_billing_email nao exige OWNER';
  END IF;
  IF position('fn_mask_email' in v_def) = 0 THEN
    RAISE EXCEPTION
      'VERIF 20260810120000: update_billing_email auditaria o endereco sem mascara';
  END IF;
  -- O e-mail cru NÃO pode ir para a trilha: nenhuma chamada a `fn_audit` desta
  -- função pode carregar a variável do endereço fora da máscara.
  IF v_def ~ 'jsonb_build_object\([^)]*''email''' THEN
    RAISE EXCEPTION
      'VERIF 20260810120000: update_billing_email grava o endereco na auditoria';
  END IF;

  -- ACEITE: owner exigido, e regressão de versão proibida.
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fn_billing_accept_terms';

  IF v_def !~ 'fn_require_member\s*\([^)]*true' THEN
    RAISE EXCEPTION 'VERIF 20260810120000: accept_terms nao exige OWNER';
  END IF;
  IF position('fn_require_terms_version' in v_def) = 0 THEN
    RAISE EXCEPTION 'VERIF 20260810120000: accept_terms nao valida a versao';
  END IF;
  IF v_def !~ 'v_versao\s*<\s*v_antes' THEN
    RAISE EXCEPTION
      'VERIF 20260810120000: accept_terms nao proibe regredir para versao anterior';
  END IF;
  IF position('terms_acceptance' in v_def) = 0 THEN
    RAISE EXCEPTION 'VERIF 20260810120000: accept_terms nao audita o aceite';
  END IF;

  RAISE NOTICE
    'VERIF 20260810120000 OK: ordem instalada autoriza, exige aceite e so entao grava';
END
$ordem$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Conjunto EXATO das 18 RPCs, ACL e owner
-- ─────────────────────────────────────────────────────────────────────────────

DO $rpcs$
DECLARE
  v_esperadas text[] := ARRAY[
    'public.fn_billing_read_state(uuid, uuid)',
    'public.fn_billing_read_catalog(uuid, uuid, text)',
    'public.fn_billing_read_ledger(uuid, uuid)',
    'public.fn_billing_start_trial(uuid, uuid, text, text, text, integer, text, timestamp with time zone, timestamp with time zone, timestamp with time zone, integer, text, text, text, text, timestamp with time zone)',
    'public.fn_billing_change_plan(uuid, uuid, text, text, text, text, timestamp with time zone, timestamp with time zone, integer, text, text, text, text, text, timestamp with time zone)',
    'public.fn_billing_schedule_downgrade(uuid, uuid, text, text, text, text, timestamp with time zone)',
    'public.fn_billing_cancel_at_period_end(uuid, uuid, text, text, timestamp with time zone)',
    'public.fn_billing_transition_state(uuid, uuid, text, text, text, text, timestamp with time zone)',
    'public.fn_billing_record_worker_count(uuid, uuid, integer, text, timestamp with time zone)',
    'public.fn_billing_claim_idempotency(uuid, uuid, text, text, text, text, text, timestamp with time zone)',
    'public.fn_billing_fail_idempotency(uuid, uuid, text, text, text, text, text, timestamp with time zone)',
    'public.fn_billing_finalize_checkout(uuid, uuid, text, text, text, text, text, integer, timestamp with time zone, timestamp with time zone, text, text, text, timestamp with time zone)',
    'public.fn_billing_apply_provider_event(text, text, text, text, text, timestamp with time zone, text, timestamp with time zone)',
    'public.fn_billing_grant_courtesy(uuid, uuid, text, timestamp with time zone, timestamp with time zone, text, text)',
    'public.fn_billing_revoke_courtesy(uuid, uuid, uuid, timestamp with time zone, text, text)',
    'public.fn_billing_save_grandfathering(uuid, uuid, timestamp with time zone, timestamp with time zone, text)',
    'public.fn_billing_update_billing_email(uuid, uuid, text, timestamp with time zone, text)',
    'public.fn_billing_accept_terms(uuid, uuid, text, timestamp with time zone, text)'
  ];
  v_txt   text;
  v_int   integer;
  v_owner oid;
BEGIN
  IF array_length(v_esperadas, 1) <> 18 THEN
    RAISE EXCEPTION
      'VERIF 20260810120000: a lista deste verificador tem % entradas, deveria ter 18',
      array_length(v_esperadas, 1);
  END IF;

  -- AUSENTE ou com assinatura diferente.
  SELECT string_agg(e, ', ' ORDER BY e) INTO v_txt
    FROM unnest(v_esperadas) AS e
   WHERE to_regprocedure(e) IS NULL;
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'VERIF 20260810120000: RPC ausente ou sobrecarregada: %', v_txt;
  END IF;

  -- EXTRA. Uma função de billing em `public` fora desta lista é exceção que
  -- ninguem revisou.
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_txt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_billing\_%'
     AND NOT (p.oid = ANY(SELECT to_regprocedure(e)::oid FROM unnest(v_esperadas) AS e));
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'VERIF 20260810120000: RPC nao autorizada em public: %', v_txt;
  END IF;

  -- SOBRECARGA da assinatura antiga de start_trial.
  IF to_regprocedure(
       'public.fn_billing_start_trial(uuid, uuid, text, text, text, integer, text, '
       'timestamp with time zone, timestamp with time zone, timestamp with time zone, '
       'integer, text, text)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION
      'VERIF 20260810120000: a assinatura ANTIGA de start_trial ainda existe';
  END IF;

  SELECT count(*) INTO v_int
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_billing\_%';
  IF v_int <> 18 THEN
    RAISE EXCEPTION 'VERIF 20260810120000: % RPCs em public, esperadas 18', v_int;
  END IF;

  -- SECURITY DEFINER, search_path vazio, mesmo owner do schema.
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_txt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_billing\_%'
     AND (NOT p.prosecdef
          OR NOT EXISTS (
               SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) AS cfg
                -- As DUAS formas: o catalogo grava search_path= em algumas
                -- versoes e search_path="" em outras. Aceitar so uma
                -- reprovaria instalacao correta.
                WHERE cfg IN ('search_path=', 'search_path=""')
             ));
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION
      'VERIF 20260810120000: sem SECURITY DEFINER ou sem search_path vazio: %', v_txt;
  END IF;

  -- MESMA fonte de owner que a 12B usa: o dono da TABELA. Comparar contra
  -- outra fonte reprovaria por diferenca que nao e defeito.
  SELECT c.relowner INTO v_owner FROM pg_class c WHERE c.oid = 'billing.subscriptions'::regclass;
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_txt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_billing\_%'
     AND p.proowner <> v_owner;
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'VERIF 20260810120000: owner divergente: %', v_txt;
  END IF;

  -- ACL: só `service_role`.
  SELECT string_agg(format('%s para %s', p.oid::regprocedure::text, papel), ', ')
    INTO v_txt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN unnest(ARRAY['anon', 'authenticated']) AS papel
   WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_billing\_%'
     AND has_function_privilege(papel, p.oid, 'EXECUTE');
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'VERIF 20260810120000: EXECUTE para anon/authenticated: %', v_txt;
  END IF;

  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_txt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_billing\_%'
     AND EXISTS (
       SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
     );
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'VERIF 20260810120000: EXECUTE para PUBLIC: %', v_txt;
  END IF;

  SELECT count(*) INTO v_int
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_billing\_%'
     AND has_function_privilege('service_role', p.oid, 'EXECUTE');
  IF v_int <> 18 THEN
    RAISE EXCEPTION
      'VERIF 20260810120000: service_role alcanca % RPC(s), esperadas 18', v_int;
  END IF;

  RAISE NOTICE
    'VERIF 20260810120000 OK: 18 RPCs exatas, SECURITY DEFINER, so service_role';
END
$rpcs$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Ausência de escrita direta, schema fechado, nada indevido em `public`
-- ─────────────────────────────────────────────────────────────────────────────

DO $fechado$
DECLARE
  v_txt text;
BEGIN
  IF has_schema_privilege('service_role', 'billing', 'USAGE')
     OR has_schema_privilege('anon', 'billing', 'USAGE')
     OR has_schema_privilege('authenticated', 'billing', 'USAGE') THEN
    RAISE EXCEPTION 'VERIF 20260810120000: papel do PostgREST tem USAGE em billing';
  END IF;

  -- NENHUMA ESCRITA DIRETA. As colunas contratuais só se alcançam pelas RPCs;
  -- um INSERT/UPDATE do `service_role` em `billing.subscriptions` contornaria
  -- a exigência de aceite inteirinha.
  SELECT string_agg(format('%s em %s', papel, c.relname), ', ' ORDER BY c.relname)
    INTO v_txt
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN unnest(ARRAY['anon', 'authenticated', 'service_role']) AS papel
   WHERE n.nspname = 'billing' AND c.relkind = 'r'
     AND has_table_privilege(papel, c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE');
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'VERIF 20260810120000: privilegio direto sobrevivente: %', v_txt;
  END IF;

  -- Os auxiliares novos continuam inalcançáveis.
  SELECT string_agg(format('%s para %s', p.oid::regprocedure::text, papel), ', ')
    INTO v_txt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN unnest(ARRAY['anon', 'authenticated', 'service_role']) AS papel
   WHERE n.nspname = 'billing'
     AND has_function_privilege(papel, p.oid, 'EXECUTE');
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'VERIF 20260810120000: auxiliar de billing alcancavel: %', v_txt;
  END IF;

  -- NENHUM objeto de billing em `public`. A exceção nominal vale só para
  -- FUNÇÃO, e continua valendo.
  --
  -- ── POR QUE LISTA FECHADA, E NÃO `LIKE '%billing%'` ──────────────────────
  --
  -- A primeira versão desta asserção varria por substring e reprovava a
  -- instalação CORRETA: `public.billing_events` é uma das cinco tabelas
  -- LEGADAS que a 12C.0 preservou de propósito, e os índices dela também casam.
  -- O prefixo das tabelas velhas e o nome do schema novo coincidem — varredura
  -- por substring não distingue os dois, e nunca teve como distinguir.
  --
  -- A pergunta certa é nominal: nenhum objeto DESTAS migrations pode ter
  -- nascido em `public`.
  SELECT string_agg(format('%s.%s', n.nspname, c.relname), ', ') INTO v_txt
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN (
       -- 12A
       'tiers', 'price_catalog', 'subscriptions', 'price_snapshots',
       'grandfathering_cutoff', 'grandfathered_organizations', 'courtesies',
       'audit_events', 'legacy_plan_state',
       -- 12B
       'customers', 'charges', 'idempotency_records', 'courtesy_revocations',
       'provider_events',
       -- 12C.1: se alguém trocar as colunas por uma tabela própria, ela cai aqui
       'terms_acceptances', 'billing_contacts'
     );
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'VERIF 20260810120000: relacao de billing em public: %', v_txt;
  END IF;

  SELECT string_agg(t.typname, ', ') INTO v_txt
    FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
   WHERE n.nspname = 'public'
     AND t.typname IN (
       'plan_slug', 'tier_slug', 'billing_period', 'subscription_state',
       'audit_subject', 'charge_status', 'charge_method',
       'idempotency_scope', 'idempotency_state'
     );
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'VERIF 20260810120000: tipo de billing em public: %', v_txt;
  END IF;

  RAISE NOTICE
    'VERIF 20260810120000 OK: billing fechado, sem escrita direta, nada indevido em public';
END
$fechado$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. A auditoria comporta ator, organização, versão e instante
-- ─────────────────────────────────────────────────────────────────────────────

DO $auditoria$
DECLARE
  v_txt text;
BEGIN
  SELECT string_agg(e, ', ' ORDER BY e) INTO v_txt
    FROM unnest(ARRAY['organization_id', 'subscription_id', 'subject', 'actor_id',
                      'origin', 'occurred_at', 'new_value', 'correlation_id']) AS e
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'billing' AND c.table_name = 'audit_events'
        AND c.column_name = e
   );
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION
      'VERIF 20260810120000: audit_events nao comporta o aceite — falta: %', v_txt;
  END IF;

  SELECT string_agg(e, ', ' ORDER BY e) INTO v_txt
    FROM unnest(ARRAY['terms_acceptance', 'billing_email']) AS e
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_enum en
       JOIN pg_type t ON t.oid = en.enumtypid
       JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'billing' AND t.typname = 'audit_subject'
        AND en.enumlabel = e
   );
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION
      'VERIF 20260810120000: assunto de auditoria ausente no enum: %', v_txt;
  END IF;

  -- APPEND-ONLY por regime de privilégio: ninguém tem UPDATE nem DELETE.
  SELECT string_agg(format('%s pode %s', papel, acao), ', ') INTO v_txt
    FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS papel
    CROSS JOIN unnest(ARRAY['UPDATE', 'DELETE', 'TRUNCATE']) AS acao
   WHERE has_table_privilege(papel, 'billing.audit_events', acao);
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION
      'VERIF 20260810120000: trilha de auditoria NAO e append-only: %', v_txt;
  END IF;

  -- Nenhum evento de contato financeiro pode carregar o endereco inteiro. A
  -- máscara sempre tem `***@`; um `@` sem máscara é endereço cru na trilha.
  SELECT count(*)::text INTO v_txt
    FROM billing.audit_events ae
   WHERE ae.subject::text = 'billing_email'
     AND (ae.new_value::text ~ '@' AND ae.new_value::text !~ '\*\*\*@');
  IF v_txt <> '0' THEN
    RAISE EXCEPTION
      'VERIF 20260810120000: % evento(s) de contato com endereco sem mascara', v_txt;
  END IF;

  RAISE NOTICE
    'VERIF 20260810120000 OK: auditoria append-only, com ator, organizacao, versao e instante';
END
$auditoria$;

ROLLBACK;
