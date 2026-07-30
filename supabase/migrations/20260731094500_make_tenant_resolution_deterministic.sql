-- =============================================================================
-- TG-12 — resolução determinística do tenant
-- =============================================================================
--
-- Segunda migration forward-only posterior à reconciliação. As 36 históricas
-- continuam congeladas e `20260730123613_revoke_public_webhook_execute.sql`
-- permanece intacta e independente desta.
--
-- ── O QUE ISTO CORRIGE ──────────────────────────────────────────────────────
--
-- `public.fn_resolve_tenant_id()` seleciona a membership ativa do usuário com
-- `LIMIT 1` e SEM `ORDER BY`. Para usuário com mais de uma membership ativa, o
-- tenant devolvido é escolhido de forma não determinística — o PostgreSQL não
-- garante ordem sem `ORDER BY`, e a linha pode variar entre execuções, planos
-- ou versões.
--
-- A função é a raiz de **31 policies** em 15 tabelas (15 SELECT, 8 INSERT,
-- 8 UPDATE) e da função `public.fn_user_has_role`, que a usa para filtrar
-- `tenant_id = fn_resolve_tenant_id()`. Ou seja: sem determinismo, a
-- verificação de PAPEL também é avaliada contra um tenant arbitrário — quem é
-- `owner` em uma organização e `collaborator` em outra pode ter o papel
-- resolvido contra qualquer uma delas. É consequência de segurança, não só de
-- experiência.
--
-- ── REGRA ADOTADA ───────────────────────────────────────────────────────────
--
--   ORDER BY created_at ASC, id ASC
--
-- A membership ativa mais antiga. Critério TOTAL: `created_at` é `NOT NULL` e
-- `id` é a chave primária, então não há empate possível. Semanticamente é "a
-- organização de origem", coerente com o único caminho que cria membership no
-- produto — `fn_create_organization_with_owner`, que insere o `owner` e recusa
-- uma segunda organização para o mesmo usuário.
--
-- Por que não a mais recente: faria o tenant de um usuário MUDAR sozinho ao
-- ganhar uma membership nova — troca silenciosa de organização, com 31 policies
-- atrás. Nada no repositório sugere "a mais recente" como principal.
--
-- ── IMPACTO SOBRE OS DADOS ──────────────────────────────────────────────────
--
-- Nenhum. Levantamento agregado somente leitura em produção (Fase TG-12A.1):
-- 9 memberships ativas, 9 usuários distintos, ZERO usuários com mais de uma
-- membership ativa, zero soft-deletadas, nenhuma linha ativa sem `created_at`.
--
-- Com uma membership por usuário, qualquer ordenação devolve a mesma linha:
-- esta migration não altera o tenant de nenhum usuário existente. Ela fecha a
-- porta antes de alguém entrar por ela — o primeiro usuário com duas
-- memberships é que exporia o problema.
--
-- ── ESCOPO ──────────────────────────────────────────────────────────────────
--
-- Esta migration NÃO:
--   * altera qualquer uma das 31 policies — nenhuma é recriada;
--   * cria índice;
--   * cria constraint de unicidade por `user_id`;
--   * altera `search_path` — preserva EXATAMENTE `'public', 'pg_temp'`;
--   * toca `fn_user_has_role`, `fn_create_organization_with_owner` ou qualquer
--     outra função;
--   * altera onboarding, convites ou o modelo de memberships;
--   * lê dado de negócio.
--
-- `CREATE OR REPLACE FUNCTION` preserva proprietário e ACL — por isso nenhum
-- `GRANT` ou `REVOKE` é emitido. As pós-condições provam a preservação em vez
-- de pressupô-la.
--
-- Idempotente: reaplicar produz exatamente o mesmo estado.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_resolve_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT om.tenant_id
  FROM public.organization_members om
  WHERE om.user_id = auth.uid()
    AND om.deleted_at IS NULL
  ORDER BY om.created_at ASC, om.id ASC
  LIMIT 1;
$$;

-- ── Pós-condições ───────────────────────────────────────────────────────────
--
-- Somente catálogo e definição da função. Nenhuma consulta a dado de negócio.
DO $tg12$
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
    RAISE EXCEPTION 'TG-12: fn_resolve_tenant_id não encontrada';
  END IF;

  -- 1. determinismo: ORDER BY presente, com os dois critérios
  IF v_def !~* 'order\s+by' THEN
    RAISE EXCEPTION 'TG-12: fn_resolve_tenant_id continua sem ORDER BY';
  END IF;
  IF v_def !~* 'created_at' OR v_def !~* 'order\s+by[^;]*\bid\b' THEN
    RAISE EXCEPTION 'TG-12: ordenação sem critério total (esperado created_at e id)';
  END IF;

  -- 2. filtro de membership inativa preservado
  IF v_def !~* 'deleted_at\s+is\s+null' THEN
    RAISE EXCEPTION 'TG-12: filtro deleted_at IS NULL ausente';
  END IF;

  -- 3. propriedades preservadas
  IF v_lang <> 'sql' THEN
    RAISE EXCEPTION 'TG-12: linguagem virou %, esperado sql', v_lang;
  END IF;
  IF v_volatile <> 's' THEN
    RAISE EXCEPTION 'TG-12: volatilidade virou %, esperado STABLE', v_volatile;
  END IF;
  IF NOT v_secdef THEN
    RAISE EXCEPTION 'TG-12: SECURITY DEFINER foi perdido';
  END IF;
  IF v_owner <> 'postgres' THEN
    RAISE EXCEPTION 'TG-12: proprietário virou %, esperado postgres', v_owner;
  END IF;
  IF v_rettype <> 'uuid' THEN
    RAISE EXCEPTION 'TG-12: retorno virou %, esperado uuid', v_rettype;
  END IF;
  IF v_config <> 'search_path=public, pg_temp' THEN
    RAISE EXCEPTION 'TG-12: search_path virou "%", esperado "search_path=public, pg_temp"', v_config;
  END IF;

  -- 4. ACL preservada: authenticated e service_role com EXECUTE; PUBLIC e anon sem
  SELECT count(*) FILTER (WHERE a.grantee = 0),
         count(*) FILTER (WHERE pg_get_userbyid(a.grantee) = 'authenticated'),
         count(*) FILTER (WHERE pg_get_userbyid(a.grantee) = 'service_role')
    INTO v_public, v_auth, v_service
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
   WHERE n.nspname = 'public' AND p.proname = 'fn_resolve_tenant_id'
     AND a.privilege_type = 'EXECUTE';

  IF v_public > 0 THEN
    RAISE EXCEPTION 'TG-12: PUBLIC passou a deter EXECUTE em fn_resolve_tenant_id';
  END IF;
  IF v_auth = 0 OR v_service = 0 THEN
    RAISE EXCEPTION 'TG-12: authenticated (%) ou service_role (%) perderam EXECUTE', v_auth, v_service;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
     WHERE n.nspname = 'public' AND p.proname = 'fn_resolve_tenant_id'
       AND a.privilege_type = 'EXECUTE'
       AND pg_get_userbyid(a.grantee) = 'anon'
  ) THEN
    RAISE EXCEPTION 'TG-12: anon passou a deter EXECUTE em fn_resolve_tenant_id';
  END IF;

  -- 5. as 31 policies continuam existindo e dependentes
  SELECT count(*) INTO v_policies
    FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND (COALESCE(pg_get_expr(pol.polqual, pol.polrelid), '') LIKE '%fn_resolve_tenant_id%'
       OR COALESCE(pg_get_expr(pol.polwithcheck, pol.polrelid), '') LIKE '%fn_resolve_tenant_id%');

  IF v_policies <> 31 THEN
    RAISE EXCEPTION 'TG-12: esperadas 31 policies dependentes, encontradas %', v_policies;
  END IF;

  RAISE NOTICE 'TG-12 OK: resolução determinística (created_at ASC, id ASC); owner=%, STABLE, SECURITY DEFINER, search_path=%, 31 policies dependentes, PUBLIC/anon sem EXECUTE',
    v_owner, v_config;
END
$tg12$;
