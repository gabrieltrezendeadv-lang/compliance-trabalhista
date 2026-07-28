-- SEC-005 — ROLLBACK MANUAL NO DASHBOARD SQL EDITOR.
-- Restaura exatamente a ACL catalogada de supabase_admin.
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO postgres, anon, authenticated, service_role;
