-- SEC-002 — Retira check_plan_limit do produto enquanto não há precificação.
-- Estado anterior confirmado: authenticated e service_role podiam executar
-- as duas assinaturas; PUBLIC e anon já não possuíam EXECUTE efetivo.
-- Estado posterior: nenhuma role de API executa as funções obsoletas.
-- Dependências: remoção das chamadas e da navegação de assinatura no app.
-- PROPOSTA: não executada automaticamente.

REVOKE EXECUTE ON FUNCTION public.check_plan_limit(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.check_plan_limit(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

SELECT
  p.oid::regprocedure::text AS signature,
  p.proacl
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'check_plan_limit'
ORDER BY signature;

-- Teste negativo: authenticated/service_role recebem permission_denied.
-- Teste positivo: jornadas de colaboradores, campanhas, avaliações,
-- riscos, denúncias, evidências e relatórios não chamam estas funções.
