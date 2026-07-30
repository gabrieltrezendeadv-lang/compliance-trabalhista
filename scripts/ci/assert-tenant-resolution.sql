-- =============================================================================
-- TESTES DE COMPORTAMENTO — TG-12, resolução determinística do tenant
-- =============================================================================
--
-- Uso:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f scripts/ci/assert-tenant-resolution.sql
--
-- ⚠️ SOMENTE em banco LOCAL e DESCARTÁVEL. Insere dados de teste em
--    auth.users, public.profiles, public.organizations e
--    public.organization_members.
--
-- Tudo roda dentro de UMA transação encerrada por ROLLBACK: nenhum dado
-- sobrevive, nem em caso de sucesso. Um `ON_ERROR_STOP=1` aborta a transação
-- na primeira falha, e o ROLLBACK implícito preserva o banco do mesmo modo.
--
-- ── COMO auth.uid() É SIMULADO ──────────────────────────────────────────────
--
-- `auth.uid()` do Supabase lê o claim `sub` de `request.jwt.claims`. O teste
-- usa `set_config('request.jwt.claims', ..., true)` — o `true` final torna a
-- configuração LOCAL à transação, então ela desaparece com o ROLLBACK.
--
-- ── POR QUE O TESTE PRECISA DE SECURITY DEFINER ─────────────────────────────
--
-- `fn_resolve_tenant_id` é SECURITY DEFINER e roda como `postgres`, que é dono
-- das tabelas e não é contido por RLS (nenhuma tabela usa FORCE ROW LEVEL
-- SECURITY). O teste conecta como `postgres`, então enxerga o mesmo que a
-- função — é a resolução que está sob teste, não a RLS.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- UUIDs fixos e legíveis: o teste precisa ser determinístico, e comparações
-- por id dependem de saber qual id é menor.

CREATE TEMP TABLE tg12_ids (rotulo text PRIMARY KEY, valor uuid);
INSERT INTO tg12_ids VALUES
  ('user_sem',    '00000000-0000-4000-8000-000000000001'),
  ('user_um',     '00000000-0000-4000-8000-000000000002'),
  ('user_dois',   '00000000-0000-4000-8000-000000000003'),
  ('user_empate', '00000000-0000-4000-8000-000000000004'),
  ('user_del',    '00000000-0000-4000-8000-000000000005'),
  ('org_antiga',  '00000000-0000-4000-9000-000000000001'),
  ('org_nova',    '00000000-0000-4000-9000-000000000002'),
  ('org_unica',   '00000000-0000-4000-9000-000000000003'),
  ('org_del',     '00000000-0000-4000-9000-000000000004'),
  ('org_emp_a',   '00000000-0000-4000-9000-000000000005'),
  ('org_emp_b',   '00000000-0000-4000-9000-000000000006'),
  -- membership ids: 'a' < 'b' na ordenação de uuid
  ('memb_emp_a',  '00000000-0000-4000-a000-00000000000a'),
  ('memb_emp_b',  '00000000-0000-4000-a000-00000000000b');

CREATE OR REPLACE FUNCTION pg_temp.id(p text) RETURNS uuid
LANGUAGE sql STABLE AS $fn$
  SELECT valor FROM tg12_ids WHERE rotulo = p;
$fn$;

INSERT INTO auth.users (id, instance_id, aud, role, email)
SELECT valor, '00000000-0000-0000-0000-000000000000', 'authenticated',
       'authenticated', rotulo || '@tg12.test'
  FROM tg12_ids WHERE rotulo LIKE 'user_%';

-- O INSERT acima em `auth.users` JÁ criou estes profiles: a migration
-- 20260724123308 instala o gatilho `on_auth_user_created` (AFTER INSERT ON
-- auth.users), que chama `public.fn_handle_new_user()` e insere em
-- `public.profiles`. Sem `ON CONFLICT`, este statement colidia em
-- `profiles_pkey` e abortava a transação ANTES de T1 — foi assim que a segunda
-- execução da TG-12C reprovou.
--
-- Convergir com o gatilho em vez de competir com ele: o próprio
-- `fn_handle_new_user` usa `ON CONFLICT (id) DO UPDATE`. Manter o statement
-- (em vez de removê-lo) preserva os nomes determinísticos que os testes usam e
-- continua correto se o gatilho um dia deixar de existir.
INSERT INTO public.profiles (id, full_name, email)
SELECT valor, rotulo, rotulo || '@tg12.test'
  FROM tg12_ids
 WHERE rotulo LIKE 'user_%'
ON CONFLICT (id) DO UPDATE
  SET full_name = EXCLUDED.full_name,
      email = EXCLUDED.email;

INSERT INTO public.organizations (id, name, slug)
SELECT valor, rotulo, rotulo
  FROM tg12_ids WHERE rotulo LIKE 'org_%';

-- user_um: uma membership ativa
INSERT INTO public.organization_members (tenant_id, user_id, role, created_at)
VALUES (pg_temp.id('org_unica'), pg_temp.id('user_um'), 'owner', '2026-01-01T00:00:00Z');

-- user_dois: duas ativas — a mais ANTIGA é org_antiga
INSERT INTO public.organization_members (tenant_id, user_id, role, created_at)
VALUES (pg_temp.id('org_antiga'), pg_temp.id('user_dois'), 'owner',        '2026-01-01T00:00:00Z'),
       (pg_temp.id('org_nova'),   pg_temp.id('user_dois'), 'collaborator', '2026-06-01T00:00:00Z');

-- user_empate: duas com created_at IDÊNTICO — desempate obrigatório por id
INSERT INTO public.organization_members (id, tenant_id, user_id, role, created_at)
VALUES (pg_temp.id('memb_emp_b'), pg_temp.id('org_emp_b'), pg_temp.id('user_empate'), 'owner', '2026-03-01T00:00:00Z'),
       (pg_temp.id('memb_emp_a'), pg_temp.id('org_emp_a'), pg_temp.id('user_empate'), 'owner', '2026-03-01T00:00:00Z');

-- user_del: única membership SOFT-DELETADA
INSERT INTO public.organization_members (tenant_id, user_id, role, created_at, deleted_at)
VALUES (pg_temp.id('org_del'), pg_temp.id('user_del'), 'owner', '2026-01-01T00:00:00Z', now());

-- ── Auxiliar: resolve o tenant como se fosse o usuário informado ────────────
CREATE OR REPLACE FUNCTION pg_temp.resolver_como(p_user uuid) RETURNS uuid
LANGUAGE plpgsql AS $fn$
DECLARE v uuid;
BEGIN
  IF p_user IS NULL THEN
    PERFORM set_config('request.jwt.claims', NULL, true);
  ELSE
    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', p_user::text, 'role', 'authenticated')::text,
                       true);
  END IF;
  SELECT public.fn_resolve_tenant_id() INTO v;
  RETURN v;
END
$fn$;

-- ── Asserções ───────────────────────────────────────────────────────────────
DO $tg12$
DECLARE
  v uuid; v2 uuid; v3 uuid;
  n integer;
BEGIN
  -- T1 · usuário sem membership ativa → NULL
  v := pg_temp.resolver_como(pg_temp.id('user_sem'));
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'T1 falhou: usuário sem membership recebeu tenant %', v;
  END IF;
  RAISE NOTICE 'T1 OK — sem membership ativa → NULL';

  -- T2 · uma membership ativa → aquele tenant
  v := pg_temp.resolver_como(pg_temp.id('user_um'));
  IF v IS DISTINCT FROM pg_temp.id('org_unica') THEN
    RAISE EXCEPTION 'T2 falhou: esperado org_unica, obtido %', v;
  END IF;
  RAISE NOTICE 'T2 OK — uma membership ativa → mesmo tenant';

  -- T3 · membership soft-deletada não é selecionada
  v := pg_temp.resolver_como(pg_temp.id('user_del'));
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'T3 falhou: membership soft-deletada foi selecionada (%)', v;
  END IF;
  RAISE NOTICE 'T3 OK — soft-deletada ignorada';

  -- T4 · duas ativas → a MAIS ANTIGA
  v := pg_temp.resolver_como(pg_temp.id('user_dois'));
  IF v IS DISTINCT FROM pg_temp.id('org_antiga') THEN
    RAISE EXCEPTION 'T4 falhou: esperado org_antiga (created_at menor), obtido %', v;
  END IF;
  RAISE NOTICE 'T4 OK — duas ativas → a mais antiga';

  -- T5 · empate de created_at → desempate por id ASC
  v := pg_temp.resolver_como(pg_temp.id('user_empate'));
  IF v IS DISTINCT FROM pg_temp.id('org_emp_a') THEN
    RAISE EXCEPTION 'T5 falhou: empate de created_at deveria resolver por id ASC (org_emp_a), obtido %', v;
  END IF;
  RAISE NOTICE 'T5 OK — empate resolvido por id ASC';

  -- T6 · chamadas repetidas devolvem sempre o mesmo
  v  := pg_temp.resolver_como(pg_temp.id('user_dois'));
  v2 := pg_temp.resolver_como(pg_temp.id('user_dois'));
  v3 := pg_temp.resolver_como(pg_temp.id('user_dois'));
  IF v IS DISTINCT FROM v2 OR v2 IS DISTINCT FROM v3 THEN
    RAISE EXCEPTION 'T6 falhou: chamadas repetidas divergiram: %, %, %', v, v2, v3;
  END IF;
  RAISE NOTICE 'T6 OK — chamadas repetidas estáveis';

  -- T7 · sem autenticação → NULL
  v := pg_temp.resolver_como(NULL);
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'T7 falhou: sem autenticação recebeu tenant %', v;
  END IF;
  RAISE NOTICE 'T7 OK — não autenticado → NULL';

  -- T8 · fn_user_has_role usa o tenant resolvido.
  --      user_dois é `owner` em org_antiga (a resolvida) e `collaborator` em
  --      org_nova. Se o papel fosse avaliado contra a outra, o resultado
  --      inverteria — é exatamente o que a indeterminação causava.
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', pg_temp.id('user_dois')::text)::text, true);
  IF NOT public.fn_user_has_role(ARRAY['owner']::public.organization_role[]) THEN
    RAISE EXCEPTION 'T8 falhou: fn_user_has_role não reconheceu owner no tenant resolvido';
  END IF;
  IF public.fn_user_has_role(ARRAY['collaborator']::public.organization_role[]) THEN
    RAISE EXCEPTION 'T8 falhou: fn_user_has_role reconheceu papel do tenant NÃO resolvido';
  END IF;
  RAISE NOTICE 'T8 OK — fn_user_has_role avalia contra o tenant resolvido';

  -- T9 · as 31 policies continuam existentes e dependentes
  SELECT count(*) INTO n
    FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public'
     AND (COALESCE(pg_get_expr(pol.polqual, pol.polrelid), '') LIKE '%fn_resolve_tenant_id%'
       OR COALESCE(pg_get_expr(pol.polwithcheck, pol.polrelid), '') LIKE '%fn_resolve_tenant_id%');
  IF n <> 31 THEN
    RAISE EXCEPTION 'T9 falhou: esperadas 31 policies dependentes, encontradas %', n;
  END IF;
  RAISE NOTICE 'T9 OK — 31 policies dependentes';

  RAISE NOTICE '=== TG-12: 9 asserções de comportamento aprovadas ===';
END
$tg12$;

ROLLBACK;
