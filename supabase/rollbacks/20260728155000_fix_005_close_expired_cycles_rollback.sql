-- FIX-005 — remove a função nova e restaura o estado anterior (função ausente).
-- Não há privilégios anteriores a restaurar porque o objeto não existia.

BEGIN;

DROP FUNCTION IF EXISTS public.fn_close_expired_assessment_cycles();

COMMIT;
