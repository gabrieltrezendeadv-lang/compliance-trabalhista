-- Restaura somente os grants efetivos observados antes de SEC-002.

GRANT EXECUTE ON FUNCTION public.check_plan_limit(text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.check_plan_limit(uuid, text)
  TO authenticated, service_role;
