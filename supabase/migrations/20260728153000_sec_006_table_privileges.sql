-- SEC-006 — Reduz SELECT direto após confirmação do call graph.
-- Estado anterior confirmado:
-- anon: SELECT questionnaire_sections e questionnaire_items.
-- authenticated: SELECT subscription_plans.
-- Estado posterior:
-- as jornadas públicas usam fn_get_questionnaire_for_token; precificação não
-- faz parte do produto e nenhuma tela deve consultar subscription_plans.
-- PROPOSTA: não executada automaticamente.

REVOKE SELECT ON TABLE public.questionnaire_sections FROM anon;
REVOKE SELECT ON TABLE public.questionnaire_items FROM anon;
REVOKE SELECT ON TABLE public.subscription_plans FROM anon, authenticated;

SELECT
  grantee,
  table_schema,
  table_name,
  privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN (
    'questionnaire_sections',
    'questionnaire_items',
    'subscription_plans'
  )
ORDER BY table_name, grantee, privilege_type;

-- Teste positivo: fn_get_questionnaire_for_token continua carregando o formulário.
-- Teste negativo: SELECT direto como anon/authenticated deve falhar.

