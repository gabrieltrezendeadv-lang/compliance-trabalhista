-- =============================================================================
-- EXTRAÇÃO DE PROPRIEDADES DE SEGURANÇA DO SCHEMA public
-- =============================================================================
--
-- Emite, em texto canônico e ordenado, todo fato de segurança que
-- supabase/baseline/security.sql registra: ACL de schema, default privileges,
-- ACL e RLS de tabela, ACL e propriedades de função, e inventário de policies.
--
-- Uso:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -q -A -t -f scripts/ci/extract-security.sql
--
-- SOMENTE LEITURA. Só consulta catálogos (pg_namespace, pg_default_acl,
-- pg_class, pg_proc, pg_policy, pg_language). Nenhuma linha de tabela de
-- negócio é lida. Não escreve nada.
--
-- ── POR QUE ESTE ARQUIVO EXISTE, EM VEZ DE "reusar as consultas originais" ───
--
-- `supabase/baseline/security.sql` NÃO é saída de ferramenta: é um arquivo
-- redigido à mão, com prosa e com DDL (`GRANT`, `REVOKE`, `ALTER TABLE ...
-- ENABLE ROW LEVEL SECURITY`) que REPRODUZ o estado observado. As consultas
-- ad hoc que o originaram foram executadas pelo conector MCP e não ficaram
-- preservadas — o README do baseline registra apenas quais catálogos foram
-- lidos, não o texto das consultas.
--
-- Reconstruir de memória o texto daquelas consultas seria alegação sem prova.
-- O caminho aqui é mecânico e reproduzível: este extrator roda DUAS VEZES, no
-- mesmo Postgres descartável —
--
--   A) contra o banco reconstruído pelas 36 migrations;
--   B) contra o banco restaurado a partir de schema.sql + security.sql.
--
-- A comparação é entre as duas extrações. `security.sql` entra como INSUMO,
-- exatamente como está versionado, e não precisa ser reinterpretado. Qualquer
-- divergência é diferença real entre "o que as migrations produzem" e "o que o
-- baseline registra".
--
-- ── NORMALIZAÇÃO EMBUTIDA (declarada) ───────────────────────────────────────
--
--   * ACL é explodida com aclexplode() em uma linha por (grantee, privilégio):
--     a ORDEM interna de um array de ACL não é estável e não tem significado.
--   * grantee 0 é impresso como PUBLIC (é assim que o PostgreSQL o representa).
--   * ACL nula é impressa como <ACL-NULA> — estado distinto de "ACL vazia" e
--     de "ACL explícita", e a distinção importa: ACL nula significa privilégio
--     default do PostgreSQL, não ausência de privilégio.
--   * espaços em sequência dentro de expressões de policy e de proconfig são
--     colapsados: pg_get_expr pode quebrar linha conforme o comprimento.
--   * a saída é ordenada pelo próprio texto da linha.
--
-- Nada além disso. Papel, privilégio, assinatura de função, prosecdef,
-- proconfig, relrowsecurity e relforcerowsecurity aparecem literalmente.
-- =============================================================================

\pset format unaligned
\pset tuples_only on
\pset footer off
\pset null ''

-- search_path fixado em pg_catalog para que `oid::regprocedure` qualifique
-- sempre com o schema (`public.fn_x(uuid)`) e nunca dependa do search_path da
-- sessão. As duas extrações comparadas rodam com a mesma configuração.
SET search_path = pg_catalog;

WITH sch AS (
  SELECT n.oid, n.nspname, n.nspacl
  FROM pg_catalog.pg_namespace n
  WHERE n.nspname = 'public'
),
tabelas AS (
  SELECT c.oid, c.relname, c.relkind, c.relacl, c.relrowsecurity,
         c.relforcerowsecurity, c.relowner
  FROM pg_catalog.pg_class c
  JOIN sch s ON s.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
),
funcoes AS (
  SELECT p.oid,
         p.oid::regprocedure::text AS assinatura,
         p.proacl, p.prosecdef, p.provolatile, p.proconfig, p.proowner,
         l.lanname
  FROM pg_catalog.pg_proc p
  JOIN sch s ON s.oid = p.pronamespace
  JOIN pg_catalog.pg_language l ON l.oid = p.prolang
),
-- LATERAL explícito para agregar os papéis de cada policy: correlação
-- inequívoca, em vez de subconsulta aninhada referenciando a linha externa.
politicas AS (
  SELECT t.relname, pol.polname, pol.polcmd, pol.polpermissive,
         pol.polqual, pol.polwithcheck, pol.polrelid,
         papeis.lista
  FROM pg_catalog.pg_policy pol
  JOIN tabelas t ON t.oid = pol.polrelid
  LEFT JOIN LATERAL (
    SELECT string_agg(nome, ',' ORDER BY nome) AS lista
    FROM (
      SELECT CASE WHEN u = 0 THEN 'PUBLIC'
                  ELSE pg_catalog.pg_get_userbyid(u) END AS nome
      FROM unnest(pol.polroles) AS u
    ) expandidos
  ) papeis ON true
),
linhas AS (
  -- 1. ACL do schema public
  SELECT format('1|schema-acl|%s|%s|%s', s.nspname,
                CASE WHEN a.grantee = 0 THEN 'PUBLIC'
                     ELSE pg_catalog.pg_get_userbyid(a.grantee) END,
                a.privilege_type) AS linha
  FROM sch s, pg_catalog.aclexplode(s.nspacl) a
  UNION ALL
  SELECT format('1|schema-acl|%s|<ACL-NULA>|', s.nspname)
  FROM sch s WHERE s.nspacl IS NULL

  -- 2. default privileges — do schema public e globais (defaclnamespace = 0)
  UNION ALL
  SELECT format('2|default-acl|ns=%s|tipo=%s|dono=%s|%s|%s',
                CASE WHEN d.defaclnamespace = 0 THEN '<GLOBAL>' ELSE 'public' END,
                d.defaclobjtype,
                pg_catalog.pg_get_userbyid(d.defaclrole),
                CASE WHEN a.grantee = 0 THEN 'PUBLIC'
                     ELSE pg_catalog.pg_get_userbyid(a.grantee) END,
                a.privilege_type)
  FROM pg_catalog.pg_default_acl d, pg_catalog.aclexplode(d.defaclacl) a
  WHERE d.defaclnamespace = 0
     OR d.defaclnamespace = (SELECT oid FROM sch)

  -- 3. tabelas: RLS e propriedade
  UNION ALL
  SELECT format('3|tabela|%s|kind=%s|rls=%s|force=%s|dono=%s',
                t.relname, t.relkind, t.relrowsecurity, t.relforcerowsecurity,
                pg_catalog.pg_get_userbyid(t.relowner))
  FROM tabelas t

  -- 4. ACL de tabela
  UNION ALL
  SELECT format('4|tabela-acl|%s|%s|%s', t.relname,
                CASE WHEN a.grantee = 0 THEN 'PUBLIC'
                     ELSE pg_catalog.pg_get_userbyid(a.grantee) END,
                a.privilege_type)
  FROM tabelas t, pg_catalog.aclexplode(t.relacl) a
  UNION ALL
  SELECT format('4|tabela-acl|%s|<ACL-NULA>|', t.relname)
  FROM tabelas t WHERE t.relacl IS NULL

  -- 5. funções: propriedades de segurança
  UNION ALL
  SELECT format('5|funcao|%s|lang=%s|secdef=%s|volatile=%s|config=%s|dono=%s',
                f.assinatura, f.lanname, f.prosecdef, f.provolatile,
                coalesce(regexp_replace(array_to_string(f.proconfig, ','),
                                        '\s+', ' ', 'g'), '<NULO>'),
                pg_catalog.pg_get_userbyid(f.proowner))
  FROM funcoes f

  -- 6. ACL de função
  UNION ALL
  SELECT format('6|funcao-acl|%s|%s|%s', f.assinatura,
                CASE WHEN a.grantee = 0 THEN 'PUBLIC'
                     ELSE pg_catalog.pg_get_userbyid(a.grantee) END,
                a.privilege_type)
  FROM funcoes f, pg_catalog.aclexplode(f.proacl) a
  UNION ALL
  SELECT format('6|funcao-acl|%s|<ACL-NULA>|', f.assinatura)
  FROM funcoes f WHERE f.proacl IS NULL

  -- 7. policies
  UNION ALL
  SELECT format('7|policy|%s|%s|cmd=%s|permissive=%s|roles=%s|using=%s|check=%s',
                p.relname, p.polname, p.polcmd, p.polpermissive,
                coalesce(p.lista, '<NENHUM>'),
                coalesce(regexp_replace(
                  pg_catalog.pg_get_expr(p.polqual, p.polrelid),
                  '\s+', ' ', 'g'), '<NULO>'),
                coalesce(regexp_replace(
                  pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid),
                  '\s+', ' ', 'g'), '<NULO>'))
  FROM politicas p
)
SELECT linha FROM linhas ORDER BY linha;
