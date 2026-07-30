REVOKE EXECUTE ON FUNCTION public.check_plan_limit(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.check_plan_limit(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
