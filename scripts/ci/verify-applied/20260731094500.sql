-- =============================================================================
-- VERIFICAÇÃO INDEPENDENTE — 20260731094500_make_tenant_resolution_deterministic
-- =============================================================================
--
-- Roda DEPOIS da aplicação, contra o banco de produção, e é INDEPENDENTE das
-- pós-condições embutidas na migration. Ver o cabeçalho de
-- `20260730123613.sql` para o porquê de o segundo par de olhos existir.
--
-- ── O QUE NÃO É FEITO AQUI, E POR QUÊ ───────────────────────────────────────
--
-- Os NOVE testes de comportamento da resolução de tenant (T1–T9) criam usuários,
-- organizações e memberships de mentira. Eles provam o que o catálogo não prova:
-- que a função DEVOLVE a linha certa. E é exatamente por isso que **não rodam
-- aqui**: fabricar dados em produção — ainda que dentro de uma transação — faz
-- disparar gatilhos reais (`on_auth_user_created` escreve em `public.profiles`),
-- consome sequências, e um `ROLLBACK` esquecido ou uma falha de conexão no
-- momento errado deixaria lixo em `auth.users`. O ganho não paga o risco.
--
-- T1–T9 vivem em `scripts/ci/assert-tenant-resolution.sql` e rodam contra o
-- banco DESCARTÁVEL do `migration-rebuild-verify`, onde inventar dados não custa
-- nada. Lá eles já passaram (run 30556763063).
--
-- O que se afirma a partir de produção é o que o catálogo sustenta: a definição
-- da função, suas propriedades, sua ACL e suas dependências. Nada além disso.
--
-- Somente leitura, somente catálogo, `BEGIN TRANSACTION READ ONLY` + `ROLLBACK`.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN TRANSACTION READ ONLY;

DO $verif$
DECLARE
  v_def       text;
  v_owner     text;
  v_secdef    boolean;
  v_volatile  "char";
  v_lang      text;
  v_rettype   text;
  v_config    text;
  v_policies  integer;
  v_public    integer;
  v_anon      integer;
  v_auth      integer;
  v_service   integer;
BEGIN
  SELECT pg_get_functiondef(p.oid),
         pg_get_userbyid(p.proowner),
         p.prosecdef,
         p.provolatile,
         l.lanname,
         pg_get_function_result(p.oid),
         COALESCE(array_to_string(p.proconfig, ','), '<NULO>')
    INTO v_def, v_owner, v_secdef, v_volatile, v_lang, v_rettype, v_config
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l  ON l.oid = p.prolang
   WHERE n.nspname = 'public' AND p.proname = 'fn_resolve_tenant_id';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'VERIF 20260731094500: fn_resolve_tenant_id não existe em public';
  END IF;

  -- 1. O efeito pretendido: ordenação TOTAL.
  --
  -- `\y` é a fronteira de palavra na regex do PostgreSQL. `\b` NÃO é — na ARE
  -- do POSIX é o caractere backspace, e um padrão que o use nunca casa. Foi
  -- assim que a primeira execução da TG-12C reprovou com o estado correto.
  IF v_def !~* 'order\s+by' THEN
    RAISE EXCEPTION 'VERIF 20260731094500: a função NÃO tem ORDER BY — a migration não teve efeito';
  END IF;
  IF v_def !~* 'order\s+by[^;]*\ycreated_at\y' OR v_def !~* 'order\s+by[^;]*\yid\y' THEN
    RAISE EXCEPTION 'VERIF 20260731094500: ordenação sem critério total. Definição: %', v_def;
  END IF;

  -- 2. O que NÃO podia mudar.
  IF v_def !~* 'deleted_at\s+is\s+null' THEN
    RAISE EXCEPTION 'VERIF 20260731094500: o filtro deleted_at IS NULL sumiu';
  END IF;
  IF v_lang <> 'sql' THEN
    RAISE EXCEPTION 'VERIF 20260731094500: linguagem virou %, esperado sql', v_lang;
  END IF;
  IF v_volatile <> 's' THEN
    RAISE EXCEPTION 'VERIF 20260731094500: volatilidade virou %, esperado STABLE', v_volatile;
  END IF;
  IF NOT v_secdef THEN
    RAISE EXCEPTION 'VERIF 20260731094500: SECURITY DEFINER foi perdido';
  END IF;
  IF v_owner <> 'postgres' THEN
    RAISE EXCEPTION 'VERIF 20260731094500: proprietário virou %, esperado postgres', v_owner;
  END IF;
  IF v_rettype <> 'uuid' THEN
    RAISE EXCEPTION 'VERIF 20260731094500: retorno virou %, esperado uuid', v_rettype;
  END IF;
  IF v_config <> 'search_path=public, pg_temp' THEN
    RAISE EXCEPTION 'VERIF 20260731094500: search_path virou "%"', v_config;
  END IF;

  -- 3. ACL preservada.
  SELECT count(*) FILTER (WHERE a.grantee = 0),
         count(*) FILTER (WHERE pg_get_userbyid(a.grantee) = 'anon'),
         count(*) FILTER (WHERE pg_get_userbyid(a.grantee) = 'authenticated'),
         count(*) FILTER (WHERE pg_get_userbyid(a.grantee) = 'service_role')
    INTO v_public, v_anon, v_auth, v_service
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
   WHERE n.nspname = 'public' AND p.proname = 'fn_resolve_tenant_id'
     AND a.privilege_type = 'EXECUTE';

  IF v_public > 0 THEN
    RAISE EXCEPTION 'VERIF 20260731094500: PUBLIC passou a deter EXECUTE';
  END IF;
  IF v_anon > 0 THEN
    RAISE EXCEPTION 'VERIF 20260731094500: anon passou a deter EXECUTE';
  END IF;
  IF v_auth = 0 OR v_service = 0 THEN
    RAISE EXCEPTION 'VERIF 20260731094500: authenticated (%) ou service_role (%) perderam EXECUTE', v_auth, v_service;
  END IF;

  -- 4. As 31 policies dependentes continuam existindo.
  SELECT count(*) INTO v_policies
    FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND (COALESCE(pg_get_expr(pol.polqual, pol.polrelid), '') LIKE '%fn_resolve_tenant_id%'
       OR COALESCE(pg_get_expr(pol.polwithcheck, pol.polrelid), '') LIKE '%fn_resolve_tenant_id%');

  IF v_policies <> 31 THEN
    RAISE EXCEPTION 'VERIF 20260731094500: esperadas 31 policies dependentes, encontradas %', v_policies;
  END IF;

  RAISE NOTICE 'VERIF 20260731094500 OK: ordenação total (created_at, id), deleted_at preservado, owner=%, STABLE, SECURITY DEFINER, search_path=%, 31 policies, PUBLIC/anon sem EXECUTE',
    v_owner, v_config;
  RAISE NOTICE 'NÃO verificado aqui: comportamento (T1-T9). Exige fixtures, que não são criadas em produção — ver migration-rebuild-verify.';
END
$verif$;

ROLLBACK;
