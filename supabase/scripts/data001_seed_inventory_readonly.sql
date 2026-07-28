-- DATA-001 — Inventário somente leitura.
-- Não remove, altera ou anonimiza dados. Execute apenas após confirmar o projeto.

SELECT 'auth.users' AS object_name, count(*) AS row_count FROM auth.users
UNION ALL
SELECT 'public.organizations', count(*) FROM public.organizations
UNION ALL
SELECT 'public.employee_profiles', count(*) FROM public.employee_profiles
UNION ALL
SELECT 'public.assessment_invitations', count(*) FROM public.assessment_invitations
UNION ALL
SELECT 'public.assessment_responses', count(*) FROM public.assessment_responses
UNION ALL
SELECT 'public.complaints', count(*) FROM public.complaints
ORDER BY object_name;

SELECT
  table_name,
  min(created_at) AS first_created_at,
  max(created_at) AS last_created_at
FROM (
  SELECT 'employee_profiles' AS table_name, created_at FROM public.employee_profiles
  UNION ALL
  SELECT 'assessment_invitations', created_at FROM public.assessment_invitations
  UNION ALL
  SELECT 'assessment_responses', created_at FROM public.assessment_responses
  UNION ALL
  SELECT 'complaints', created_at FROM public.complaints
) inventory
GROUP BY table_name
ORDER BY table_name;

-- DATA-001 destrutivo permanece bloqueado até:
-- 1. confirmação inequívoca do ambiente;
-- 2. backup e restauração testada;
-- 3. inventário de dependências;
-- 4. aprovação específica do conjunto exato de registros.

