-- Verificação de SEC-006 — privilégios de tabela
--
-- Extraída verbatim da cauda de
-- supabase/history/pre-reconciliation/20260728153000_sec_006_table_privileges.sql
-- Corresponde à versão aplicada 20260728191255, cuja cauda NÃO integra o SQL
-- registrado no banco. Somente leitura. Ver ../checks/README.md.

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
