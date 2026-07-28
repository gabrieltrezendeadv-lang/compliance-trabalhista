-- FIX-005 — Encerra ciclos vencidos por rotina interna.
-- A função é destinada ao scheduler/backend e não fica disponível ao navegador.
-- PROPOSTA: não executada automaticamente.

CREATE OR REPLACE FUNCTION public.fn_close_expired_assessment_cycles()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE public.assessment_cycles
  SET status = 'closed', updated_at = now()
  WHERE status = 'active'
    AND ends_at <= now()
    AND deleted_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_close_expired_assessment_cycles()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_close_expired_assessment_cycles()
  TO service_role;

SELECT p.oid::regprocedure::text, p.prosecdef, p.proconfig, p.proacl
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'fn_close_expired_assessment_cycles';

