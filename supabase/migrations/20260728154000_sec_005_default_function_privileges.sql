-- SEC-005 — Política para funções futuras criadas por supabase_admin.
-- Estado anterior confirmado:
-- {postgres=X/supabase_admin, anon=X/supabase_admin,
--  authenticated=X/supabase_admin, service_role=X/supabase_admin}
-- Estado posterior: preserva postgres e service_role e remove anon/authenticated.
-- O owner das funções atuais é postgres e seu default já está restrito.
-- Esta migration exige execução por supabase_admin ou por role autorizada a
-- alterar seus default privileges. Em ambiente gerenciado, validar a role antes.
-- PROPOSTA: não executada automaticamente.

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO postgres, service_role;

SELECT
  pg_get_userbyid(d.defaclrole) AS owner,
  n.nspname AS schema_name,
  d.defaclobjtype,
  d.defaclacl
FROM pg_default_acl d
LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
WHERE pg_get_userbyid(d.defaclrole) = 'supabase_admin'
  AND n.nspname = 'public';

-- Teste negativo: função futura criada por supabase_admin não pode ser chamada
-- por anon/authenticated até receber GRANT explícito.
