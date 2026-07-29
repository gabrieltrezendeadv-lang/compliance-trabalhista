-- =============================================================================
-- Neo SST — BASELINE DE SEGURANÇA (snapshot)
-- =============================================================================
--
-- Origem  : projeto Supabase tvwgzpgyfdfrbdaeoqzl (PostgreSQL 17.6.1.147)
-- Extraído: 29/07/2026, por consultas somente leitura aos catálogos do
--           PostgreSQL (pg_proc, pg_class, pg_namespace, pg_default_acl,
--           pg_policy). Nenhum dado de tabela foi lido.
--
-- Vínculo repositório -> banco : CONFIRMADO (correlação de migrations)
-- Vínculo Vercel -> banco      : NÃO CONFIRMADO
-- Classificação preventiva     : PRODUÇÃO
--
-- ⚠️  ESTE ARQUIVO NÃO DEVE SER APLICADO NO BANCO PRINCIPAL.
--     É um registro do estado observado, para reconstrução em ambiente
--     descartável e para conferência por diferença. Aplicá-lo no banco real
--     é redundante na melhor hipótese e destrutivo na pior.
--
-- Nenhuma ACL foi substituída por GRANT ALL. Os grants abaixo reproduzem
-- exatamente o observado.
-- =============================================================================

-- =============================================================================
-- 1. PAPÉIS ESPERADOS
-- =============================================================================
-- Fornecidos pela plataforma Supabase; não são criados aqui.
--   postgres        proprietário de todos os objetos de public
--   anon            requisições sem sessão (chave anônima)
--   authenticated   requisições com sessão
--   service_role    backend privilegiado, ignora RLS
--   supabase_admin  proprietário de objetos de plataforma

-- =============================================================================
-- 2. PRIVILÉGIOS DE SCHEMA
-- =============================================================================
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- =============================================================================
-- 3. DEFAULT PRIVILEGES — estado observado
-- =============================================================================
--
-- ACHADO RELEVANTE: o endurecimento SEC-001/SEC-005 ESTÁ APLICADO.
-- Para funções criadas por `postgres` em `public`, o default é
-- {postgres=X/postgres} — ou seja, uma função nova NÃO recebe EXECUTE
-- automático para anon, authenticated ou PUBLIC.
--
-- O "risco aceito de default privileges" registrado no escopo §19 está,
-- portanto, mitigado para funções desse proprietário. A compensação exigida
-- (revisão explícita dos grants de toda função nova) permanece necessária,
-- porque objetos criados por `supabase_admin` ainda seguem o default
-- permissivo da plataforma.

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role;

-- Tabelas e sequences criadas por postgres em public seguem o default
-- permissivo da plataforma; a contenção real é a RLS.
--   tabelas   : {postgres,anon,authenticated,service_role} = arwdDxtm
--   sequences : {postgres,anon,authenticated,service_role} = rwU

-- =============================================================================
-- 4. GRANTS DE TABELA — 39 tabelas em public
-- =============================================================================
--
-- Todas as 39 tabelas têm o mesmo ACL observado:
--   {postgres=arwdDxtm, anon=arwdDxtm, authenticated=arwdDxtm,
--    service_role=arwdDxtm}
--
-- Padrão Supabase: o grant é amplo e a contenção é feita por RLS, que está
-- habilitada em 39 de 39 tabelas (100%).
--
-- ⚠️  NENHUMA tabela usa FORCE ROW LEVEL SECURITY (relforcerowsecurity=false).
--     Consequência: o proprietário da tabela (`postgres`) IGNORA a RLS.
--     Isso é o comportamento padrão do PostgreSQL e não é um defeito por si,
--     mas significa que qualquer conexão como `postgres` — migrations,
--     dashboard, psql administrativo — não é contida por policy alguma.

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;

-- =============================================================================
-- 5. RLS — habilitada em todas as tabelas de public
-- =============================================================================
ALTER TABLE public.assessment_cycles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_dispatches      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_invitations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_responses       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_events             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_acknowledgments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_deliveries        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_recipients        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_templates         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.complaint_audit_log        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.complaint_contents         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.complaint_investigators    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.complaint_messages         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.complaint_pin_attempts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.complaints                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.establishments             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_audit_log         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_package_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_packages          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_reports           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_audit_log     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questionnaire_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questionnaire_sections     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questionnaire_templates    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.risk_action_plans          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.risk_audit_log             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.risk_items                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.risk_reviews               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_plans         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_subscriptions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_records              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_events             ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 6. ACL DAS FUNÇÕES — 50 funções em public
-- =============================================================================
--
-- ACHADO CENTRAL: PUBLIC não possui EXECUTE em NENHUMA das 50 funções.
-- Nenhuma entrada de ACL contém a forma `=X/postgres` (sem papel nomeado),
-- que indicaria grant a PUBLIC.
--
-- Deny-by-default explícito, seguido dos grants exatos observados.

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated, service_role;

-- --- Somente postgres (retiradas de circulação) -------------------------------
-- SEC-002 APLICADA: check_plan_limit não é executável por nenhuma role de API.
-- ACL observada: {postgres=X/postgres} nas duas assinaturas.
--   public.check_plan_limit(text)
--   public.check_plan_limit(uuid, text)

-- --- anon (jornadas públicas legítimas) ---------------------------------------
GRANT EXECUTE ON FUNCTION public.fn_get_questionnaire_for_token(text) TO anon;
GRANT EXECUTE ON FUNCTION public.fn_submit_assessment(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.fn_submit_complaint(text, text, text, text, boolean, text, text, text, text, text, text) TO anon, authenticated, service_role;

-- --- service_role (backend / gateway / cron) ----------------------------------
GRANT EXECUTE ON FUNCTION public.fn_access_complaint_v2(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_send_reporter_message_v2(text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_check_pin_rate_limit_v2(text, text, integer, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_record_pin_failure(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_verify_complaint_pin(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_close_expired_assessment_cycles() TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_process_webhook_event(text, text, text, text, text, text, text, timestamp with time zone, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_record_delivery_event(uuid, text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_handle_new_user() TO service_role;
GRANT EXECUTE ON FUNCTION public.transition_subscription_status(uuid, subscription_status, text) TO service_role;

-- --- authenticated + service_role (dashboard) ---------------------------------
GRANT EXECUTE ON FUNCTION public.fn_resolve_tenant_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_create_organization_with_owner(text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_user_has_role(organization_role[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_assessment_cycle_summary(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_assessment_group_results(uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_assessment_participation_stats(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_generate_evidence_report(uuid, text, text, text, uuid, timestamp with time zone, timestamp with time zone, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_get_campaign_stats(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_get_complaint_detail(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_get_complaint_list(text, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_get_complaint_list(uuid, text, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_get_evidence_package_detail(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_get_evidence_report_detail(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_get_risk_detail(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_get_risk_inventory_summary() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_is_assigned_investigator(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_is_complaint_tenant_admin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_prepare_campaign_send(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_remove_member(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_seal_evidence_package(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_update_complaint_status(uuid, text, text) TO authenticated, service_role;

-- --- somente authenticated (sem service_role) ---------------------------------
-- Assimetria observada e preservada tal como está no banco.
GRANT EXECUTE ON FUNCTION public.fn_import_risks_from_cycle(uuid) TO authenticated;

-- --- triggers (service_role apenas; não são chamadas pela API) ----------------
GRANT EXECUTE ON FUNCTION public.fn_audit_log_immutable() TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_campaign_templates_immutable_tenant() TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_campaign_updated_at() TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_campaigns_immutable_tenant() TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_complaints_immutable_tenant() TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_complaints_updated_at() TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_evidence_packages_immutable_sealed() TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_evidence_packages_immutable_tenant() TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_evidence_reports_immutable_content() TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_evidence_reports_immutable_tenant() TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_evidence_updated_at() TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_risk_items_immutable_tenant() TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_set_updated_at() TO service_role;

-- =============================================================================
-- 7. search_path DAS FUNÇÕES SECURITY DEFINER
-- =============================================================================
--
-- 47 das 50 funções usam search_path='' (vazio), o padrão mais rígido: toda
-- referência precisa ser qualificada com o schema.
--
-- Três funções, as mais antigas, usam search_path='public, pg_temp':
--   fn_resolve_tenant_id()
--   fn_create_organization_with_owner(text, text, text)
--   fn_user_has_role(organization_role[])
--
-- Ambas as formas são defensáveis; a divergência está registrada como dívida
-- de padronização, não como vulnerabilidade. Nenhuma função usa search_path
-- mutável ou herdado da sessão.

-- =============================================================================
-- 8. COMENTÁRIOS SOBRE DECISÕES INTENCIONAIS
-- =============================================================================
--
-- (a) `anon` executa fn_get_questionnaire_for_token e fn_submit_assessment
--     porque a jornada de avaliação psicossocial é pública por token. O
--     token é armazenado apenas como hash (PRIV-001).
--
-- (b) `anon` executa fn_submit_complaint porque o canal de denúncias é
--     público por slug, conforme escopo §11. As funções de LEITURA de
--     denúncia (fn_access_complaint_v2, fn_send_reporter_message_v2) NÃO são
--     acessíveis a anon — passam obrigatoriamente pelo gateway server-side
--     com service_role.
--
-- (c) check_plan_limit permanece definida mas sem grant a nenhuma role de
--     API (SEC-002). Retirada do produto enquanto não há precificação.
--
-- (d) fn_import_risks_from_cycle não tem grant a service_role. Assimetria
--     observada; não corrigida aqui, apenas registrada.
--
-- (e) Nenhuma tabela usa FORCE ROW LEVEL SECURITY. Ver §4.
