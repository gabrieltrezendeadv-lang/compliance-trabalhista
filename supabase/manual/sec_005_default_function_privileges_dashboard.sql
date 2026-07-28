-- SEC-005 — ETAPA MANUAL NO DASHBOARD SQL EDITOR.
-- Não colocar este arquivo no fluxo automático de migrations: a role postgres
-- não pode alterar os default privileges pertencentes a supabase_admin.
-- Executar no SQL Editor do projeto/branch, confirmar que a sessão possui a
-- autoridade necessária e conferir a consulta de verificação ao final.
--
-- Política para funções futuras criadas por supabase_admin.
-- Estado anterior confirmado:
-- {postgres=X/supabase_admin, anon=X/supabase_admin,
--  authenticated=X/supabase_admin, service_role=X/supabase_admin}
-- Estado posterior: preserva postgres e service_role e remove anon/authenticated.
-- O owner das funções atuais é postgres e seu default já está restrito.
-- Este script exige execução por supabase_admin ou por role autorizada a
-- alterar seus default privileges. Em ambiente gerenciado, validar a role antes.
-- PROPOSTA MANUAL: não executada automaticamente.

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
