--
-- PostgreSQL database dump
--

\restrict A6Zhz5IJwJdToatIOqUQOAcnY9u6ElMSWBgmU7pj1Rb24IAQkoOzNDrjHQ20vQA

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.10 (Ubuntu 17.10-1.pgdg24.04+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: action_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.action_status AS ENUM (
    'planned',
    'in_progress',
    'completed',
    'cancelled',
    'overdue'
);


--
-- Name: assessment_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.assessment_status AS ENUM (
    'planning',
    'active',
    'closed',
    'archived'
);


--
-- Name: billing_cycle; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.billing_cycle AS ENUM (
    'monthly',
    'yearly'
);


--
-- Name: campaign_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.campaign_status AS ENUM (
    'draft',
    'scheduled',
    'sending',
    'sent',
    'cancelled'
);


--
-- Name: campaign_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.campaign_type AS ENUM (
    'informational',
    'risk_assessment',
    'policy_update',
    'training',
    'legal_notice',
    'custom'
);


--
-- Name: complaint_category; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.complaint_category AS ENUM (
    'harassment',
    'sexual_harassment',
    'discrimination',
    'retaliation',
    'safety_violation',
    'fraud',
    'corruption',
    'conflict_of_interest',
    'policy_violation',
    'other'
);


--
-- Name: complaint_severity; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.complaint_severity AS ENUM (
    'low',
    'medium',
    'high',
    'critical'
);


--
-- Name: complaint_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.complaint_status AS ENUM (
    'pending',
    'under_review',
    'investigating',
    'resolved',
    'dismissed',
    'reopened'
);


--
-- Name: control_hierarchy; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.control_hierarchy AS ENUM (
    'elimination',
    'substitution',
    'engineering',
    'administrative',
    'ppe'
);


--
-- Name: delivery_channel; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.delivery_channel AS ENUM (
    'email',
    'whatsapp',
    'both'
);


--
-- Name: delivery_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.delivery_status AS ENUM (
    'pending',
    'queued',
    'sent',
    'delivered',
    'read',
    'failed',
    'bounced',
    'rejected'
);


--
-- Name: evidence_action; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.evidence_action AS ENUM (
    'generated',
    'viewed',
    'downloaded',
    'package_created',
    'package_sealed',
    'package_exported'
);


--
-- Name: evidence_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.evidence_status AS ENUM (
    'generating',
    'ready',
    'failed',
    'superseded'
);


--
-- Name: evidence_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.evidence_type AS ENUM (
    'campaign_report',
    'assessment_report',
    'complaint_summary',
    'risk_inventory',
    'compliance_package',
    'custom'
);


--
-- Name: invoice_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.invoice_status AS ENUM (
    'pending',
    'paid',
    'overdue',
    'cancelled',
    'refunded'
);


--
-- Name: organization_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.organization_role AS ENUM (
    'owner',
    'admin',
    'manager',
    'collaborator',
    'investigator',
    'auditor'
);


--
-- Name: package_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.package_status AS ENUM (
    'draft',
    'sealed',
    'exported'
);


--
-- Name: payment_method; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payment_method AS ENUM (
    'boleto',
    'pix',
    'credit_card'
);


--
-- Name: plan_limits; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.plan_limits AS (
	max_establishments integer,
	max_departments integer,
	max_members integer,
	max_campaigns_per_month integer,
	max_assessments_per_month integer,
	evidence_storage_mb integer,
	has_api_access boolean,
	has_custom_branding boolean,
	has_priority_support boolean
);


--
-- Name: review_recommendation; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.review_recommendation AS ENUM (
    'maintain',
    'intensify',
    'close',
    'new_action'
);


--
-- Name: risk_category; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.risk_category AS ENUM (
    'psychosocial',
    'ergonomic',
    'physical',
    'chemical',
    'biological',
    'accident'
);


--
-- Name: risk_item_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.risk_item_status AS ENUM (
    'identified',
    'action_planned',
    'in_progress',
    'mitigated',
    'accepted',
    'closed'
);


--
-- Name: risk_level; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.risk_level AS ENUM (
    'low',
    'moderate',
    'high',
    'critical'
);


--
-- Name: risk_source; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.risk_source AS ENUM (
    'assessment',
    'manual',
    'complaint',
    'inspection'
);


--
-- Name: subscription_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.subscription_status AS ENUM (
    'trialing',
    'active',
    'past_due',
    'grace_period',
    'partially_blocked',
    'fully_blocked',
    'cancelled'
);


--
-- Name: check_plan_limit(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_plan_limit(p_metric text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_tenant_id     uuid;
  v_tenant_count  integer;
BEGIN
  SELECT count(DISTINCT om.tenant_id)
  INTO v_tenant_count
  FROM public.organization_members om
  WHERE om.user_id = auth.uid()
    AND om.deleted_at IS NULL;

  IF v_tenant_count = 0 THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'no_tenant');
  END IF;

  IF v_tenant_count > 1 THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'multi_org_ambiguous');
  END IF;

  SELECT om.tenant_id INTO v_tenant_id
  FROM public.organization_members om
  WHERE om.user_id = auth.uid()
    AND om.deleted_at IS NULL
  LIMIT 1;

  RETURN public.check_plan_limit(v_tenant_id, p_metric);
END;
$$;


--
-- Name: check_plan_limit(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_plan_limit(p_tenant_id uuid, p_metric text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_status        public.subscription_status;
  v_max_est       integer;
  v_max_dept      integer;
  v_max_mem       integer;
  v_max_camp      integer;
  v_max_assess    integer;
  v_max_allowed   integer;
  v_current_count integer;
BEGIN
  -- Verificar que o caller e membro do tenant especificado
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.user_id = auth.uid()
      AND om.tenant_id = p_tenant_id
      AND om.deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'forbidden');
  END IF;

  SELECT s.status,
         (p.limits).max_establishments,
         (p.limits).max_departments,
         (p.limits).max_members,
         (p.limits).max_campaigns_per_month,
         (p.limits).max_assessments_per_month
  INTO v_status, v_max_est, v_max_dept, v_max_mem, v_max_camp, v_max_assess
  FROM public.tenant_subscriptions s
  JOIN public.subscription_plans p ON p.id = s.plan_id
  WHERE s.tenant_id = p_tenant_id AND s.deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'no_subscription');
  END IF;

  IF v_status IN ('fully_blocked', 'cancelled') THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'subscription_blocked');
  END IF;

  IF v_status = 'partially_blocked' THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'read_only_mode');
  END IF;

  v_max_allowed := CASE p_metric
    WHEN 'establishments' THEN v_max_est
    WHEN 'departments' THEN v_max_dept
    WHEN 'members' THEN v_max_mem
    WHEN 'campaigns' THEN v_max_camp
    WHEN 'assessments' THEN v_max_assess
    ELSE NULL
  END;

  IF v_max_allowed IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'unknown_metric');
  END IF;

  SELECT COALESCE(COUNT(*), 0) INTO v_current_count
  FROM (
    SELECT 1 FROM public.establishments WHERE tenant_id = p_tenant_id AND deleted_at IS NULL AND p_metric = 'establishments'
    UNION ALL
    SELECT 1 FROM public.departments WHERE tenant_id = p_tenant_id AND deleted_at IS NULL AND p_metric = 'departments'
    UNION ALL
    SELECT 1 FROM public.organization_members WHERE tenant_id = p_tenant_id AND deleted_at IS NULL AND p_metric = 'members'
    UNION ALL
    SELECT 1 FROM public.campaigns WHERE tenant_id = p_tenant_id AND deleted_at IS NULL AND p_metric = 'campaigns' AND created_at >= date_trunc('month', now())
    UNION ALL
    SELECT 1 FROM public.assessment_cycles WHERE tenant_id = p_tenant_id AND deleted_at IS NULL AND p_metric = 'assessments' AND created_at >= date_trunc('month', now())
  ) counts;

  RETURN jsonb_build_object(
    'allowed', v_current_count < v_max_allowed,
    'limit', v_max_allowed,
    'current', v_current_count,
    'remaining', GREATEST(0, v_max_allowed - v_current_count)
  );
END;
$$;


--
-- Name: fn_access_complaint_v2(text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_access_complaint_v2(p_protocol text, p_pin_hash text, p_caller_ip_hash text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE
  v_complaint  record;
  v_messages   jsonb;
  v_rate_ok    boolean;
  v_new_bcrypt text;
BEGIN
  -- 1. Verificar rate limit (dual: protocolo + ip_hash)
  SELECT public.fn_check_pin_rate_limit_v2(p_protocol, p_caller_ip_hash) INTO v_rate_ok;
  IF NOT v_rate_ok THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'rate_limited');
  END IF;

  -- 2. Buscar denuncia
  SELECT c.id, c.status, c.category, c.severity, c.is_anonymous,
         c.pin_hash, c.created_at, c.updated_at
  INTO v_complaint
  FROM public.complaints c
  WHERE c.protocol = p_protocol;

  -- Dummy bcrypt anti-enumeracao quando protocolo nao existe
  IF v_complaint IS NULL THEN
    PERFORM extensions.crypt('dummy-constant-time', extensions.gen_salt('bf', 10));
    PERFORM public.fn_record_pin_failure(p_protocol, p_caller_ip_hash);
    RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_credentials');
  END IF;

  -- 3. Verificar PIN
  IF NOT public.fn_verify_complaint_pin(v_complaint.pin_hash, p_pin_hash) THEN
    PERFORM public.fn_record_pin_failure(p_protocol, p_caller_ip_hash);
    RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_credentials');
  END IF;

  -- 4. Rehash legado para bcrypt (PIN correto)
  IF v_complaint.pin_hash NOT LIKE '$2%' THEN
    v_new_bcrypt := extensions.crypt(p_pin_hash, extensions.gen_salt('bf', 10));
    UPDATE public.complaints
    SET pin_hash = v_new_bcrypt
    WHERE id = v_complaint.id;
  END IF;

  -- 5. Buscar mensagens
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', m.id,
      'sender_type', m.sender_type,
      'body', m.body,
      'created_at', m.created_at
    ) ORDER BY m.created_at
  ), '[]'::jsonb)
  INTO v_messages
  FROM public.complaint_messages m
  WHERE m.complaint_id = v_complaint.id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'complaint', jsonb_build_object(
      'status', v_complaint.status,
      'category', v_complaint.category,
      'severity', v_complaint.severity,
      'is_anonymous', v_complaint.is_anonymous,
      'created_at', v_complaint.created_at,
      'updated_at', v_complaint.updated_at
    ),
    'messages', v_messages
  );
END;
$_$;


--
-- Name: fn_assessment_cycle_summary(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_assessment_cycle_summary(p_cycle_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$ DECLARE v_cycle record; v_results jsonb; BEGIN SELECT ac.id, ac.tenant_id, ac.questionnaire_template_id, ac.min_respondents_threshold INTO v_cycle FROM public.assessment_cycles ac WHERE ac.id = p_cycle_id AND ac.deleted_at IS NULL; IF v_cycle IS NULL OR (auth.role() IS DISTINCT FROM 'service_role' AND NOT EXISTS (SELECT 1 FROM public.organization_members om WHERE om.tenant_id = v_cycle.tenant_id AND om.user_id = auth.uid() AND om.role IN ('owner','admin','manager','auditor') AND om.deleted_at IS NULL)) THEN RETURN '[]'::jsonb; END IF; SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.display_order), '[]'::jsonb) INTO v_results FROM (SELECT qs.id AS section_id, qs.name AS section_name, qs.dimension_code, qs.display_order, count(DISTINCT ar.submission_batch_id) AS respondent_count, CASE WHEN count(DISTINCT ar.submission_batch_id) >= v_cycle.min_respondents_threshold THEN round(avg(CASE WHEN qi.reverse_scored THEN 6 - ar.value ELSE ar.value END)::numeric, 2) END AS avg_score, CASE WHEN count(DISTINCT ar.submission_batch_id) >= v_cycle.min_respondents_threshold THEN min(CASE WHEN qi.reverse_scored THEN 6 - ar.value ELSE ar.value END) END AS min_score, CASE WHEN count(DISTINCT ar.submission_batch_id) >= v_cycle.min_respondents_threshold THEN max(CASE WHEN qi.reverse_scored THEN 6 - ar.value ELSE ar.value END) END AS max_score, CASE WHEN count(DISTINCT ar.submission_batch_id) >= v_cycle.min_respondents_threshold THEN round(stddev(CASE WHEN qi.reverse_scored THEN 6 - ar.value ELSE ar.value END)::numeric, 2) END AS stddev_score, count(DISTINCT ar.submission_batch_id) < v_cycle.min_respondents_threshold AS below_threshold FROM public.questionnaire_sections qs JOIN public.questionnaire_items qi ON qi.section_id = qs.id LEFT JOIN public.assessment_responses ar ON ar.item_id = qi.id AND ar.cycle_id = p_cycle_id WHERE qs.template_id = v_cycle.questionnaire_template_id GROUP BY qs.id, qs.name, qs.dimension_code, qs.display_order) s; RETURN v_results; END; $$;


--
-- Name: fn_assessment_group_results(uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_assessment_group_results(p_cycle_id uuid, p_establishment_id uuid, p_department_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$ DECLARE v_cycle record; v_results jsonb; BEGIN SELECT ac.id, ac.tenant_id, ac.questionnaire_template_id, ac.min_respondents_threshold INTO v_cycle FROM public.assessment_cycles ac WHERE ac.id = p_cycle_id AND ac.deleted_at IS NULL; IF v_cycle IS NULL OR (auth.role() IS DISTINCT FROM 'service_role' AND NOT EXISTS (SELECT 1 FROM public.organization_members om WHERE om.tenant_id = v_cycle.tenant_id AND om.user_id = auth.uid() AND om.role IN ('owner','admin','manager','auditor') AND om.deleted_at IS NULL)) THEN RETURN '[]'::jsonb; END IF; SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.display_order), '[]'::jsonb) INTO v_results FROM (SELECT qs.id AS section_id, qs.name AS section_name, qs.dimension_code, qs.display_order, count(DISTINCT ar.submission_batch_id) AS respondent_count, CASE WHEN count(DISTINCT ar.submission_batch_id) >= v_cycle.min_respondents_threshold THEN round(avg(CASE WHEN qi.reverse_scored THEN 6 - ar.value ELSE ar.value END)::numeric, 2) END AS avg_score, CASE WHEN count(DISTINCT ar.submission_batch_id) >= v_cycle.min_respondents_threshold THEN min(CASE WHEN qi.reverse_scored THEN 6 - ar.value ELSE ar.value END) END AS min_score, CASE WHEN count(DISTINCT ar.submission_batch_id) >= v_cycle.min_respondents_threshold THEN max(CASE WHEN qi.reverse_scored THEN 6 - ar.value ELSE ar.value END) END AS max_score, CASE WHEN count(DISTINCT ar.submission_batch_id) >= v_cycle.min_respondents_threshold THEN round(stddev(CASE WHEN qi.reverse_scored THEN 6 - ar.value ELSE ar.value END)::numeric, 2) END AS stddev_score, count(DISTINCT ar.submission_batch_id) < v_cycle.min_respondents_threshold AS below_threshold FROM public.questionnaire_sections qs JOIN public.questionnaire_items qi ON qi.section_id = qs.id LEFT JOIN public.assessment_responses ar ON ar.item_id = qi.id AND ar.cycle_id = p_cycle_id AND ar.establishment_id = p_establishment_id AND (p_department_id IS NULL OR ar.department_id = p_department_id) WHERE qs.template_id = v_cycle.questionnaire_template_id GROUP BY qs.id, qs.name, qs.dimension_code, qs.display_order) s; RETURN v_results; END; $$;


--
-- Name: fn_assessment_participation_stats(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_assessment_participation_stats(p_cycle_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$ DECLARE v_tenant_id uuid; v_threshold integer; v_result jsonb; BEGIN SELECT ac.tenant_id, ac.min_respondents_threshold INTO v_tenant_id, v_threshold FROM public.assessment_cycles ac WHERE ac.id = p_cycle_id AND ac.deleted_at IS NULL AND (auth.role() = 'service_role' OR EXISTS (SELECT 1 FROM public.organization_members om WHERE om.tenant_id = ac.tenant_id AND om.user_id = auth.uid() AND om.deleted_at IS NULL)); IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'cycle_not_found_or_forbidden'; END IF; WITH invitation_groups AS (SELECT ad.establishment_id, e.name AS establishment_name, ad.department_id, d.name AS department_name, count(ad.id)::integer AS invited_count FROM public.assessment_dispatches ad LEFT JOIN public.establishments e ON e.id = ad.establishment_id LEFT JOIN public.departments d ON d.id = ad.department_id WHERE ad.cycle_id = p_cycle_id AND ad.tenant_id = v_tenant_id AND ad.status = 'sent' GROUP BY ad.establishment_id, e.name, ad.department_id, d.name), response_groups AS (SELECT ar.establishment_id, ar.department_id, count(DISTINCT ar.submission_batch_id)::integer AS responded_count FROM public.assessment_responses ar WHERE ar.cycle_id = p_cycle_id AND ar.tenant_id = v_tenant_id GROUP BY ar.establishment_id, ar.department_id), raw_groups AS (SELECT ig.establishment_id, ig.establishment_name, ig.department_id, ig.department_name, ig.invited_count, COALESCE(rg.responded_count, 0)::integer AS responded_count FROM invitation_groups ig LEFT JOIN response_groups rg ON rg.establishment_id IS NOT DISTINCT FROM ig.establishment_id AND rg.department_id IS NOT DISTINCT FROM ig.department_id), protected_groups AS (SELECT jsonb_build_object('scope', 'group', 'establishment_id', rg.establishment_id, 'establishment_name', rg.establishment_name, 'department_id', rg.department_id, 'department_name', rg.department_name, 'invited_count', CASE WHEN rg.responded_count >= v_threshold THEN rg.invited_count ELSE NULL END, 'responded_count', CASE WHEN rg.responded_count >= v_threshold THEN rg.responded_count ELSE NULL END, 'participation_rate', CASE WHEN rg.responded_count >= v_threshold THEN round(100.0 * rg.responded_count / NULLIF(rg.invited_count, 0), 1) ELSE NULL END, 'below_threshold', rg.responded_count < v_threshold) AS item FROM raw_groups rg), overall_counts AS (SELECT COALESCE((SELECT count(ad.id) FROM public.assessment_dispatches ad WHERE ad.cycle_id = p_cycle_id AND ad.tenant_id = v_tenant_id AND ad.status = 'sent'), 0)::integer AS invited_count, COALESCE((SELECT count(DISTINCT ar.submission_batch_id) FROM public.assessment_responses ar WHERE ar.cycle_id = p_cycle_id AND ar.tenant_id = v_tenant_id), 0)::integer AS responded_count), all_items AS (SELECT 0 AS sort_order, jsonb_build_object('scope', 'overall', 'establishment_id', NULL, 'establishment_name', NULL, 'department_id', NULL, 'department_name', NULL, 'invited_count', CASE WHEN oc.responded_count >= v_threshold THEN oc.invited_count ELSE NULL END, 'responded_count', CASE WHEN oc.responded_count >= v_threshold THEN oc.responded_count ELSE NULL END, 'participation_rate', CASE WHEN oc.responded_count >= v_threshold THEN round(100.0 * oc.responded_count / NULLIF(oc.invited_count, 0), 1) ELSE NULL END, 'below_threshold', oc.responded_count < v_threshold) AS item FROM overall_counts oc UNION ALL SELECT 1, pg.item FROM protected_groups pg) SELECT COALESCE(jsonb_agg(ai.item ORDER BY ai.sort_order), '[]'::jsonb) INTO v_result FROM all_items ai; RETURN v_result; END; $$;


--
-- Name: fn_audit_log_immutable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_audit_log_immutable() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  RAISE EXCEPTION 'complaint_audit_log is append-only: % not allowed', TG_OP;
END;
$$;


--
-- Name: fn_campaign_templates_immutable_tenant(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_campaign_templates_immutable_tenant() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'tenant_id is immutable on campaign_templates';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: fn_campaign_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_campaign_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: fn_campaigns_immutable_tenant(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_campaigns_immutable_tenant() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'tenant_id is immutable on campaigns';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: fn_check_pin_rate_limit_v2(text, text, integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_check_pin_rate_limit_v2(p_protocol text, p_ip_hash text DEFAULT NULL::text, p_max_attempts integer DEFAULT 5, p_window_minutes integer DEFAULT 15, p_max_ip_attempts integer DEFAULT 20) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_proto_count  integer;
  v_ip_count     integer;
BEGIN
  -- Poda por protocolo dentro da janela (nao global)
  DELETE FROM public.complaint_pin_attempts
  WHERE protocol = p_protocol
    AND attempted_at < now() - (p_window_minutes || ' minutes')::interval;

  -- Poda global de entradas expiradas (> 24h) para prevenir crescimento ilimitado
  DELETE FROM public.complaint_pin_attempts
  WHERE id IN (
    SELECT id FROM public.complaint_pin_attempts
    WHERE attempted_at < now() - interval '24 hours'
    LIMIT 1000
  );

  -- LIMITE 1: Contar tentativas FALHAS por PROTOCOLO no periodo
  SELECT count(*) INTO v_proto_count
  FROM public.complaint_pin_attempts
  WHERE protocol = p_protocol
    AND attempted_at >= now() - (p_window_minutes || ' minutes')::interval;

  IF v_proto_count >= p_max_attempts THEN
    RETURN FALSE;
  END IF;

  -- LIMITE 2: Contar tentativas FALHAS por IP HASH no periodo
  IF p_ip_hash IS NOT NULL AND p_ip_hash != '' THEN
    SELECT count(*) INTO v_ip_count
    FROM public.complaint_pin_attempts
    WHERE ip_hash = p_ip_hash
      AND attempted_at >= now() - (p_window_minutes || ' minutes')::interval;

    IF v_ip_count >= p_max_ip_attempts THEN
      RETURN FALSE;
    END IF;
  END IF;

  -- NAO insere tentativa aqui
  -- O registro de falha e feito por fn_record_pin_failure
  RETURN TRUE;
END;
$$;


--
-- Name: fn_close_expired_assessment_cycles(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_close_expired_assessment_cycles() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$ DECLARE v_count integer; BEGIN IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF; UPDATE public.assessment_cycles SET status = 'closed', updated_at = now() WHERE status = 'active' AND ends_at <= now() AND deleted_at IS NULL; GET DIAGNOSTICS v_count = ROW_COUNT; RETURN v_count; END; $$;


--
-- Name: fn_complaints_immutable_tenant(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_complaints_immutable_tenant() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'tenant_id is immutable on complaints';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: fn_complaints_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_complaints_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: fn_create_organization_with_owner(text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_create_organization_with_owner(org_name text, org_slug text, org_cnpj text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  new_org_id UUID;
  current_user_id UUID;
BEGIN
  current_user_id := auth.uid();

  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'User must be authenticated';
  END IF;

  -- Check if user already has an organization
  IF EXISTS (
    SELECT 1 FROM organization_members
    WHERE user_id = current_user_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'User already belongs to an organization';
  END IF;

  -- Check if slug is already taken
  IF EXISTS (
    SELECT 1 FROM organizations
    WHERE slug = org_slug AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Slug already in use';
  END IF;

  -- Create the organization
  INSERT INTO organizations (name, slug, cnpj)
  VALUES (org_name, org_slug, org_cnpj)
  RETURNING id INTO new_org_id;

  -- Add the user as owner
  INSERT INTO organization_members (tenant_id, user_id, role)
  VALUES (new_org_id, current_user_id, 'owner');

  RETURN new_org_id;
END;
$$;


--
-- Name: fn_evidence_packages_immutable_sealed(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_evidence_packages_immutable_sealed() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF OLD.status IN ('sealed', 'exported') THEN
    -- Só permite transição sealed → exported
    IF NEW.status = 'exported' AND OLD.status = 'sealed' THEN
      RETURN NEW;
    END IF;
    -- Qualquer outra alteração de conteúdo é bloqueada
    IF OLD.name IS DISTINCT FROM NEW.name
       OR OLD.description IS DISTINCT FROM NEW.description
       OR OLD.period_start IS DISTINCT FROM NEW.period_start
       OR OLD.period_end IS DISTINCT FROM NEW.period_end
       OR OLD.package_hash IS DISTINCT FROM NEW.package_hash THEN
      RAISE EXCEPTION 'sealed evidence_packages are immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: fn_evidence_packages_immutable_tenant(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_evidence_packages_immutable_tenant() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'tenant_id is immutable on evidence_packages';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: fn_evidence_reports_immutable_content(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_evidence_reports_immutable_content() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF OLD.status IN ('ready', 'superseded') THEN
    IF OLD.content_snapshot IS DISTINCT FROM NEW.content_snapshot
       OR OLD.content_hash IS DISTINCT FROM NEW.content_hash
       OR OLD.file_path IS DISTINCT FROM NEW.file_path THEN
      RAISE EXCEPTION 'content is immutable after status = ready on evidence_reports';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: fn_evidence_reports_immutable_tenant(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_evidence_reports_immutable_tenant() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'tenant_id is immutable on evidence_reports';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: fn_evidence_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_evidence_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: fn_generate_evidence_report(uuid, text, text, text, uuid, timestamp with time zone, timestamp with time zone, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_generate_evidence_report(p_tenant_id uuid, p_type text, p_title text, p_source_type text, p_source_id uuid DEFAULT NULL::uuid, p_period_start timestamp with time zone DEFAULT NULL::timestamp with time zone, p_period_end timestamp with time zone DEFAULT NULL::timestamp with time zone, p_description text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$ DECLARE v_user_id uuid := auth.uid(); v_report_id uuid; v_snapshot jsonb; v_hash text; BEGIN IF v_user_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED'); END IF; IF NOT EXISTS ( SELECT 1 FROM public.organization_members om WHERE om.tenant_id = p_tenant_id AND om.user_id = v_user_id AND om.role IN ('owner', 'admin') AND om.deleted_at IS NULL ) THEN RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN'); END IF; IF p_title IS NULL OR btrim(p_title) = '' THEN RETURN jsonb_build_object('success', false, 'error', 'INVALID_TITLE'); END IF; CASE p_source_type WHEN 'campaign' THEN SELECT jsonb_build_object( 'campaign', jsonb_build_object( 'id', c.id, 'name', c.name, 'type', c.type, 'channel', c.channel, 'status', c.status, 'subject', c.subject, 'body_text', c.body_text, 'legal_basis', c.legal_basis, 'requires_acknowledgment', c.requires_acknowledgment, 'total_recipients', c.total_recipients, 'sent_at', c.sent_at, 'completed_at', c.completed_at, 'target_scope', c.target_scope ), 'stats', ( SELECT jsonb_build_object( 'total_deliveries', count(*), 'delivered', count(*) FILTER (WHERE cd.status IN ('delivered', 'read')), 'failed', count(*) FILTER (WHERE cd.status IN ('failed', 'bounced', 'rejected')), 'pending', count(*) FILTER (WHERE cd.status IN ('pending', 'queued', 'sent')) ) FROM public.campaign_deliveries cd WHERE cd.campaign_id = c.id ), 'acknowledgments', ( SELECT jsonb_build_object('total', count(*)) FROM public.campaign_acknowledgments ca WHERE ca.campaign_id = c.id ), 'generated_at', now() ) INTO v_snapshot FROM public.campaigns c WHERE c.id = p_source_id AND c.tenant_id = p_tenant_id AND c.deleted_at IS NULL; WHEN 'assessment_cycle' THEN SELECT jsonb_build_object( 'cycle', jsonb_build_object( 'id', ac.id, 'name', ac.name, 'status', ac.status, 'starts_at', ac.starts_at, 'ends_at', ac.ends_at, 'total_invited', ( SELECT count(*) FROM public.assessment_invitations ai WHERE ai.cycle_id = ac.id ), 'total_responses', ( SELECT count(*) FROM public.assessment_invitations ai WHERE ai.cycle_id = ac.id AND ai.used_at IS NOT NULL ) ), 'note', 'Respostas individuais não integram este relatório.', 'generated_at', now() ) INTO v_snapshot FROM public.assessment_cycles ac WHERE ac.id = p_source_id AND ac.tenant_id = p_tenant_id AND ac.deleted_at IS NULL; WHEN 'complaint_period' THEN IF p_period_start IS NULL OR p_period_end IS NULL OR p_period_end <= p_period_start THEN RETURN jsonb_build_object('success', false, 'error', 'INVALID_PERIOD'); END IF; SELECT jsonb_build_object( 'period', jsonb_build_object('start', p_period_start, 'end', p_period_end), 'statistics', jsonb_build_object( 'total', ( SELECT count(*) FROM public.complaints c WHERE c.tenant_id = p_tenant_id AND c.created_at >= p_period_start AND c.created_at < p_period_end AND c.deleted_at IS NULL ), 'by_status', COALESCE(( SELECT jsonb_object_agg(s.status, s.cnt) FROM ( SELECT c.status::text AS status, count(*) AS cnt FROM public.complaints c WHERE c.tenant_id = p_tenant_id AND c.created_at >= p_period_start AND c.created_at < p_period_end AND c.deleted_at IS NULL GROUP BY c.status ) s ), '{}'::jsonb), 'by_category', COALESCE(( SELECT jsonb_object_agg(s.category, s.cnt) FROM ( SELECT COALESCE(c.category, 'sem_categoria') AS category, count(*) AS cnt FROM public.complaints c WHERE c.tenant_id = p_tenant_id AND c.created_at >= p_period_start AND c.created_at < p_period_end AND c.deleted_at IS NULL GROUP BY COALESCE(c.category, 'sem_categoria') ) s ), '{}'::jsonb) ), 'note', 'O conteúdo das denúncias não integra este relatório.', 'generated_at', now() ) INTO v_snapshot; ELSE RETURN jsonb_build_object('success', false, 'error', 'INVALID_SOURCE_TYPE'); END CASE; IF v_snapshot IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'SOURCE_NOT_FOUND'); END IF; v_hash := encode(extensions.digest(convert_to(v_snapshot::text, 'UTF8'), 'sha256'), 'hex'); INSERT INTO public.evidence_reports ( tenant_id, type, title, description, status, source_type, source_id, period_start, period_end, content_snapshot, content_hash, generated_by, generated_at ) VALUES ( p_tenant_id, p_type::public.evidence_type, p_title, p_description, 'ready', p_source_type, p_source_id, p_period_start, p_period_end, v_snapshot, v_hash, v_user_id, now() ) RETURNING id INTO v_report_id; INSERT INTO public.evidence_audit_log ( tenant_id, evidence_report_id, action, actor_id, metadata ) VALUES ( p_tenant_id, v_report_id, 'generated', v_user_id, jsonb_build_object('source_type', p_source_type, 'source_id', p_source_id) ); RETURN jsonb_build_object( 'success', true, 'report_id', v_report_id, 'content_hash', v_hash ); END; $$;


--
-- Name: fn_get_campaign_stats(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_get_campaign_stats(p_campaign_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_tenant_id UUID;
  v_stats     JSONB;
  v_by_status JSONB;
  v_by_channel JSONB;
  v_total_recipients INT;
  v_total_acknowledged INT;
BEGIN
  -- 1. Verificar permissão
  SELECT c.tenant_id INTO v_tenant_id
  FROM public.campaigns c
  WHERE c.id = p_campaign_id AND c.deleted_at IS NULL;

  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'not_found');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.tenant_id = v_tenant_id
      AND om.user_id = auth.uid()
      AND om.role IN ('owner', 'admin', 'manager', 'auditor')
      AND om.deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'forbidden');
  END IF;

  -- 2. Contagem por status de delivery
  SELECT COALESCE(jsonb_object_agg(status, cnt), '{}'::jsonb)
  INTO v_by_status
  FROM (
    SELECT d.status::text AS status, count(*) AS cnt
    FROM public.campaign_deliveries d
    WHERE d.campaign_id = p_campaign_id
    GROUP BY d.status
  ) sub;

  -- 3. Contagem por canal
  SELECT COALESCE(jsonb_object_agg(channel, cnt), '{}'::jsonb)
  INTO v_by_channel
  FROM (
    SELECT d.channel::text AS channel, count(*) AS cnt
    FROM public.campaign_deliveries d
    WHERE d.campaign_id = p_campaign_id
    GROUP BY d.channel
  ) sub;

  -- 4. Total de recipients
  SELECT count(*) INTO v_total_recipients
  FROM public.campaign_recipients cr
  WHERE cr.campaign_id = p_campaign_id;

  -- 5. Total de acknowledgments
  SELECT count(*) INTO v_total_acknowledged
  FROM public.campaign_acknowledgments ca
  WHERE ca.campaign_id = p_campaign_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'total_recipients', v_total_recipients,
    'total_acknowledged', v_total_acknowledged,
    'by_status', v_by_status,
    'by_channel', v_by_channel
  );
END;
$$;


--
-- Name: fn_get_complaint_detail(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_get_complaint_detail(p_complaint_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_is_investigator BOOLEAN;
  v_is_admin        BOOLEAN;
  v_complaint       RECORD;
  v_content         RECORD;
  v_messages        JSONB;
  v_investigators   JSONB;
  v_result          JSONB;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.complaint_investigators ci
    WHERE ci.complaint_id = p_complaint_id
      AND ci.user_id = auth.uid()
      AND ci.removed_at IS NULL
  ) INTO v_is_investigator;

  SELECT EXISTS (
    SELECT 1 FROM public.complaints c
    JOIN public.organization_members om ON om.tenant_id = c.tenant_id
    WHERE c.id = p_complaint_id
      AND om.user_id = auth.uid()
      AND om.role IN ('owner', 'admin')
      AND om.deleted_at IS NULL
  ) INTO v_is_admin;

  IF NOT v_is_investigator AND NOT v_is_admin THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'forbidden');
  END IF;

  SELECT c.id, c.protocol, c.category, c.severity, c.status,
         c.is_anonymous, c.created_at, c.updated_at, c.resolved_at
  INTO v_complaint
  FROM public.complaints c
  WHERE c.id = p_complaint_id AND c.deleted_at IS NULL;

  IF v_complaint IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'not_found');
  END IF;

  v_result := jsonb_build_object(
    'success', TRUE,
    'complaint', jsonb_build_object(
      'id', v_complaint.id, 'protocol', v_complaint.protocol,
      'category', v_complaint.category, 'severity', v_complaint.severity,
      'status', v_complaint.status, 'is_anonymous', v_complaint.is_anonymous,
      'created_at', v_complaint.created_at, 'updated_at', v_complaint.updated_at,
      'resolved_at', v_complaint.resolved_at
    ),
    'is_investigator', v_is_investigator,
    'is_admin', v_is_admin
  );

  IF v_is_investigator THEN
    SELECT cc.subject, cc.description,
           cc.reporter_name, cc.reporter_email, cc.reporter_phone,
           cc.establishment_name, cc.department_name
    INTO v_content
    FROM public.complaint_contents cc
    WHERE cc.complaint_id = p_complaint_id;

    v_result := v_result || jsonb_build_object(
      'content', jsonb_build_object(
        'subject', v_content.subject, 'description', v_content.description,
        'reporter_name', v_content.reporter_name,
        'reporter_email', v_content.reporter_email,
        'reporter_phone', v_content.reporter_phone,
        'establishment_name', v_content.establishment_name,
        'department_name', v_content.department_name
      )
    );

    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', m.id, 'sender_type', m.sender_type,
        'body', m.body, 'created_at', m.created_at
      ) ORDER BY m.created_at ASC
    ), '[]'::jsonb)
    INTO v_messages
    FROM public.complaint_messages m
    WHERE m.complaint_id = p_complaint_id;

    v_result := v_result || jsonb_build_object('messages', v_messages);
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', ci.id, 'user_id', ci.user_id,
      'assigned_at', ci.assigned_at, 'removed_at', ci.removed_at,
      'name', COALESCE(p.full_name, p.email)
    )
  ), '[]'::jsonb)
  INTO v_investigators
  FROM public.complaint_investigators ci
  LEFT JOIN public.profiles p ON p.id = ci.user_id
  WHERE ci.complaint_id = p_complaint_id;

  v_result := v_result || jsonb_build_object('investigators', v_investigators);

  INSERT INTO public.complaint_audit_log (
    complaint_id, actor_id, action, details
  ) VALUES (
    p_complaint_id, auth.uid(), 'detail_viewed',
    jsonb_build_object('is_investigator', v_is_investigator, 'is_admin', v_is_admin)
  );

  RETURN v_result;
END;
$$;


--
-- Name: fn_get_complaint_list(text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_get_complaint_list(p_status text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_tenant_id    uuid;
  v_tenant_count integer;
  v_user_role    text;
  v_results      jsonb;
  v_total        bigint;
BEGIN
  SELECT count(DISTINCT om.tenant_id)
  INTO v_tenant_count
  FROM public.organization_members om
  WHERE om.user_id = auth.uid()
    AND om.deleted_at IS NULL
    AND om.role IN ('owner', 'admin', 'manager', 'investigator');

  IF v_tenant_count = 0 THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'forbidden');
  END IF;

  IF v_tenant_count > 1 THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'multi_org_ambiguous');
  END IF;

  SELECT om.tenant_id, om.role::text INTO v_tenant_id, v_user_role
  FROM public.organization_members om
  WHERE om.user_id = auth.uid()
    AND om.deleted_at IS NULL
    AND om.role IN ('owner', 'admin', 'manager', 'investigator')
  LIMIT 1;

  SELECT count(*) INTO v_total
  FROM public.complaints c
  WHERE c.tenant_id = v_tenant_id
    AND c.deleted_at IS NULL
    AND (p_status IS NULL OR c.status::text = p_status);

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', sub.id, 'protocol', sub.protocol,
      'category', sub.category, 'severity', sub.severity,
      'status', sub.status, 'is_anonymous', sub.is_anonymous,
      'created_at', sub.created_at, 'updated_at', sub.updated_at,
      'resolved_at', sub.resolved_at,
      'investigator_count', (
        SELECT count(*) FROM public.complaint_investigators ci
        WHERE ci.complaint_id = sub.id AND ci.removed_at IS NULL
      ),
      'message_count', (
        SELECT count(*) FROM public.complaint_messages cm
        WHERE cm.complaint_id = sub.id
      )
    ) ORDER BY sub.created_at DESC
  ), '[]'::jsonb)
  INTO v_results
  FROM (
    SELECT c.id, c.protocol, c.category, c.severity,
           c.status, c.is_anonymous, c.created_at, c.updated_at,
           c.resolved_at
    FROM public.complaints c
    WHERE c.tenant_id = v_tenant_id
      AND c.deleted_at IS NULL
      AND (p_status IS NULL OR c.status::text = p_status)
    ORDER BY c.created_at DESC
    LIMIT p_limit
    OFFSET p_offset
  ) sub;

  RETURN jsonb_build_object('success', TRUE, 'complaints', v_results, 'total', v_total);
END;
$$;


--
-- Name: fn_get_complaint_list(uuid, text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_get_complaint_list(p_tenant_id uuid, p_status text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_user_role TEXT;
  v_results   JSONB;
  v_total     BIGINT;
BEGIN
  SELECT om.role INTO v_user_role
  FROM public.organization_members om
  WHERE om.tenant_id = p_tenant_id
    AND om.user_id = auth.uid()
    AND om.deleted_at IS NULL
    AND om.role IN ('owner', 'admin', 'manager', 'investigator')
  LIMIT 1;

  IF v_user_role IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'forbidden');
  END IF;

  SELECT count(*) INTO v_total
  FROM public.complaints c
  WHERE c.tenant_id = p_tenant_id
    AND c.deleted_at IS NULL
    AND (p_status IS NULL OR c.status::text = p_status);

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', sub.id, 'protocol', sub.protocol,
      'category', sub.category, 'severity', sub.severity,
      'status', sub.status, 'is_anonymous', sub.is_anonymous,
      'created_at', sub.created_at, 'updated_at', sub.updated_at,
      'resolved_at', sub.resolved_at,
      'investigator_count', (
        SELECT count(*) FROM public.complaint_investigators ci
        WHERE ci.complaint_id = sub.id AND ci.removed_at IS NULL
      ),
      'message_count', (
        SELECT count(*) FROM public.complaint_messages cm
        WHERE cm.complaint_id = sub.id
      )
    ) ORDER BY sub.created_at DESC
  ), '[]'::jsonb)
  INTO v_results
  FROM (
    SELECT c.id, c.protocol, c.category, c.severity,
           c.status, c.is_anonymous, c.created_at, c.updated_at,
           c.resolved_at
    FROM public.complaints c
    WHERE c.tenant_id = p_tenant_id
      AND c.deleted_at IS NULL
      AND (p_status IS NULL OR c.status::text = p_status)
    ORDER BY c.created_at DESC
    LIMIT p_limit
    OFFSET p_offset
  ) sub;

  RETURN jsonb_build_object('success', TRUE, 'complaints', v_results, 'total', v_total);
END;
$$;


--
-- Name: fn_get_evidence_package_detail(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_get_evidence_package_detail(p_package_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_user_id       UUID;
  v_package       RECORD;
  v_computed_hash TEXT;
  v_integrity_ok  BOOLEAN;
  v_items         JSONB;
  v_hashes        TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  SELECT
    ep.id, ep.tenant_id, ep.name, ep.description,
    ep.status, ep.period_start, ep.period_end,
    ep.package_hash, ep.sealed_at, ep.sealed_by,
    ep.metadata, ep.created_by, ep.created_at
  INTO v_package
  FROM public.evidence_packages ep
  WHERE ep.id = p_package_id
    AND ep.deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.tenant_id = ep.tenant_id
        AND om.user_id = v_user_id
        AND om.role IN ('owner', 'admin', 'manager', 'auditor')
        AND om.deleted_at IS NULL
    );

  IF v_package IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND');
  END IF;

  -- Buscar itens
  SELECT jsonb_agg(
    jsonb_build_object(
      'report_id', er.id,
      'title', er.title,
      'type', er.type,
      'status', er.status,
      'content_hash', er.content_hash,
      'generated_at', er.generated_at,
      'order_index', epi.order_index
    ) ORDER BY epi.order_index, er.created_at
  )
  INTO v_items
  FROM public.evidence_package_items epi
  JOIN public.evidence_reports er ON er.id = epi.report_id
  WHERE epi.package_id = p_package_id;

  -- Verificar integridade do pacote se selado
  IF v_package.package_hash IS NOT NULL THEN
    SELECT string_agg(er.content_hash, '|' ORDER BY epi.order_index, er.created_at)
    INTO v_hashes
    FROM public.evidence_package_items epi
    JOIN public.evidence_reports er ON er.id = epi.report_id
    WHERE epi.package_id = p_package_id;

    v_computed_hash := encode(
      extensions.digest(v_hashes::bytea, 'sha256'),
      'hex'
    );
    v_integrity_ok := (v_computed_hash = v_package.package_hash);
  ELSE
    v_integrity_ok := NULL;
  END IF;

  -- Audit log
  INSERT INTO public.evidence_audit_log (
    tenant_id, evidence_package_id, action, actor_id
  ) VALUES (
    v_package.tenant_id, p_package_id, 'viewed', v_user_id
  );

  RETURN jsonb_build_object(
    'success', true,
    'package', jsonb_build_object(
      'id', v_package.id,
      'tenant_id', v_package.tenant_id,
      'name', v_package.name,
      'description', v_package.description,
      'status', v_package.status,
      'period_start', v_package.period_start,
      'period_end', v_package.period_end,
      'package_hash', v_package.package_hash,
      'sealed_at', v_package.sealed_at,
      'sealed_by', v_package.sealed_by,
      'metadata', v_package.metadata,
      'created_by', v_package.created_by,
      'created_at', v_package.created_at,
      'integrity_verified', v_integrity_ok,
      'items', COALESCE(v_items, '[]'::jsonb)
    )
  );
END;
$$;


--
-- Name: fn_get_evidence_report_detail(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_get_evidence_report_detail(p_report_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_user_id     UUID;
  v_report      RECORD;
  v_computed_hash TEXT;
  v_integrity_ok BOOLEAN;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  -- Buscar relatório com autorização via RLS natural (authenticated)
  SELECT
    er.id, er.tenant_id, er.type, er.title, er.description,
    er.status, er.version, er.previous_version_id,
    er.source_type, er.source_id,
    er.period_start, er.period_end,
    er.content_snapshot, er.content_hash,
    er.file_path, er.file_size_bytes, er.file_hash,
    er.disclaimer, er.metadata,
    er.generated_by, er.generated_at,
    er.created_at
  INTO v_report
  FROM public.evidence_reports er
  WHERE er.id = p_report_id
    AND er.deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.tenant_id = er.tenant_id
        AND om.user_id = v_user_id
        AND om.role IN ('owner', 'admin', 'manager', 'auditor')
        AND om.deleted_at IS NULL
    );

  IF v_report IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND');
  END IF;

  -- Verificar integridade do hash
  IF v_report.content_hash IS NOT NULL THEN
    v_computed_hash := encode(
      extensions.digest(v_report.content_snapshot::text::bytea, 'sha256'),
      'hex'
    );
    v_integrity_ok := (v_computed_hash = v_report.content_hash);
  ELSE
    v_integrity_ok := NULL;
  END IF;

  -- Registrar visualização no audit log
  INSERT INTO public.evidence_audit_log (
    tenant_id, evidence_report_id, action, actor_id
  ) VALUES (
    v_report.tenant_id, p_report_id, 'viewed', v_user_id
  );

  RETURN jsonb_build_object(
    'success', true,
    'report', jsonb_build_object(
      'id', v_report.id,
      'tenant_id', v_report.tenant_id,
      'type', v_report.type,
      'title', v_report.title,
      'description', v_report.description,
      'status', v_report.status,
      'version', v_report.version,
      'previous_version_id', v_report.previous_version_id,
      'source_type', v_report.source_type,
      'source_id', v_report.source_id,
      'period_start', v_report.period_start,
      'period_end', v_report.period_end,
      'content_snapshot', v_report.content_snapshot,
      'content_hash', v_report.content_hash,
      'file_path', v_report.file_path,
      'file_size_bytes', v_report.file_size_bytes,
      'file_hash', v_report.file_hash,
      'disclaimer', v_report.disclaimer,
      'metadata', v_report.metadata,
      'generated_by', v_report.generated_by,
      'generated_at', v_report.generated_at,
      'created_at', v_report.created_at,
      'integrity_verified', v_integrity_ok
    )
  );
END;
$$;


--
-- Name: fn_get_questionnaire_for_token(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_get_questionnaire_for_token(p_token text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$ DECLARE v_invitation record; v_cycle record; v_template record; v_sections jsonb; v_token_hash text; BEGIN IF p_token IS NULL OR length(p_token) < 16 THEN RETURN jsonb_build_object('valid', false, 'error', 'invalid_or_expired'); END IF; v_token_hash := encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex'); SELECT ai.id, ai.cycle_id, ai.used_at, ai.expires_at INTO v_invitation FROM public.assessment_invitations ai WHERE ai.token_hash = v_token_hash OR (ai.token_hash IS NULL AND ai.token = p_token) LIMIT 1; IF v_invitation IS NULL OR v_invitation.used_at IS NOT NULL OR (v_invitation.expires_at IS NOT NULL AND v_invitation.expires_at <= now()) THEN RETURN jsonb_build_object('valid', false, 'error', 'invalid_or_expired'); END IF; SELECT ac.id, ac.status, ac.questionnaire_template_id, ac.ends_at INTO v_cycle FROM public.assessment_cycles ac WHERE ac.id = v_invitation.cycle_id AND ac.deleted_at IS NULL; IF v_cycle IS NULL OR v_cycle.status <> 'active' OR v_cycle.ends_at <= now() THEN RETURN jsonb_build_object('valid', false, 'error', 'invalid_or_expired'); END IF; SELECT qt.name, qt.description, qt.response_scale INTO v_template FROM public.questionnaire_templates qt WHERE qt.id = v_cycle.questionnaire_template_id AND qt.deleted_at IS NULL; SELECT COALESCE(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'description', s.description, 'dimension_code', s.dimension_code, 'items', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', i.id, 'text', i.text, 'help_text', i.help_text, 'required', i.required) ORDER BY i.display_order), '[]'::jsonb) FROM public.questionnaire_items i WHERE i.section_id = s.id)) ORDER BY s.display_order), '[]'::jsonb) INTO v_sections FROM public.questionnaire_sections s WHERE s.template_id = v_cycle.questionnaire_template_id; RETURN jsonb_build_object('valid', true, 'template', jsonb_build_object('name', v_template.name, 'description', v_template.description, 'response_scale', v_template.response_scale), 'sections', v_sections); END; $$;


--
-- Name: fn_get_risk_detail(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_get_risk_detail(p_risk_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_tenant_id UUID; v_risk RECORD; v_actions JSONB; v_reviews JSONB; v_audit JSONB;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM public.organization_members
    WHERE user_id = auth.uid() AND role IN ('owner','admin','manager','investigator','auditor')
      AND deleted_at IS NULL LIMIT 1;
  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'permission_denied');
  END IF;

  SELECT ri.*, ac.name AS cycle_name, qs.name AS section_name, qs.dimension_code,
    e.name AS establishment_name, d.name AS department_name
  INTO v_risk FROM public.risk_items ri
  LEFT JOIN public.assessment_cycles ac ON ac.id = ri.cycle_id
  LEFT JOIN public.questionnaire_sections qs ON qs.id = ri.section_id
  LEFT JOIN public.establishments e ON e.id = ri.establishment_id
  LEFT JOIN public.departments d ON d.id = ri.department_id
  WHERE ri.id = p_risk_id AND ri.tenant_id = v_tenant_id AND ri.deleted_at IS NULL;

  IF v_risk IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', ap.id, 'title', ap.title, 'description', ap.description,
    'control_level', ap.control_level, 'responsible_name', COALESCE(p.full_name, 'Não atribuído'),
    'responsible_user_id', ap.responsible_user_id, 'due_date', ap.due_date,
    'status', ap.status, 'completed_at', ap.completed_at, 'notes', ap.notes, 'created_at', ap.created_at
  ) ORDER BY ap.created_at), '[]'::jsonb) INTO v_actions
  FROM public.risk_action_plans ap LEFT JOIN public.profiles p ON p.id = ap.responsible_user_id
  WHERE ap.risk_item_id = p_risk_id AND ap.deleted_at IS NULL;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', rr.id, 'reviewer_name', COALESCE(p.full_name, 'Desconhecido'),
    'review_date', rr.review_date, 'new_risk_level', rr.new_risk_level,
    'new_score', rr.new_score, 'assessment_method', rr.assessment_method,
    'findings', rr.findings, 'recommendation', rr.recommendation, 'created_at', rr.created_at
  ) ORDER BY rr.review_date DESC), '[]'::jsonb) INTO v_reviews
  FROM public.risk_reviews rr LEFT JOIN public.profiles p ON p.id = rr.reviewer_id
  WHERE rr.risk_item_id = p_risk_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'action', al.action, 'actor_name', COALESCE(p.full_name, 'Sistema'),
    'details', al.details, 'created_at', al.created_at
  ) ORDER BY al.created_at DESC), '[]'::jsonb) INTO v_audit
  FROM (SELECT * FROM public.risk_audit_log WHERE risk_item_id = p_risk_id ORDER BY created_at DESC LIMIT 20) al
  LEFT JOIN public.profiles p ON p.id = al.actor_id;

  RETURN jsonb_build_object('success', true,
    'risk', jsonb_build_object(
      'id', v_risk.id, 'title', v_risk.title, 'description', v_risk.description,
      'source', v_risk.source, 'category', v_risk.category,
      'initial_risk_level', v_risk.initial_risk_level, 'residual_risk_level', v_risk.residual_risk_level,
      'initial_score', v_risk.initial_score, 'status', v_risk.status, 'priority', v_risk.priority,
      'cycle_name', v_risk.cycle_name, 'section_name', v_risk.section_name,
      'dimension_code', v_risk.dimension_code, 'establishment_name', v_risk.establishment_name,
      'department_name', v_risk.department_name, 'affected_group', v_risk.affected_group,
      'identified_at', v_risk.identified_at, 'created_at', v_risk.created_at),
    'actions', v_actions, 'reviews', v_reviews, 'audit_log', v_audit);
END;
$$;


--
-- Name: fn_get_risk_inventory_summary(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_get_risk_inventory_summary() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_tenant_id UUID; v_total INT; v_by_level JSONB; v_by_status JSONB;
  v_by_category JSONB; v_actions_overdue INT; v_actions_pending INT;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM public.organization_members
    WHERE user_id = auth.uid() AND role IN ('owner','admin','manager','investigator','auditor')
      AND deleted_at IS NULL LIMIT 1;
  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'permission_denied');
  END IF;

  SELECT count(*) INTO v_total FROM public.risk_items WHERE tenant_id = v_tenant_id AND deleted_at IS NULL;

  SELECT COALESCE(jsonb_object_agg(level, cnt), '{}'::jsonb) INTO v_by_level FROM (
    SELECT initial_risk_level::text AS level, count(*) AS cnt FROM public.risk_items
    WHERE tenant_id = v_tenant_id AND deleted_at IS NULL GROUP BY initial_risk_level) sub;

  SELECT COALESCE(jsonb_object_agg(st, cnt), '{}'::jsonb) INTO v_by_status FROM (
    SELECT status::text AS st, count(*) AS cnt FROM public.risk_items
    WHERE tenant_id = v_tenant_id AND deleted_at IS NULL GROUP BY status) sub;

  SELECT COALESCE(jsonb_object_agg(cat, cnt), '{}'::jsonb) INTO v_by_category FROM (
    SELECT category::text AS cat, count(*) AS cnt FROM public.risk_items
    WHERE tenant_id = v_tenant_id AND deleted_at IS NULL GROUP BY category) sub;

  SELECT count(*) INTO v_actions_overdue FROM public.risk_action_plans
    WHERE tenant_id = v_tenant_id AND deleted_at IS NULL AND status IN ('planned','in_progress') AND due_date < CURRENT_DATE;

  SELECT count(*) INTO v_actions_pending FROM public.risk_action_plans
    WHERE tenant_id = v_tenant_id AND deleted_at IS NULL AND status IN ('planned','in_progress');

  RETURN jsonb_build_object('success', true, 'total', v_total, 'by_level', v_by_level,
    'by_status', v_by_status, 'by_category', v_by_category,
    'actions_overdue', v_actions_overdue, 'actions_pending', v_actions_pending);
END;
$$;


--
-- Name: fn_handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.email, '')
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
    email = COALESCE(EXCLUDED.email, public.profiles.email);

  RETURN NEW;
END;
$$;


--
-- Name: fn_import_risks_from_cycle(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_import_risks_from_cycle(p_cycle_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$ DECLARE v_user_id uuid := auth.uid(); v_cycle record; v_dim record; v_risk_level public.risk_level; v_risk_id uuid; v_count int := 0; v_skipped int := 0; BEGIN SELECT ac.id, ac.tenant_id, ac.name, ac.status, ac.min_respondents_threshold INTO v_cycle FROM public.assessment_cycles ac WHERE ac.id = p_cycle_id AND ac.deleted_at IS NULL; IF v_user_id IS NULL OR v_cycle IS NULL OR NOT EXISTS (SELECT 1 FROM public.organization_members om WHERE om.tenant_id = v_cycle.tenant_id AND om.user_id = v_user_id AND om.role IN ('owner','admin','manager') AND om.deleted_at IS NULL) THEN RETURN jsonb_build_object('success', false, 'error', 'permission_denied'); END IF; FOR v_dim IN SELECT qs.id AS section_id, qs.name AS section_name, count(DISTINCT ar.submission_batch_id) AS respondent_count, avg(CASE WHEN qi.reverse_scored THEN 6 - ar.value ELSE ar.value END) AS avg_score FROM public.assessment_responses ar JOIN public.questionnaire_items qi ON qi.id = ar.item_id JOIN public.questionnaire_sections qs ON qs.id = qi.section_id WHERE ar.cycle_id = p_cycle_id AND ar.tenant_id = v_cycle.tenant_id GROUP BY qs.id, qs.name LOOP IF v_dim.respondent_count < v_cycle.min_respondents_threshold OR v_dim.avg_score IS NULL THEN v_skipped := v_skipped + 1; CONTINUE; END IF; IF v_dim.avg_score <= 2 THEN v_risk_level := 'low'; ELSIF v_dim.avg_score <= 3 THEN v_risk_level := 'moderate'; ELSIF v_dim.avg_score <= 4 THEN v_risk_level := 'high'; ELSE v_risk_level := 'critical'; END IF; IF v_risk_level NOT IN ('high','critical') OR EXISTS (SELECT 1 FROM public.risk_items ri WHERE ri.cycle_id = p_cycle_id AND ri.section_id = v_dim.section_id AND ri.tenant_id = v_cycle.tenant_id AND ri.deleted_at IS NULL) THEN v_skipped := v_skipped + 1; CONTINUE; END IF; INSERT INTO public.risk_items (tenant_id, cycle_id, section_id, source, category, title, description, initial_risk_level, initial_score, status, priority, identified_by) VALUES (v_cycle.tenant_id, p_cycle_id, v_dim.section_id, 'assessment', 'psychosocial', 'Risco psicossocial: ' || v_dim.section_name, 'Risco identificado a partir do ciclo "' || v_cycle.name || '". Pontuação agregada: ' || round(v_dim.avg_score, 2) || '/5.', v_risk_level, round(v_dim.avg_score, 2), 'identified', CASE WHEN v_risk_level = 'critical' THEN 'urgent' ELSE 'high' END, v_user_id) RETURNING id INTO v_risk_id; INSERT INTO public.risk_audit_log (risk_item_id, actor_id, action, details) VALUES (v_risk_id, v_user_id, 'imported_from_assessment', jsonb_build_object('cycle_id', p_cycle_id, 'section_name', v_dim.section_name, 'avg_score', round(v_dim.avg_score, 2), 'risk_level', v_risk_level::text, 'anonymous_batches', true)); v_count := v_count + 1; END LOOP; RETURN jsonb_build_object('success', true, 'imported', v_count, 'skipped', v_skipped, 'cycle_name', v_cycle.name); END; $$;


--
-- Name: fn_is_assigned_investigator(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_is_assigned_investigator(p_complaint_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.complaint_investigators
    WHERE complaint_id = p_complaint_id
      AND user_id = auth.uid()
      AND removed_at IS NULL
  );
$$;


--
-- Name: fn_is_complaint_tenant_admin(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_is_complaint_tenant_admin(p_complaint_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.complaints c
    JOIN public.organization_members om ON om.tenant_id = c.tenant_id
    WHERE c.id = p_complaint_id
      AND om.user_id = auth.uid()
      AND om.role IN ('owner', 'admin')
      AND om.deleted_at IS NULL
      AND c.deleted_at IS NULL
  );
$$;


--
-- Name: fn_prepare_campaign_send(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_prepare_campaign_send(p_campaign_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_campaign       record;
  v_count          int := 0;
  v_delivery_count int := 0;
  v_lock_key       bigint;
  v_scope_keys     text[];
  v_valid_keys     text[] := ARRAY['establishment_ids', 'department_ids'];
  v_key            text;
  v_id_text        text;
  v_id_uuid        uuid;
  v_invalid_ids    text[];
BEGIN
  v_lock_key := ('x' || left(replace(p_campaign_id::text, '-', ''), 15))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT c.id, c.tenant_id, c.status, c.channel, c.target_scope
  INTO v_campaign
  FROM public.campaigns c
  WHERE c.id = p_campaign_id AND c.deleted_at IS NULL;

  IF v_campaign IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'campaign_not_found');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.tenant_id = v_campaign.tenant_id
      AND om.user_id = auth.uid()
      AND om.role IN ('owner', 'admin', 'manager')
      AND om.deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'forbidden');
  END IF;

  IF v_campaign.status NOT IN ('draft', 'scheduled') THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_status');
  END IF;

  -- Validar target_scope keys
  IF v_campaign.target_scope IS NOT NULL THEN
    SELECT array_agg(k) INTO v_scope_keys
    FROM jsonb_object_keys(v_campaign.target_scope) k;

    IF v_scope_keys IS NOT NULL THEN
      FOREACH v_key IN ARRAY v_scope_keys
      LOOP
        IF NOT (v_key = ANY(v_valid_keys)) THEN
          RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_target_scope_key',
                                   'detail', 'Unknown key: ' || v_key);
        END IF;
      END LOOP;
    END IF;

    -- Validar jsonb_typeof ANTES de jsonb_array_elements_text
    IF v_campaign.target_scope->'establishment_ids' IS NOT NULL THEN
      IF jsonb_typeof(v_campaign.target_scope->'establishment_ids') != 'array' THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_target_scope_format',
                                 'detail', 'establishment_ids must be a JSON array');
      END IF;

      v_invalid_ids := ARRAY[]::text[];
      FOR v_id_text IN SELECT jsonb_array_elements_text(v_campaign.target_scope->'establishment_ids')
      LOOP
        BEGIN
          v_id_uuid := v_id_text::uuid;
          IF NOT EXISTS (
            SELECT 1 FROM public.establishments
            WHERE id = v_id_uuid
              AND tenant_id = v_campaign.tenant_id
              AND deleted_at IS NULL
          ) THEN
            v_invalid_ids := v_invalid_ids || v_id_text;
          END IF;
        EXCEPTION WHEN invalid_text_representation THEN
          v_invalid_ids := v_invalid_ids || v_id_text;
        END;
      END LOOP;
      IF array_length(v_invalid_ids, 1) > 0 THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_establishment_ids',
                                 'detail', array_to_string(v_invalid_ids, ', '));
      END IF;
    END IF;

    IF v_campaign.target_scope->'department_ids' IS NOT NULL THEN
      IF jsonb_typeof(v_campaign.target_scope->'department_ids') != 'array' THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_target_scope_format',
                                 'detail', 'department_ids must be a JSON array');
      END IF;

      v_invalid_ids := ARRAY[]::text[];
      FOR v_id_text IN SELECT jsonb_array_elements_text(v_campaign.target_scope->'department_ids')
      LOOP
        BEGIN
          v_id_uuid := v_id_text::uuid;
          IF NOT EXISTS (
            SELECT 1 FROM public.departments
            WHERE id = v_id_uuid
              AND tenant_id = v_campaign.tenant_id
              AND deleted_at IS NULL
          ) THEN
            v_invalid_ids := v_invalid_ids || v_id_text;
          END IF;
        EXCEPTION WHEN invalid_text_representation THEN
          v_invalid_ids := v_invalid_ids || v_id_text;
        END;
      END LOOP;
      IF array_length(v_invalid_ids, 1) > 0 THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_department_ids',
                                 'detail', array_to_string(v_invalid_ids, ', '));
      END IF;
    END IF;
  END IF;

  -- Popular recipients (idempotent)
  IF NOT EXISTS (SELECT 1 FROM public.campaign_recipients WHERE campaign_id = p_campaign_id LIMIT 1) THEN
    INSERT INTO public.campaign_recipients (
      campaign_id, tenant_id, user_id,
      full_name, email, phone,
      establishment_id, department_id,
      channel
    )
    SELECT
      p_campaign_id,
      ep.tenant_id,
      ep.user_id,
      ep.full_name,
      ep.email,
      ep.phone,
      ep.establishment_id,
      ep.department_id,
      v_campaign.channel
    FROM public.employee_profiles ep
    WHERE ep.tenant_id = v_campaign.tenant_id
      AND ep.deleted_at IS NULL
      AND ep.status = 'active'
      AND (
        CASE v_campaign.channel
          WHEN 'email' THEN ep.email IS NOT NULL
          WHEN 'whatsapp' THEN ep.phone IS NOT NULL
          WHEN 'both' THEN ep.email IS NOT NULL OR ep.phone IS NOT NULL
          ELSE FALSE
        END
      )
      AND (
        v_campaign.target_scope IS NULL
        OR (
          (v_campaign.target_scope->>'establishment_ids' IS NULL
           OR ep.establishment_id::text IN (
             SELECT jsonb_array_elements_text(v_campaign.target_scope->'establishment_ids')
           ))
          AND
          (v_campaign.target_scope->>'department_ids' IS NULL
           OR ep.department_id::text IN (
             SELECT jsonb_array_elements_text(v_campaign.target_scope->'department_ids')
           ))
        )
      )
    ON CONFLICT DO NOTHING;
  END IF;

  -- Deliveries (email) com dedup por email normalizado
  INSERT INTO public.campaign_deliveries (
    campaign_id, recipient_id, channel, status
  )
  SELECT DISTINCT ON (lower(trim(cr.email)))
    cr.campaign_id,
    cr.id,
    'email'::public.delivery_channel,
    'pending'::public.delivery_status
  FROM public.campaign_recipients cr
  WHERE cr.campaign_id = p_campaign_id
    AND cr.channel IN ('email', 'both')
    AND cr.email IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.campaign_deliveries cd
      WHERE cd.recipient_id = cr.id
        AND cd.channel = 'email'
    )
  ORDER BY lower(trim(cr.email)), cr.created_at;

  -- Deliveries (whatsapp) com dedup por telefone normalizado
  INSERT INTO public.campaign_deliveries (
    campaign_id, recipient_id, channel, status
  )
  SELECT DISTINCT ON (regexp_replace(cr.phone, '[^0-9+]', '', 'g'))
    cr.campaign_id,
    cr.id,
    'whatsapp'::public.delivery_channel,
    'pending'::public.delivery_status
  FROM public.campaign_recipients cr
  WHERE cr.campaign_id = p_campaign_id
    AND cr.channel IN ('whatsapp', 'both')
    AND cr.phone IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.campaign_deliveries cd
      WHERE cd.recipient_id = cr.id AND cd.channel = 'whatsapp'
    )
  ORDER BY regexp_replace(cr.phone, '[^0-9+]', '', 'g'), cr.created_at;

  -- Contar DELIVERIES para determinar sucesso
  SELECT count(*) INTO v_delivery_count
  FROM public.campaign_deliveries WHERE campaign_id = p_campaign_id;

  SELECT count(*) INTO v_count
  FROM public.campaign_recipients WHERE campaign_id = p_campaign_id;

  IF v_delivery_count = 0 THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'error', 'no_deliveries',
      'total_recipients', v_count,
      'total_deliveries', 0
    );
  END IF;

  UPDATE public.campaigns
  SET status = 'sending',
      sent_at = now(),
      total_recipients = v_count
  WHERE id = p_campaign_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'total_recipients', v_count,
    'total_deliveries', v_delivery_count
  );
END;
$$;


--
-- Name: fn_process_webhook_event(text, text, text, text, text, text, text, timestamp with time zone, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_process_webhook_event(p_provider text, p_event_id text, p_provider_message_id text, p_event_type text, p_new_status text, p_error_code text DEFAULT NULL::text, p_error_message text DEFAULT NULL::text, p_timestamp timestamp with time zone DEFAULT now(), p_metadata jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_delivery      record;
  v_status_order  text[] := ARRAY['pending', 'queued', 'sent', 'delivered', 'read'];
  v_terminal      text[] := ARRAY['failed', 'bounced', 'rejected'];
  v_current_idx   int;
  v_new_idx       int;
  v_is_terminal   boolean;
  v_webhook_id    uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.webhook_events
    WHERE event_id = p_event_id
  ) THEN
    RETURN jsonb_build_object('success', TRUE, 'skipped', TRUE, 'reason', 'duplicate_event');
  END IF;

  IF p_new_status IS NULL THEN
    RETURN jsonb_build_object('success', TRUE, 'skipped', TRUE, 'reason', 'unknown_event_type');
  END IF;

  SELECT d.id, d.campaign_id, d.status::text AS status
  INTO v_delivery
  FROM public.campaign_deliveries d
  WHERE d.provider_id = p_provider_message_id
  LIMIT 1
  FOR UPDATE;

  IF v_delivery IS NULL THEN
    INSERT INTO public.webhook_events (
      provider, event_id, provider_message_id, event_type,
      delivery_id, campaign_id, payload, received_at
    ) VALUES (
      p_provider, p_event_id, p_provider_message_id, p_event_type,
      NULL, NULL, p_metadata, p_timestamp
    ) ON CONFLICT (event_id) DO NOTHING;

    RETURN jsonb_build_object('success', TRUE, 'skipped', TRUE, 'reason', 'delivery_not_found');
  END IF;

  v_current_idx := array_position(v_status_order, v_delivery.status);
  v_new_idx := array_position(v_status_order, p_new_status);
  v_is_terminal := p_new_status = ANY(v_terminal);

  IF v_is_terminal OR (v_new_idx IS NOT NULL AND (v_current_idx IS NULL OR v_new_idx > v_current_idx)) THEN
    UPDATE public.campaign_deliveries
    SET status = p_new_status::public.delivery_status,
        delivered_at = CASE WHEN p_new_status = 'delivered' AND delivered_at IS NULL THEN p_timestamp ELSE delivered_at END,
        read_at = CASE WHEN p_new_status = 'read' AND read_at IS NULL THEN p_timestamp ELSE read_at END,
        failed_at = CASE WHEN p_new_status = ANY(v_terminal) AND failed_at IS NULL THEN p_timestamp ELSE failed_at END,
        error_code = CASE WHEN p_new_status = ANY(v_terminal) THEN COALESCE(p_error_code, error_code) ELSE error_code END,
        error_message = CASE WHEN p_new_status = ANY(v_terminal) THEN COALESCE(p_error_message, error_message) ELSE error_message END,
        updated_at = now()
    WHERE id = v_delivery.id;
  END IF;

  INSERT INTO public.webhook_events (
    provider, event_id, provider_message_id, event_type,
    delivery_id, campaign_id, payload, received_at
  ) VALUES (
    p_provider, p_event_id, p_provider_message_id, p_event_type,
    v_delivery.id, v_delivery.campaign_id,
    p_metadata,
    p_timestamp
  ) ON CONFLICT (event_id) DO NOTHING;

  IF NOT EXISTS (
    SELECT 1 FROM public.campaign_deliveries d
    WHERE d.campaign_id = v_delivery.campaign_id
      AND d.status IN ('pending', 'queued', 'sent')
  ) THEN
    UPDATE public.campaigns
    SET status = 'sent',
        completed_at = now()
    WHERE id = v_delivery.campaign_id
      AND status = 'sending';
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'delivery_id', v_delivery.id,
    'old_status', v_delivery.status,
    'new_status', p_new_status
  );
END;
$$;


--
-- Name: fn_record_delivery_event(uuid, text, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_record_delivery_event(p_delivery_id uuid, p_new_status text, p_provider_id text DEFAULT NULL::text, p_error_code text DEFAULT NULL::text, p_error_message text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_current_status TEXT;
  v_campaign_id    UUID;
BEGIN
  -- 1. Buscar delivery atual
  SELECT d.status::text, d.campaign_id
  INTO v_current_status, v_campaign_id
  FROM public.campaign_deliveries d
  WHERE d.id = p_delivery_id;

  IF v_current_status IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'delivery_not_found');
  END IF;

  -- 2. Idempotência: não regredir status
  -- Ordem de progresso: pending → queued → sent → delivered → read
  -- Estados terminais: failed, bounced, rejected
  IF v_current_status IN ('delivered', 'read') AND p_new_status IN ('pending', 'queued', 'sent') THEN
    -- Não regredir
    RETURN jsonb_build_object('success', TRUE, 'skipped', TRUE, 'reason', 'status_already_advanced');
  END IF;

  -- 3. Atualizar delivery
  UPDATE public.campaign_deliveries
  SET status = p_new_status::public.delivery_status,
      provider_id = COALESCE(p_provider_id, provider_id),
      queued_at = CASE WHEN p_new_status = 'queued' AND queued_at IS NULL THEN now() ELSE queued_at END,
      sent_at = CASE WHEN p_new_status = 'sent' AND sent_at IS NULL THEN now() ELSE sent_at END,
      delivered_at = CASE WHEN p_new_status = 'delivered' AND delivered_at IS NULL THEN now() ELSE delivered_at END,
      read_at = CASE WHEN p_new_status = 'read' AND read_at IS NULL THEN now() ELSE read_at END,
      failed_at = CASE WHEN p_new_status IN ('failed', 'bounced', 'rejected') AND failed_at IS NULL THEN now() ELSE failed_at END,
      error_code = COALESCE(p_error_code, error_code),
      error_message = COALESCE(p_error_message, error_message)
  WHERE id = p_delivery_id;

  -- 4. Verificar se todas as deliveries da campanha estão finalizadas
  IF NOT EXISTS (
    SELECT 1 FROM public.campaign_deliveries d
    WHERE d.campaign_id = v_campaign_id
      AND d.status IN ('pending', 'queued', 'sent')
  ) THEN
    -- Todas finalizadas → marcar campanha como sent
    UPDATE public.campaigns
    SET status = 'sent',
        completed_at = now()
    WHERE id = v_campaign_id
      AND status = 'sending';
  END IF;

  RETURN jsonb_build_object('success', TRUE, 'old_status', v_current_status, 'new_status', p_new_status);
END;
$$;


--
-- Name: fn_record_pin_failure(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_record_pin_failure(p_protocol text, p_ip_hash text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  INSERT INTO public.complaint_pin_attempts (protocol, ip_hash)
  VALUES (p_protocol, p_ip_hash);
END;
$$;


--
-- Name: fn_remove_member(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_remove_member(p_member_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_caller_id      uuid;
  v_caller_role    text;
  v_target_tenant  uuid;
  v_target         record;
  v_owner_count    integer;
  v_lock_key       bigint;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'unauthenticated');
  END IF;

  SELECT om.tenant_id INTO v_target_tenant
  FROM public.organization_members om
  WHERE om.id = p_member_id;

  IF v_target_tenant IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'member_not_found');
  END IF;

  v_lock_key := ('x' || left(replace(v_target_tenant::text, '-', ''), 15))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT om.id, om.user_id, om.tenant_id, om.role::text AS role, om.deleted_at
  INTO v_target
  FROM public.organization_members om
  WHERE om.id = p_member_id
  FOR UPDATE;

  IF v_target IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'member_not_found');
  END IF;

  IF v_target.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'already_removed');
  END IF;

  SELECT om.role::text INTO v_caller_role
  FROM public.organization_members om
  WHERE om.user_id = v_caller_id
    AND om.tenant_id = v_target.tenant_id
    AND om.deleted_at IS NULL;

  IF v_caller_role IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'member_not_found');
  END IF;

  IF v_target.user_id = v_caller_id THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'cannot_remove_self');
  END IF;

  IF v_caller_role = 'owner' THEN
    NULL;
  ELSIF v_caller_role = 'admin' THEN
    IF v_target.role IN ('owner', 'admin') THEN
      RETURN jsonb_build_object('success', FALSE, 'error', 'insufficient_privileges');
    END IF;
  ELSE
    RETURN jsonb_build_object('success', FALSE, 'error', 'forbidden');
  END IF;

  IF v_target.role = 'owner' THEN
    SELECT count(*) INTO v_owner_count
    FROM public.organization_members om
    WHERE om.tenant_id = v_target.tenant_id
      AND om.role = 'owner'
      AND om.deleted_at IS NULL;

    IF v_owner_count <= 1 THEN
      RETURN jsonb_build_object('success', FALSE, 'error', 'last_owner_cannot_be_removed');
    END IF;
  END IF;

  UPDATE public.organization_members
  SET deleted_at = now(),
      updated_at = now()
  WHERE id = p_member_id;

  INSERT INTO public.organization_audit_log (
    tenant_id, actor_id, action, target_type, target_id, details
  ) VALUES (
    v_target.tenant_id,
    v_caller_id,
    'member_removed',
    'member',
    p_member_id,
    jsonb_build_object(
      'removed_user_id', v_target.user_id,
      'removed_role', v_target.role
    )
  );

  RETURN jsonb_build_object('success', TRUE);
END;
$$;


--
-- Name: fn_resolve_tenant_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_resolve_tenant_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT tenant_id
  FROM organization_members
  WHERE user_id = auth.uid()
    AND deleted_at IS NULL
  LIMIT 1;
$$;


--
-- Name: fn_risk_items_immutable_tenant(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_risk_items_immutable_tenant() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'tenant_id is immutable';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: fn_seal_evidence_package(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_seal_evidence_package(p_package_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_user_id       UUID;
  v_tenant_id     UUID;
  v_package_status TEXT;
  v_hashes        TEXT;
  v_package_hash  TEXT;
  v_item_count    INT;
  v_member_role   TEXT;
BEGIN
  -- 1. Autenticação
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  -- 2. Buscar pacote
  SELECT ep.tenant_id, ep.status::text
  INTO v_tenant_id, v_package_status
  FROM public.evidence_packages ep
  WHERE ep.id = p_package_id
    AND ep.deleted_at IS NULL;

  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'PACKAGE_NOT_FOUND');
  END IF;

  IF v_package_status != 'draft' THEN
    RETURN jsonb_build_object('success', false, 'error', 'PACKAGE_ALREADY_SEALED');
  END IF;

  -- 3. Autorização
  SELECT om.role INTO v_member_role
  FROM public.organization_members om
  WHERE om.tenant_id = v_tenant_id
    AND om.user_id = v_user_id
    AND om.deleted_at IS NULL
  LIMIT 1;

  IF v_member_role IS NULL OR v_member_role NOT IN ('owner', 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN');
  END IF;

  -- 4. Verificar que o pacote tem itens
  SELECT count(*) INTO v_item_count
  FROM public.evidence_package_items epi
  WHERE epi.package_id = p_package_id;

  IF v_item_count = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'PACKAGE_EMPTY');
  END IF;

  -- 5. Verificar que todos os relatórios estão 'ready'
  IF EXISTS (
    SELECT 1
    FROM public.evidence_package_items epi
    JOIN public.evidence_reports er ON er.id = epi.report_id
    WHERE epi.package_id = p_package_id
      AND er.status != 'ready'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'REPORTS_NOT_READY');
  END IF;

  -- 6. Calcular hash do pacote (concatenação ordenada dos hashes)
  SELECT string_agg(er.content_hash, '|' ORDER BY epi.order_index, er.created_at)
  INTO v_hashes
  FROM public.evidence_package_items epi
  JOIN public.evidence_reports er ON er.id = epi.report_id
  WHERE epi.package_id = p_package_id;

  v_package_hash := encode(
    extensions.digest(v_hashes::bytea, 'sha256'),
    'hex'
  );

  -- 7. Selar o pacote
  UPDATE public.evidence_packages
  SET status = 'sealed',
      package_hash = v_package_hash,
      sealed_at = now(),
      sealed_by = v_user_id
  WHERE id = p_package_id;

  -- 8. Audit log
  INSERT INTO public.evidence_audit_log (
    tenant_id, evidence_package_id, action, actor_id,
    metadata
  ) VALUES (
    v_tenant_id, p_package_id, 'package_sealed', v_user_id,
    jsonb_build_object('item_count', v_item_count, 'package_hash', v_package_hash)
  );

  RETURN jsonb_build_object(
    'success', true,
    'package_hash', v_package_hash,
    'item_count', v_item_count
  );
END;
$$;


--
-- Name: fn_send_reporter_message_v2(text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_send_reporter_message_v2(p_protocol text, p_pin_hash text, p_body text, p_caller_ip_hash text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE
  v_complaint  record;
  v_message_id uuid;
  v_rate_ok    boolean;
  v_new_bcrypt text;
BEGIN
  -- 1. Verificar rate limit (dual: protocolo + ip_hash)
  SELECT public.fn_check_pin_rate_limit_v2(p_protocol, p_caller_ip_hash) INTO v_rate_ok;
  IF NOT v_rate_ok THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'rate_limited');
  END IF;

  -- 2. Buscar denuncia
  SELECT c.id, c.status::text AS status, c.pin_hash
  INTO v_complaint
  FROM public.complaints c
  WHERE c.protocol = p_protocol;

  -- Dummy bcrypt anti-enumeracao quando protocolo nao existe
  IF v_complaint IS NULL THEN
    PERFORM extensions.crypt('dummy-constant-time', extensions.gen_salt('bf', 10));
    PERFORM public.fn_record_pin_failure(p_protocol, p_caller_ip_hash);
    RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_credentials');
  END IF;

  -- 3. Verificar PIN
  IF NOT public.fn_verify_complaint_pin(v_complaint.pin_hash, p_pin_hash) THEN
    PERFORM public.fn_record_pin_failure(p_protocol, p_caller_ip_hash);
    RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_credentials');
  END IF;

  -- 4. Rehash legado para bcrypt (PIN correto)
  IF v_complaint.pin_hash NOT LIKE '$2%' THEN
    v_new_bcrypt := extensions.crypt(p_pin_hash, extensions.gen_salt('bf', 10));
    UPDATE public.complaints
    SET pin_hash = v_new_bcrypt
    WHERE id = v_complaint.id;
  END IF;

  -- Usar valores corretos do enum complaint_status
  IF v_complaint.status IN ('resolved', 'dismissed') THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'complaint_closed');
  END IF;

  -- 5. Inserir mensagem
  INSERT INTO public.complaint_messages (
    complaint_id, sender_type, body
  ) VALUES (
    v_complaint.id, 'reporter', p_body
  ) RETURNING id INTO v_message_id;

  RETURN jsonb_build_object('success', TRUE, 'message_id', v_message_id);
END;
$_$;


--
-- Name: fn_set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: fn_submit_assessment(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_submit_assessment(p_token text, p_responses text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$ DECLARE v_invitation record; v_cycle record; v_response jsonb; v_batch_id uuid := gen_random_uuid(); v_token_hash text; v_count int; v_required_count int; v_submitted_required_count int; BEGIN IF p_token IS NULL OR length(p_token) < 16 OR p_responses IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'invalid_request'); END IF; v_token_hash := encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex'); SELECT ai.id, ai.cycle_id, ai.tenant_id, ai.used_at, ai.expires_at, ai.establishment_id, ai.department_id INTO v_invitation FROM public.assessment_invitations ai WHERE ai.token_hash = v_token_hash OR (ai.token_hash IS NULL AND ai.token = p_token) LIMIT 1 FOR UPDATE; IF v_invitation IS NULL OR v_invitation.used_at IS NOT NULL OR (v_invitation.expires_at IS NOT NULL AND v_invitation.expires_at <= now()) THEN RETURN jsonb_build_object('success', false, 'error', 'invalid_or_expired'); END IF; SELECT ac.id, ac.status, ac.ends_at, ac.questionnaire_template_id INTO v_cycle FROM public.assessment_cycles ac WHERE ac.id = v_invitation.cycle_id AND ac.deleted_at IS NULL; IF v_cycle IS NULL OR v_cycle.status <> 'active' OR v_cycle.ends_at <= now() THEN RETURN jsonb_build_object('success', false, 'error', 'cycle_not_active'); END IF; BEGIN v_response := p_responses::jsonb; EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', 'invalid_payload'); END; IF jsonb_typeof(v_response) <> 'array' OR jsonb_array_length(v_response) = 0 THEN RETURN jsonb_build_object('success', false, 'error', 'invalid_payload'); END IF; IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_response) x WHERE jsonb_typeof(x) <> 'object' OR NOT (x ? 'item_id') OR NOT (x ? 'value') OR jsonb_typeof(x->'item_id') <> 'string' OR jsonb_typeof(x->'value') <> 'number') THEN RETURN jsonb_build_object('success', false, 'error', 'invalid_payload'); END IF; BEGIN IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_response) x WHERE (x->>'value')::int < 1 OR (x->>'value')::int > 5) THEN RETURN jsonb_build_object('success', false, 'error', 'value_out_of_range'); END IF; IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_response) x LEFT JOIN public.questionnaire_items qi ON qi.id = (x->>'item_id')::uuid LEFT JOIN public.questionnaire_sections qs ON qs.id = qi.section_id WHERE qi.id IS NULL OR qs.template_id <> v_cycle.questionnaire_template_id) THEN RETURN jsonb_build_object('success', false, 'error', 'unknown_item'); END IF; EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN jsonb_build_object('success', false, 'error', 'invalid_payload'); END; IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_response) x GROUP BY x->>'item_id' HAVING count(*) > 1) THEN RETURN jsonb_build_object('success', false, 'error', 'duplicate_item'); END IF; SELECT count(*) INTO v_required_count FROM public.questionnaire_items qi JOIN public.questionnaire_sections qs ON qs.id = qi.section_id WHERE qs.template_id = v_cycle.questionnaire_template_id AND qi.required IS TRUE; SELECT count(*) INTO v_submitted_required_count FROM jsonb_array_elements(v_response) x JOIN public.questionnaire_items qi ON qi.id = (x->>'item_id')::uuid WHERE qi.required IS TRUE; IF v_submitted_required_count <> v_required_count THEN RETURN jsonb_build_object('success', false, 'error', 'missing_required_items'); END IF; INSERT INTO public.assessment_responses (invitation_id, submission_batch_id, cycle_id, tenant_id, establishment_id, department_id, item_id, value) SELECT NULL, v_batch_id, v_invitation.cycle_id, v_invitation.tenant_id, v_invitation.establishment_id, v_invitation.department_id, (x->>'item_id')::uuid, (x->>'value')::int FROM jsonb_array_elements(v_response) x; GET DIAGNOSTICS v_count = ROW_COUNT; UPDATE public.assessment_invitations SET used_at = now() WHERE id = v_invitation.id AND used_at IS NULL; RETURN jsonb_build_object('success', true, 'items_recorded', v_count); END; $$;


--
-- Name: fn_submit_complaint(text, text, text, text, boolean, text, text, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_submit_complaint(p_tenant_slug text, p_subject text, p_description text, p_category text, p_is_anonymous boolean, p_reporter_name text DEFAULT NULL::text, p_reporter_email text DEFAULT NULL::text, p_reporter_phone text DEFAULT NULL::text, p_establishment_name text DEFAULT NULL::text, p_department_name text DEFAULT NULL::text, p_pin_hash text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE
  v_tenant_id    uuid;
  v_complaint_id uuid;
  v_protocol     text;
  v_bcrypt_hash  text;
BEGIN
  -- PIN minimo 6 para novas denuncias (nao 4)
  -- PINs legados de 4-5 digitos sao aceitos apenas em consulta e mensagem
  IF p_pin_hash IS NULL OR length(p_pin_hash) < 6 OR length(p_pin_hash) > 32 THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_pin_length');
  END IF;

  -- Validar que o PIN contem apenas digitos
  IF p_pin_hash !~ '^\d+$' THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_pin_format');
  END IF;

  SELECT id INTO v_tenant_id
  FROM public.organizations
  WHERE slug = p_tenant_slug AND deleted_at IS NULL;

  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_tenant');
  END IF;

  v_protocol := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  v_bcrypt_hash := extensions.crypt(p_pin_hash, extensions.gen_salt('bf', 10));

  INSERT INTO public.complaints (
    id, tenant_id, protocol, category, severity, is_anonymous, pin_hash
  ) VALUES (
    gen_random_uuid(), v_tenant_id, v_protocol,
    p_category::public.complaint_category,
    'medium'::public.complaint_severity,
    p_is_anonymous, v_bcrypt_hash
  ) RETURNING id INTO v_complaint_id;

  INSERT INTO public.complaint_contents (
    complaint_id, subject, description,
    reporter_name, reporter_email, reporter_phone,
    establishment_name, department_name
  ) VALUES (
    v_complaint_id, p_subject, p_description,
    CASE WHEN p_is_anonymous THEN NULL ELSE p_reporter_name END,
    CASE WHEN p_is_anonymous THEN NULL ELSE p_reporter_email END,
    CASE WHEN p_is_anonymous THEN NULL ELSE p_reporter_phone END,
    p_establishment_name, p_department_name
  );

  INSERT INTO public.complaint_audit_log (
    complaint_id, action, details
  ) VALUES (
    v_complaint_id, 'created',
    jsonb_build_object('category', p_category, 'is_anonymous', p_is_anonymous)
  );

  RETURN jsonb_build_object('success', TRUE, 'protocol', v_protocol);
END;
$_$;


--
-- Name: fn_update_complaint_status(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_update_complaint_status(p_complaint_id uuid, p_new_status text, p_reason text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_old_status TEXT;
  v_tenant_id  UUID;
BEGIN
  SELECT c.status::text, c.tenant_id
  INTO v_old_status, v_tenant_id
  FROM public.complaints c
  WHERE c.id = p_complaint_id AND c.deleted_at IS NULL;

  IF v_old_status IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'not_found');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.tenant_id = v_tenant_id
      AND om.user_id = auth.uid()
      AND om.role IN ('owner', 'admin')
      AND om.deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'forbidden');
  END IF;

  UPDATE public.complaints
  SET status = p_new_status::public.complaint_status,
      resolved_at = CASE
        WHEN p_new_status IN ('resolved', 'dismissed') THEN now()
        ELSE NULL
      END
  WHERE id = p_complaint_id;

  INSERT INTO public.complaint_audit_log (
    complaint_id, actor_id, action, details
  ) VALUES (
    p_complaint_id, auth.uid(), 'status_changed',
    jsonb_build_object('old_status', v_old_status, 'new_status', p_new_status, 'reason', p_reason)
  );

  RETURN jsonb_build_object('success', TRUE, 'old_status', v_old_status, 'new_status', p_new_status);
END;
$$;


--
-- Name: fn_user_has_role(public.organization_role[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_user_has_role(required_roles public.organization_role[]) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM organization_members
    WHERE user_id = auth.uid()
      AND tenant_id = fn_resolve_tenant_id()
      AND role = ANY(required_roles)
      AND deleted_at IS NULL
  );
$$;


--
-- Name: fn_verify_complaint_pin(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_verify_complaint_pin(p_stored_hash text, p_pin text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE
  v_sha256_hash text;
  v_new_bcrypt  text;
BEGIN
  IF p_stored_hash LIKE '$2%' THEN
    RETURN p_stored_hash = extensions.crypt(p_pin, p_stored_hash);
  END IF;

  IF length(p_stored_hash) = 64 AND p_stored_hash ~ '^[0-9a-f]+$' THEN
    SELECT encode(
      extensions.digest(('complaint-pin-salt:' || p_pin)::bytea, 'sha256'),
      'hex'
    ) INTO v_sha256_hash;

    IF p_stored_hash = v_sha256_hash THEN
      v_new_bcrypt := extensions.crypt(p_pin, extensions.gen_salt('bf', 10));
      RETURN TRUE;
    ELSE
      RETURN FALSE;
    END IF;
  END IF;

  RETURN FALSE;
END;
$_$;


--
-- Name: transition_subscription_status(uuid, public.subscription_status, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.transition_subscription_status(p_subscription_id uuid, p_new_status public.subscription_status, p_reason text DEFAULT NULL::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_current_status public.subscription_status;
  v_tenant_id uuid;
  v_valid boolean := false;
BEGIN
  SELECT status, tenant_id
  INTO v_current_status, v_tenant_id
  FROM public.tenant_subscriptions
  WHERE id = p_subscription_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_valid := CASE v_current_status
    WHEN 'trialing' THEN p_new_status IN ('active', 'cancelled')
    WHEN 'active' THEN p_new_status IN ('past_due', 'cancelled')
    WHEN 'past_due' THEN p_new_status IN ('active', 'grace_period', 'cancelled')
    WHEN 'grace_period' THEN p_new_status IN ('active', 'partially_blocked', 'cancelled')
    WHEN 'partially_blocked' THEN p_new_status IN ('active', 'fully_blocked', 'cancelled')
    WHEN 'fully_blocked' THEN p_new_status IN ('active', 'cancelled')
    WHEN 'cancelled' THEN p_new_status IN ('active')
    ELSE false
  END;

  IF NOT v_valid THEN
    RETURN false;
  END IF;

  UPDATE public.tenant_subscriptions
  SET status = p_new_status,
      cancelled_at = CASE WHEN p_new_status = 'cancelled' THEN now() ELSE cancelled_at END,
      grace_period_ends_at = CASE
        WHEN p_new_status = 'grace_period' THEN now() + interval '7 days'
        WHEN p_new_status = 'active' THEN NULL
        ELSE grace_period_ends_at
      END,
      block_escalation_at = CASE
        WHEN p_new_status = 'partially_blocked' THEN now() + interval '15 days'
        WHEN p_new_status = 'active' THEN NULL
        ELSE block_escalation_at
      END
  WHERE id = p_subscription_id;

  INSERT INTO public.billing_events (tenant_id, subscription_id, event_type, description, metadata)
  VALUES (
    v_tenant_id, p_subscription_id, 'status_changed',
    COALESCE(p_reason, v_current_status::text || ' -> ' || p_new_status::text),
    jsonb_build_object('from', v_current_status, 'to', p_new_status)
  );

  RETURN true;
END;
$$;


SET default_table_access_method = heap;

--
-- Name: assessment_cycles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assessment_cycles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    questionnaire_template_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    status public.assessment_status DEFAULT 'planning'::public.assessment_status NOT NULL,
    min_respondents_threshold integer DEFAULT 5 NOT NULL,
    created_by uuid,
    settings jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT assessment_cycles_min_respondents_threshold_check CHECK ((min_respondents_threshold >= 3))
);


--
-- Name: assessment_dispatches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assessment_dispatches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    cycle_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    establishment_id uuid,
    department_id uuid,
    channel text NOT NULL,
    status text NOT NULL,
    provider_id text,
    error_code text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT assessment_dispatches_channel_check CHECK ((channel = ANY (ARRAY['email'::text, 'whatsapp'::text]))),
    CONSTRAINT assessment_dispatches_status_check CHECK ((status = ANY (ARRAY['sent'::text, 'failed'::text])))
);


--
-- Name: assessment_invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assessment_invitations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cycle_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    token text,
    establishment_id uuid,
    department_id uuid,
    used_at timestamp with time zone,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    token_hash text NOT NULL
);


--
-- Name: assessment_responses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assessment_responses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invitation_id uuid,
    cycle_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    item_id uuid NOT NULL,
    value integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    submission_batch_id uuid NOT NULL,
    establishment_id uuid,
    department_id uuid,
    CONSTRAINT assessment_responses_value_check CHECK (((value >= 1) AND (value <= 10)))
);


--
-- Name: billing_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.billing_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    subscription_id uuid,
    event_type text NOT NULL,
    description text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: campaign_acknowledgments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.campaign_acknowledgments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    recipient_id uuid NOT NULL,
    acknowledged_at timestamp with time zone DEFAULT now() NOT NULL,
    ip_address inet,
    user_agent text
);


--
-- Name: campaign_deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.campaign_deliveries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    recipient_id uuid NOT NULL,
    channel public.delivery_channel NOT NULL,
    status public.delivery_status DEFAULT 'pending'::public.delivery_status NOT NULL,
    provider_id text,
    idempotency_key text DEFAULT (gen_random_uuid())::text NOT NULL,
    queued_at timestamp with time zone,
    sent_at timestamp with time zone,
    delivered_at timestamp with time zone,
    read_at timestamp with time zone,
    failed_at timestamp with time zone,
    error_code text,
    error_message text,
    attempt_count integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: campaign_recipients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.campaign_recipients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid,
    full_name text NOT NULL,
    email text,
    phone text,
    establishment_id uuid,
    department_id uuid,
    channel public.delivery_channel DEFAULT 'email'::public.delivery_channel NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: campaign_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.campaign_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    name text NOT NULL,
    description text,
    type public.campaign_type DEFAULT 'informational'::public.campaign_type NOT NULL,
    channel public.delivery_channel DEFAULT 'email'::public.delivery_channel NOT NULL,
    subject text NOT NULL,
    body_html text,
    body_text text NOT NULL,
    legal_basis text,
    requires_acknowledgment boolean DEFAULT false NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT campaign_templates_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'archived'::text])))
);


--
-- Name: campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.campaigns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    template_id uuid,
    name text NOT NULL,
    description text,
    type public.campaign_type DEFAULT 'informational'::public.campaign_type NOT NULL,
    channel public.delivery_channel DEFAULT 'email'::public.delivery_channel NOT NULL,
    status public.campaign_status DEFAULT 'draft'::public.campaign_status NOT NULL,
    subject text NOT NULL,
    body_html text,
    body_text text NOT NULL,
    legal_basis text,
    requires_acknowledgment boolean DEFAULT false NOT NULL,
    scheduled_at timestamp with time zone,
    sent_at timestamp with time zone,
    completed_at timestamp with time zone,
    target_scope jsonb,
    assessment_cycle_id uuid,
    total_recipients integer DEFAULT 0 NOT NULL,
    idempotency_key text DEFAULT (gen_random_uuid())::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT chk_campaign_sent CHECK (((sent_at IS NULL) OR (status = ANY (ARRAY['sending'::public.campaign_status, 'sent'::public.campaign_status]))))
);


--
-- Name: complaint_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.complaint_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    complaint_id uuid NOT NULL,
    actor_id uuid,
    action text NOT NULL,
    details jsonb,
    ip_address inet,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: complaint_contents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.complaint_contents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    complaint_id uuid NOT NULL,
    subject text NOT NULL,
    description text NOT NULL,
    reporter_name text,
    reporter_email text,
    reporter_phone text,
    establishment_name text,
    department_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: complaint_investigators; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.complaint_investigators (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    complaint_id uuid NOT NULL,
    user_id uuid NOT NULL,
    assigned_by uuid NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    removed_at timestamp with time zone
);


--
-- Name: complaint_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.complaint_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    complaint_id uuid NOT NULL,
    sender_type text NOT NULL,
    sender_id uuid,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_sender_consistency CHECK ((((sender_type = 'reporter'::text) AND (sender_id IS NULL)) OR ((sender_type = 'investigator'::text) AND (sender_id IS NOT NULL)))),
    CONSTRAINT complaint_messages_sender_type_check CHECK ((sender_type = ANY (ARRAY['reporter'::text, 'investigator'::text])))
);


--
-- Name: complaint_pin_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.complaint_pin_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    protocol text NOT NULL,
    ip_hash text,
    attempted_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE complaint_pin_attempts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.complaint_pin_attempts IS 'Rate limiting for complaint PIN verification. Rows auto-pruned by fn_check_pin_rate_limit.';


--
-- Name: complaints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.complaints (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    protocol text NOT NULL,
    pin_hash text NOT NULL,
    category public.complaint_category DEFAULT 'other'::public.complaint_category NOT NULL,
    severity public.complaint_severity DEFAULT 'medium'::public.complaint_severity NOT NULL,
    status public.complaint_status DEFAULT 'pending'::public.complaint_status NOT NULL,
    is_anonymous boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    deleted_at timestamp with time zone,
    CONSTRAINT chk_complaint_resolved CHECK (((resolved_at IS NULL) OR (status = ANY (ARRAY['resolved'::public.complaint_status, 'dismissed'::public.complaint_status]))))
);


--
-- Name: departments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.departments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    establishment_id uuid NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: employee_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid,
    establishment_id uuid,
    department_id uuid,
    full_name text NOT NULL,
    email text,
    phone text,
    job_title text,
    hire_date date,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: establishments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.establishments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    cnpj text,
    address jsonb,
    is_main boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: evidence_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.evidence_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    evidence_report_id uuid,
    evidence_package_id uuid,
    action public.evidence_action NOT NULL,
    actor_id uuid,
    ip_address inet,
    user_agent text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_audit_target CHECK (((evidence_report_id IS NOT NULL) OR (evidence_package_id IS NOT NULL)))
);


--
-- Name: evidence_package_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.evidence_package_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    package_id uuid NOT NULL,
    report_id uuid NOT NULL,
    order_index integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: evidence_packages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.evidence_packages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    status public.package_status DEFAULT 'draft'::public.package_status NOT NULL,
    period_start timestamp with time zone NOT NULL,
    period_end timestamp with time zone NOT NULL,
    package_hash text,
    sealed_at timestamp with time zone,
    sealed_by uuid,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT chk_period CHECK ((period_end > period_start)),
    CONSTRAINT chk_sealed CHECK ((((status <> 'sealed'::public.package_status) AND (status <> 'exported'::public.package_status)) OR (sealed_at IS NOT NULL)))
);


--
-- Name: evidence_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.evidence_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    type public.evidence_type NOT NULL,
    title text NOT NULL,
    description text,
    status public.evidence_status DEFAULT 'generating'::public.evidence_status NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    previous_version_id uuid,
    source_type text NOT NULL,
    source_id uuid,
    period_start timestamp with time zone,
    period_end timestamp with time zone,
    content_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    content_hash text,
    file_path text,
    file_size_bytes bigint,
    file_hash text,
    disclaimer text DEFAULT 'Este relatório depende de validação por profissional habilitado.'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    generated_by uuid,
    generated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT chk_version_chain CHECK (((version = 1) OR (previous_version_id IS NOT NULL)))
);


--
-- Name: invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    subscription_id uuid NOT NULL,
    status public.invoice_status DEFAULT 'pending'::public.invoice_status,
    amount integer NOT NULL,
    currency text DEFAULT 'BRL'::text,
    external_invoice_id text,
    external_payment_link text,
    due_date date NOT NULL,
    paid_at timestamp with time zone,
    description text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: organization_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    actor_id uuid,
    action text NOT NULL,
    target_type text,
    target_id uuid,
    details jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: organization_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role public.organization_role DEFAULT 'collaborator'::public.organization_role NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    cnpj text,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    full_name text DEFAULT ''::text NOT NULL,
    email text DEFAULT ''::text NOT NULL,
    phone text,
    avatar_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: TABLE profiles; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.profiles IS 'Perfil público do usuário — espelho de auth.users com campos editáveis';


--
-- Name: questionnaire_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.questionnaire_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    section_id uuid NOT NULL,
    text text NOT NULL,
    help_text text,
    display_order integer DEFAULT 0 NOT NULL,
    reverse_scored boolean DEFAULT false NOT NULL,
    required boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: questionnaire_sections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.questionnaire_sections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    template_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    dimension_code text,
    display_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: questionnaire_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.questionnaire_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    name text NOT NULL,
    description text,
    version integer DEFAULT 1 NOT NULL,
    instrument_code text,
    response_scale jsonb DEFAULT '{"type": "likert", "labels": {"1": "Nunca", "2": "Raramente", "3": "Às vezes", "4": "Frequentemente", "5": "Sempre"}, "points": 5, "max_value": 5, "min_value": 1}'::jsonb NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT questionnaire_templates_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'archived'::text])))
);


--
-- Name: risk_action_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.risk_action_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    risk_item_id uuid NOT NULL,
    title text NOT NULL,
    description text,
    control_level public.control_hierarchy,
    responsible_user_id uuid,
    due_date date,
    status public.action_status DEFAULT 'planned'::public.action_status NOT NULL,
    completed_at timestamp with time zone,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: risk_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.risk_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    risk_item_id uuid NOT NULL,
    actor_id uuid,
    action text NOT NULL,
    details jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: risk_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.risk_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    cycle_id uuid,
    section_id uuid,
    source public.risk_source DEFAULT 'manual'::public.risk_source NOT NULL,
    category public.risk_category DEFAULT 'psychosocial'::public.risk_category NOT NULL,
    title text NOT NULL,
    description text,
    initial_risk_level public.risk_level NOT NULL,
    residual_risk_level public.risk_level,
    initial_score numeric(4,2),
    status public.risk_item_status DEFAULT 'identified'::public.risk_item_status NOT NULL,
    priority text DEFAULT 'medium'::text NOT NULL,
    establishment_id uuid,
    department_id uuid,
    affected_group text,
    identified_at timestamp with time zone DEFAULT now() NOT NULL,
    identified_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT risk_items_assessment_link CHECK ((((source = 'assessment'::public.risk_source) AND (cycle_id IS NOT NULL)) OR (source <> 'assessment'::public.risk_source))),
    CONSTRAINT risk_items_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'urgent'::text])))
);


--
-- Name: risk_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.risk_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    risk_item_id uuid NOT NULL,
    reviewer_id uuid NOT NULL,
    review_date date DEFAULT CURRENT_DATE NOT NULL,
    new_risk_level public.risk_level NOT NULL,
    new_score numeric(4,2),
    assessment_method text,
    findings text NOT NULL,
    recommendation public.review_recommendation NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: subscription_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscription_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    description text,
    price_monthly integer NOT NULL,
    price_yearly integer,
    limits public.plan_limits NOT NULL,
    is_active boolean DEFAULT true,
    display_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: tenant_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    plan_id uuid NOT NULL,
    status public.subscription_status DEFAULT 'trialing'::public.subscription_status,
    billing_cycle public.billing_cycle DEFAULT 'monthly'::public.billing_cycle,
    payment_method public.payment_method,
    current_period_start timestamp with time zone,
    current_period_end timestamp with time zone,
    trial_ends_at timestamp with time zone DEFAULT (now() + '14 days'::interval),
    cancelled_at timestamp with time zone,
    external_customer_id text,
    external_subscription_id text,
    grace_period_ends_at timestamp with time zone,
    block_escalation_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: usage_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.usage_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    metric text NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    recorded_at timestamp with time zone DEFAULT now(),
    period_start date NOT NULL,
    period_end date NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb
);


--
-- Name: webhook_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhook_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider text NOT NULL,
    event_id text NOT NULL,
    provider_message_id text,
    event_type text NOT NULL,
    delivery_id uuid,
    campaign_id uuid,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE webhook_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.webhook_events IS 'Audit trail de webhooks recebidos dos provedores de envio (Resend, WhatsApp). Acessível apenas via service role.';


--
-- Name: assessment_cycles assessment_cycles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_cycles
    ADD CONSTRAINT assessment_cycles_pkey PRIMARY KEY (id);


--
-- Name: assessment_dispatches assessment_dispatches_cycle_id_employee_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_dispatches
    ADD CONSTRAINT assessment_dispatches_cycle_id_employee_id_key UNIQUE (cycle_id, employee_id);


--
-- Name: assessment_dispatches assessment_dispatches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_dispatches
    ADD CONSTRAINT assessment_dispatches_pkey PRIMARY KEY (id);


--
-- Name: assessment_invitations assessment_invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_invitations
    ADD CONSTRAINT assessment_invitations_pkey PRIMARY KEY (id);


--
-- Name: assessment_invitations assessment_invitations_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_invitations
    ADD CONSTRAINT assessment_invitations_token_key UNIQUE (token);


--
-- Name: assessment_responses assessment_responses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_responses
    ADD CONSTRAINT assessment_responses_pkey PRIMARY KEY (id);


--
-- Name: billing_events billing_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_events
    ADD CONSTRAINT billing_events_pkey PRIMARY KEY (id);


--
-- Name: campaign_acknowledgments campaign_acknowledgments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_acknowledgments
    ADD CONSTRAINT campaign_acknowledgments_pkey PRIMARY KEY (id);


--
-- Name: campaign_deliveries campaign_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_deliveries
    ADD CONSTRAINT campaign_deliveries_pkey PRIMARY KEY (id);


--
-- Name: campaign_recipients campaign_recipients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_recipients
    ADD CONSTRAINT campaign_recipients_pkey PRIMARY KEY (id);


--
-- Name: campaign_templates campaign_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_templates
    ADD CONSTRAINT campaign_templates_pkey PRIMARY KEY (id);


--
-- Name: campaigns campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_pkey PRIMARY KEY (id);


--
-- Name: complaint_audit_log complaint_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaint_audit_log
    ADD CONSTRAINT complaint_audit_log_pkey PRIMARY KEY (id);


--
-- Name: complaint_contents complaint_contents_complaint_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaint_contents
    ADD CONSTRAINT complaint_contents_complaint_id_key UNIQUE (complaint_id);


--
-- Name: complaint_contents complaint_contents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaint_contents
    ADD CONSTRAINT complaint_contents_pkey PRIMARY KEY (id);


--
-- Name: complaint_investigators complaint_investigators_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaint_investigators
    ADD CONSTRAINT complaint_investigators_pkey PRIMARY KEY (id);


--
-- Name: complaint_messages complaint_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaint_messages
    ADD CONSTRAINT complaint_messages_pkey PRIMARY KEY (id);


--
-- Name: complaint_pin_attempts complaint_pin_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaint_pin_attempts
    ADD CONSTRAINT complaint_pin_attempts_pkey PRIMARY KEY (id);


--
-- Name: complaints complaints_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaints
    ADD CONSTRAINT complaints_pkey PRIMARY KEY (id);


--
-- Name: complaints complaints_protocol_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaints
    ADD CONSTRAINT complaints_protocol_key UNIQUE (protocol);


--
-- Name: departments departments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_pkey PRIMARY KEY (id);


--
-- Name: employee_profiles employee_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_profiles
    ADD CONSTRAINT employee_profiles_pkey PRIMARY KEY (id);


--
-- Name: establishments establishments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.establishments
    ADD CONSTRAINT establishments_pkey PRIMARY KEY (id);


--
-- Name: evidence_audit_log evidence_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidence_audit_log
    ADD CONSTRAINT evidence_audit_log_pkey PRIMARY KEY (id);


--
-- Name: evidence_package_items evidence_package_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidence_package_items
    ADD CONSTRAINT evidence_package_items_pkey PRIMARY KEY (id);


--
-- Name: evidence_packages evidence_packages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidence_packages
    ADD CONSTRAINT evidence_packages_pkey PRIMARY KEY (id);


--
-- Name: evidence_reports evidence_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidence_reports
    ADD CONSTRAINT evidence_reports_pkey PRIMARY KEY (id);


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


--
-- Name: tenant_subscriptions one_active_sub_per_tenant; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_subscriptions
    ADD CONSTRAINT one_active_sub_per_tenant UNIQUE (tenant_id);


--
-- Name: organization_audit_log organization_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_audit_log
    ADD CONSTRAINT organization_audit_log_pkey PRIMARY KEY (id);


--
-- Name: organization_members organization_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_pkey PRIMARY KEY (id);


--
-- Name: organization_members organization_members_tenant_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_tenant_id_user_id_key UNIQUE (tenant_id, user_id);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_slug_key UNIQUE (slug);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: questionnaire_items questionnaire_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.questionnaire_items
    ADD CONSTRAINT questionnaire_items_pkey PRIMARY KEY (id);


--
-- Name: questionnaire_sections questionnaire_sections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.questionnaire_sections
    ADD CONSTRAINT questionnaire_sections_pkey PRIMARY KEY (id);


--
-- Name: questionnaire_templates questionnaire_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.questionnaire_templates
    ADD CONSTRAINT questionnaire_templates_pkey PRIMARY KEY (id);


--
-- Name: risk_action_plans risk_action_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risk_action_plans
    ADD CONSTRAINT risk_action_plans_pkey PRIMARY KEY (id);


--
-- Name: risk_audit_log risk_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risk_audit_log
    ADD CONSTRAINT risk_audit_log_pkey PRIMARY KEY (id);


--
-- Name: risk_items risk_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risk_items
    ADD CONSTRAINT risk_items_pkey PRIMARY KEY (id);


--
-- Name: risk_reviews risk_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risk_reviews
    ADD CONSTRAINT risk_reviews_pkey PRIMARY KEY (id);


--
-- Name: subscription_plans subscription_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_plans
    ADD CONSTRAINT subscription_plans_pkey PRIMARY KEY (id);


--
-- Name: subscription_plans subscription_plans_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_plans
    ADD CONSTRAINT subscription_plans_slug_key UNIQUE (slug);


--
-- Name: tenant_subscriptions tenant_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_subscriptions
    ADD CONSTRAINT tenant_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: campaign_acknowledgments uq_acknowledgment; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_acknowledgments
    ADD CONSTRAINT uq_acknowledgment UNIQUE (campaign_id, recipient_id);


--
-- Name: complaint_investigators uq_active_investigator; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaint_investigators
    ADD CONSTRAINT uq_active_investigator UNIQUE (complaint_id, user_id);


--
-- Name: campaign_recipients uq_campaign_recipients_campaign_user_channel; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_recipients
    ADD CONSTRAINT uq_campaign_recipients_campaign_user_channel UNIQUE (campaign_id, user_id, channel);


--
-- Name: evidence_package_items uq_package_report; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidence_package_items
    ADD CONSTRAINT uq_package_report UNIQUE (package_id, report_id);


--
-- Name: usage_records usage_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_records
    ADD CONSTRAINT usage_records_pkey PRIMARY KEY (id);


--
-- Name: webhook_events webhook_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_events
    ADD CONSTRAINT webhook_events_pkey PRIMARY KEY (id);


--
-- Name: idx_assessment_cycles_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assessment_cycles_tenant ON public.assessment_cycles USING btree (tenant_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_assessment_invitations_cycle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assessment_invitations_cycle ON public.assessment_invitations USING btree (cycle_id);


--
-- Name: idx_assessment_invitations_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assessment_invitations_token ON public.assessment_invitations USING btree (token);


--
-- Name: idx_assessment_invitations_token_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_assessment_invitations_token_hash ON public.assessment_invitations USING btree (token_hash);


--
-- Name: idx_assessment_responses_batch_item; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_assessment_responses_batch_item ON public.assessment_responses USING btree (submission_batch_id, item_id);


--
-- Name: idx_assessment_responses_cycle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assessment_responses_cycle ON public.assessment_responses USING btree (cycle_id);


--
-- Name: idx_assessment_responses_cycle_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assessment_responses_cycle_group ON public.assessment_responses USING btree (cycle_id, establishment_id, department_id);


--
-- Name: idx_assessment_responses_invitation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assessment_responses_invitation ON public.assessment_responses USING btree (invitation_id);


--
-- Name: idx_billing_events_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_billing_events_tenant ON public.billing_events USING btree (tenant_id);


--
-- Name: idx_billing_events_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_billing_events_type ON public.billing_events USING btree (event_type);


--
-- Name: idx_campaign_deliveries_campaign; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_campaign_deliveries_campaign ON public.campaign_deliveries USING btree (campaign_id, status);


--
-- Name: idx_campaign_deliveries_idempotency; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_campaign_deliveries_idempotency ON public.campaign_deliveries USING btree (idempotency_key);


--
-- Name: idx_campaign_deliveries_provider_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_campaign_deliveries_provider_id ON public.campaign_deliveries USING btree (provider_id) WHERE (provider_id IS NOT NULL);


--
-- Name: idx_campaign_deliveries_recipient; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_campaign_deliveries_recipient ON public.campaign_deliveries USING btree (recipient_id);


--
-- Name: idx_campaign_recipients_campaign; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_campaign_recipients_campaign ON public.campaign_recipients USING btree (campaign_id);


--
-- Name: idx_campaign_recipients_dedup; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_campaign_recipients_dedup ON public.campaign_recipients USING btree (campaign_id, user_id, channel) WHERE (user_id IS NOT NULL);


--
-- Name: idx_campaign_recipients_dedup_email; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_campaign_recipients_dedup_email ON public.campaign_recipients USING btree (campaign_id, email, channel) WHERE ((user_id IS NULL) AND (email IS NOT NULL));


--
-- Name: idx_campaign_recipients_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_campaign_recipients_tenant ON public.campaign_recipients USING btree (tenant_id);


--
-- Name: idx_campaign_templates_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_campaign_templates_tenant ON public.campaign_templates USING btree (tenant_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_campaigns_idempotency; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_campaigns_idempotency ON public.campaigns USING btree (idempotency_key);


--
-- Name: idx_campaigns_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_campaigns_tenant_status ON public.campaigns USING btree (tenant_id, status) WHERE (deleted_at IS NULL);


--
-- Name: idx_complaint_audit_log_complaint; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_complaint_audit_log_complaint ON public.complaint_audit_log USING btree (complaint_id, created_at);


--
-- Name: idx_complaint_investigators_complaint; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_complaint_investigators_complaint ON public.complaint_investigators USING btree (complaint_id) WHERE (removed_at IS NULL);


--
-- Name: idx_complaint_investigators_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_complaint_investigators_user ON public.complaint_investigators USING btree (user_id) WHERE (removed_at IS NULL);


--
-- Name: idx_complaint_messages_complaint; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_complaint_messages_complaint ON public.complaint_messages USING btree (complaint_id, created_at);


--
-- Name: idx_complaints_protocol; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_complaints_protocol ON public.complaints USING btree (protocol);


--
-- Name: idx_complaints_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_complaints_tenant_status ON public.complaints USING btree (tenant_id, status) WHERE (deleted_at IS NULL);


--
-- Name: idx_departments_establishment_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_departments_establishment_id ON public.departments USING btree (establishment_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_departments_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_departments_tenant_id ON public.departments USING btree (tenant_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_employee_profiles_department_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_profiles_department_id ON public.employee_profiles USING btree (tenant_id, department_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_employee_profiles_establishment_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_profiles_establishment_id ON public.employee_profiles USING btree (tenant_id, establishment_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_employee_profiles_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_profiles_tenant_id ON public.employee_profiles USING btree (tenant_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_employee_profiles_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_profiles_user_id ON public.employee_profiles USING btree (user_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_establishments_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_establishments_tenant_id ON public.establishments USING btree (tenant_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_evidence_audit_log_package; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_evidence_audit_log_package ON public.evidence_audit_log USING btree (evidence_package_id) WHERE (evidence_package_id IS NOT NULL);


--
-- Name: idx_evidence_audit_log_report; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_evidence_audit_log_report ON public.evidence_audit_log USING btree (evidence_report_id) WHERE (evidence_report_id IS NOT NULL);


--
-- Name: idx_evidence_audit_log_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_evidence_audit_log_tenant ON public.evidence_audit_log USING btree (tenant_id, created_at DESC);


--
-- Name: idx_evidence_package_items_package; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_evidence_package_items_package ON public.evidence_package_items USING btree (package_id);


--
-- Name: idx_evidence_packages_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_evidence_packages_tenant ON public.evidence_packages USING btree (tenant_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_evidence_reports_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_evidence_reports_source ON public.evidence_reports USING btree (source_type, source_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_evidence_reports_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_evidence_reports_status ON public.evidence_reports USING btree (tenant_id, status) WHERE (deleted_at IS NULL);


--
-- Name: idx_evidence_reports_tenant_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_evidence_reports_tenant_type ON public.evidence_reports USING btree (tenant_id, type) WHERE (deleted_at IS NULL);


--
-- Name: idx_invoices_due_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_due_date ON public.invoices USING btree (due_date);


--
-- Name: idx_invoices_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_status ON public.invoices USING btree (status);


--
-- Name: idx_invoices_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_tenant ON public.invoices USING btree (tenant_id);


--
-- Name: idx_org_audit_log_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_org_audit_log_tenant ON public.organization_audit_log USING btree (tenant_id, created_at DESC);


--
-- Name: idx_organization_members_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_organization_members_tenant_id ON public.organization_members USING btree (tenant_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_organization_members_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_organization_members_user_id ON public.organization_members USING btree (user_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_organizations_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_organizations_slug ON public.organizations USING btree (slug) WHERE (deleted_at IS NULL);


--
-- Name: idx_pin_attempts_ip_hash_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pin_attempts_ip_hash_time ON public.complaint_pin_attempts USING btree (ip_hash, attempted_at DESC) WHERE (ip_hash IS NOT NULL);


--
-- Name: idx_pin_attempts_protocol_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pin_attempts_protocol_time ON public.complaint_pin_attempts USING btree (protocol, attempted_at DESC);


--
-- Name: idx_profiles_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_email ON public.profiles USING btree (email);


--
-- Name: idx_questionnaire_items_section; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_questionnaire_items_section ON public.questionnaire_items USING btree (section_id);


--
-- Name: idx_questionnaire_sections_template; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_questionnaire_sections_template ON public.questionnaire_sections USING btree (template_id);


--
-- Name: idx_questionnaire_templates_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_questionnaire_templates_tenant ON public.questionnaire_templates USING btree (tenant_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_risk_action_plans_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_risk_action_plans_due ON public.risk_action_plans USING btree (due_date) WHERE ((status = ANY (ARRAY['planned'::public.action_status, 'in_progress'::public.action_status])) AND (deleted_at IS NULL));


--
-- Name: idx_risk_action_plans_responsible; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_risk_action_plans_responsible ON public.risk_action_plans USING btree (responsible_user_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_risk_action_plans_risk; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_risk_action_plans_risk ON public.risk_action_plans USING btree (risk_item_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_risk_action_plans_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_risk_action_plans_status ON public.risk_action_plans USING btree (tenant_id, status) WHERE (deleted_at IS NULL);


--
-- Name: idx_risk_audit_log_risk; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_risk_audit_log_risk ON public.risk_audit_log USING btree (risk_item_id);


--
-- Name: idx_risk_items_cycle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_risk_items_cycle ON public.risk_items USING btree (cycle_id) WHERE (cycle_id IS NOT NULL);


--
-- Name: idx_risk_items_level; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_risk_items_level ON public.risk_items USING btree (tenant_id, initial_risk_level) WHERE (deleted_at IS NULL);


--
-- Name: idx_risk_items_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_risk_items_status ON public.risk_items USING btree (tenant_id, status) WHERE (deleted_at IS NULL);


--
-- Name: idx_risk_items_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_risk_items_tenant ON public.risk_items USING btree (tenant_id);


--
-- Name: idx_risk_reviews_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_risk_reviews_date ON public.risk_reviews USING btree (tenant_id, review_date);


--
-- Name: idx_risk_reviews_risk; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_risk_reviews_risk ON public.risk_reviews USING btree (risk_item_id);


--
-- Name: idx_tenant_subscriptions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenant_subscriptions_status ON public.tenant_subscriptions USING btree (status);


--
-- Name: idx_tenant_subscriptions_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenant_subscriptions_tenant ON public.tenant_subscriptions USING btree (tenant_id);


--
-- Name: idx_usage_records_tenant_metric; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_usage_records_tenant_metric ON public.usage_records USING btree (tenant_id, metric, period_start);


--
-- Name: idx_webhook_events_delivery_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_events_delivery_id ON public.webhook_events USING btree (delivery_id);


--
-- Name: idx_webhook_events_event_id_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_webhook_events_event_id_unique ON public.webhook_events USING btree (event_id);


--
-- Name: idx_webhook_events_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_events_provider ON public.webhook_events USING btree (provider);


--
-- Name: idx_webhook_events_received_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_events_received_at ON public.webhook_events USING btree (received_at);


--
-- Name: invoices set_updated_at_invoices; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at_invoices BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: subscription_plans set_updated_at_subscription_plans; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at_subscription_plans BEFORE UPDATE ON public.subscription_plans FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: tenant_subscriptions set_updated_at_tenant_subscriptions; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at_tenant_subscriptions BEFORE UPDATE ON public.tenant_subscriptions FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: assessment_cycles trg_assessment_cycles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_assessment_cycles_updated_at BEFORE UPDATE ON public.assessment_cycles FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: complaint_audit_log trg_audit_log_no_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_log_no_delete BEFORE DELETE ON public.complaint_audit_log FOR EACH ROW EXECUTE FUNCTION public.fn_audit_log_immutable();


--
-- Name: complaint_audit_log trg_audit_log_no_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_log_no_update BEFORE UPDATE ON public.complaint_audit_log FOR EACH ROW EXECUTE FUNCTION public.fn_audit_log_immutable();


--
-- Name: campaign_deliveries trg_campaign_deliveries_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_campaign_deliveries_updated_at BEFORE UPDATE ON public.campaign_deliveries FOR EACH ROW EXECUTE FUNCTION public.fn_campaign_updated_at();


--
-- Name: campaign_templates trg_campaign_templates_immutable_tenant; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_campaign_templates_immutable_tenant BEFORE UPDATE ON public.campaign_templates FOR EACH ROW EXECUTE FUNCTION public.fn_campaign_templates_immutable_tenant();


--
-- Name: campaign_templates trg_campaign_templates_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_campaign_templates_updated_at BEFORE UPDATE ON public.campaign_templates FOR EACH ROW EXECUTE FUNCTION public.fn_campaign_updated_at();


--
-- Name: campaigns trg_campaigns_immutable_tenant; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_campaigns_immutable_tenant BEFORE UPDATE ON public.campaigns FOR EACH ROW EXECUTE FUNCTION public.fn_campaigns_immutable_tenant();


--
-- Name: campaigns trg_campaigns_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_campaigns_updated_at BEFORE UPDATE ON public.campaigns FOR EACH ROW EXECUTE FUNCTION public.fn_campaign_updated_at();


--
-- Name: complaint_contents trg_complaint_contents_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_complaint_contents_updated_at BEFORE UPDATE ON public.complaint_contents FOR EACH ROW EXECUTE FUNCTION public.fn_complaints_updated_at();


--
-- Name: complaints trg_complaints_immutable_tenant; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_complaints_immutable_tenant BEFORE UPDATE ON public.complaints FOR EACH ROW EXECUTE FUNCTION public.fn_complaints_immutable_tenant();


--
-- Name: complaints trg_complaints_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_complaints_updated_at BEFORE UPDATE ON public.complaints FOR EACH ROW EXECUTE FUNCTION public.fn_complaints_updated_at();


--
-- Name: departments trg_departments_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_departments_updated_at BEFORE UPDATE ON public.departments FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: employee_profiles trg_employee_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_employee_profiles_updated_at BEFORE UPDATE ON public.employee_profiles FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: establishments trg_establishments_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_establishments_updated_at BEFORE UPDATE ON public.establishments FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: evidence_packages trg_evidence_packages_immutable_sealed; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_evidence_packages_immutable_sealed BEFORE UPDATE ON public.evidence_packages FOR EACH ROW EXECUTE FUNCTION public.fn_evidence_packages_immutable_sealed();


--
-- Name: evidence_packages trg_evidence_packages_immutable_tenant; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_evidence_packages_immutable_tenant BEFORE UPDATE ON public.evidence_packages FOR EACH ROW EXECUTE FUNCTION public.fn_evidence_packages_immutable_tenant();


--
-- Name: evidence_packages trg_evidence_packages_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_evidence_packages_updated_at BEFORE UPDATE ON public.evidence_packages FOR EACH ROW EXECUTE FUNCTION public.fn_evidence_updated_at();


--
-- Name: evidence_reports trg_evidence_reports_immutable_content; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_evidence_reports_immutable_content BEFORE UPDATE ON public.evidence_reports FOR EACH ROW EXECUTE FUNCTION public.fn_evidence_reports_immutable_content();


--
-- Name: evidence_reports trg_evidence_reports_immutable_tenant; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_evidence_reports_immutable_tenant BEFORE UPDATE ON public.evidence_reports FOR EACH ROW EXECUTE FUNCTION public.fn_evidence_reports_immutable_tenant();


--
-- Name: evidence_reports trg_evidence_reports_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_evidence_reports_updated_at BEFORE UPDATE ON public.evidence_reports FOR EACH ROW EXECUTE FUNCTION public.fn_evidence_updated_at();


--
-- Name: organization_members trg_organization_members_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_organization_members_updated_at BEFORE UPDATE ON public.organization_members FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: organizations trg_organizations_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_organizations_updated_at BEFORE UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: profiles trg_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: questionnaire_templates trg_questionnaire_templates_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_questionnaire_templates_updated_at BEFORE UPDATE ON public.questionnaire_templates FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: risk_action_plans trg_risk_action_plans_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_risk_action_plans_updated_at BEFORE UPDATE ON public.risk_action_plans FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: risk_audit_log trg_risk_audit_log_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_risk_audit_log_immutable BEFORE DELETE OR UPDATE ON public.risk_audit_log FOR EACH ROW EXECUTE FUNCTION public.fn_audit_log_immutable();


--
-- Name: risk_items trg_risk_items_immutable_tenant; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_risk_items_immutable_tenant BEFORE UPDATE ON public.risk_items FOR EACH ROW EXECUTE FUNCTION public.fn_risk_items_immutable_tenant();


--
-- Name: risk_items trg_risk_items_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_risk_items_updated_at BEFORE UPDATE ON public.risk_items FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: assessment_cycles assessment_cycles_questionnaire_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_cycles
    ADD CONSTRAINT assessment_cycles_questionnaire_template_id_fkey FOREIGN KEY (questionnaire_template_id) REFERENCES public.questionnaire_templates(id);


--
-- Name: assessment_cycles assessment_cycles_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_cycles
    ADD CONSTRAINT assessment_cycles_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: assessment_dispatches assessment_dispatches_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_dispatches
    ADD CONSTRAINT assessment_dispatches_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: assessment_dispatches assessment_dispatches_cycle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_dispatches
    ADD CONSTRAINT assessment_dispatches_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.assessment_cycles(id);


--
-- Name: assessment_dispatches assessment_dispatches_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_dispatches
    ADD CONSTRAINT assessment_dispatches_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id);


--
-- Name: assessment_dispatches assessment_dispatches_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_dispatches
    ADD CONSTRAINT assessment_dispatches_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employee_profiles(id);


--
-- Name: assessment_dispatches assessment_dispatches_establishment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_dispatches
    ADD CONSTRAINT assessment_dispatches_establishment_id_fkey FOREIGN KEY (establishment_id) REFERENCES public.establishments(id);


--
-- Name: assessment_dispatches assessment_dispatches_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_dispatches
    ADD CONSTRAINT assessment_dispatches_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.organizations(id);


--
-- Name: assessment_invitations assessment_invitations_cycle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_invitations
    ADD CONSTRAINT assessment_invitations_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.assessment_cycles(id) ON DELETE CASCADE;


--
-- Name: assessment_invitations assessment_invitations_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_invitations
    ADD CONSTRAINT assessment_invitations_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id);


--
-- Name: assessment_invitations assessment_invitations_establishment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_invitations
    ADD CONSTRAINT assessment_invitations_establishment_id_fkey FOREIGN KEY (establishment_id) REFERENCES public.establishments(id);


--
-- Name: assessment_invitations assessment_invitations_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_invitations
    ADD CONSTRAINT assessment_invitations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: assessment_responses assessment_responses_cycle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_responses
    ADD CONSTRAINT assessment_responses_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.assessment_cycles(id) ON DELETE CASCADE;


--
-- Name: assessment_responses assessment_responses_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_responses
    ADD CONSTRAINT assessment_responses_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id);


--
-- Name: assessment_responses assessment_responses_establishment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_responses
    ADD CONSTRAINT assessment_responses_establishment_id_fkey FOREIGN KEY (establishment_id) REFERENCES public.establishments(id);


--
-- Name: assessment_responses assessment_responses_invitation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_responses
    ADD CONSTRAINT assessment_responses_invitation_id_fkey FOREIGN KEY (invitation_id) REFERENCES public.assessment_invitations(id) ON DELETE CASCADE;


--
-- Name: assessment_responses assessment_responses_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_responses
    ADD CONSTRAINT assessment_responses_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.questionnaire_items(id);


--
-- Name: assessment_responses assessment_responses_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_responses
    ADD CONSTRAINT assessment_responses_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: billing_events billing_events_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_events
    ADD CONSTRAINT billing_events_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.tenant_subscriptions(id);


--
-- Name: billing_events billing_events_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_events
    ADD CONSTRAINT billing_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: campaign_acknowledgments campaign_acknowledgments_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_acknowledgments
    ADD CONSTRAINT campaign_acknowledgments_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE;


--
-- Name: campaign_acknowledgments campaign_acknowledgments_recipient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_acknowledgments
    ADD CONSTRAINT campaign_acknowledgments_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.campaign_recipients(id) ON DELETE CASCADE;


--
-- Name: campaign_deliveries campaign_deliveries_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_deliveries
    ADD CONSTRAINT campaign_deliveries_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE;


--
-- Name: campaign_deliveries campaign_deliveries_recipient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_deliveries
    ADD CONSTRAINT campaign_deliveries_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.campaign_recipients(id) ON DELETE CASCADE;


--
-- Name: campaign_recipients campaign_recipients_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_recipients
    ADD CONSTRAINT campaign_recipients_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE;


--
-- Name: campaign_recipients campaign_recipients_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_recipients
    ADD CONSTRAINT campaign_recipients_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.organizations(id);


--
-- Name: campaign_recipients campaign_recipients_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_recipients
    ADD CONSTRAINT campaign_recipients_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: campaign_templates campaign_templates_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_templates
    ADD CONSTRAINT campaign_templates_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: campaign_templates campaign_templates_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_templates
    ADD CONSTRAINT campaign_templates_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.organizations(id);


--
-- Name: campaigns campaigns_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: campaigns campaigns_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.campaign_templates(id);


--
-- Name: campaigns campaigns_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.organizations(id);


--
-- Name: complaint_audit_log complaint_audit_log_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaint_audit_log
    ADD CONSTRAINT complaint_audit_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id);


--
-- Name: complaint_audit_log complaint_audit_log_complaint_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaint_audit_log
    ADD CONSTRAINT complaint_audit_log_complaint_id_fkey FOREIGN KEY (complaint_id) REFERENCES public.complaints(id) ON DELETE CASCADE;


--
-- Name: complaint_contents complaint_contents_complaint_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaint_contents
    ADD CONSTRAINT complaint_contents_complaint_id_fkey FOREIGN KEY (complaint_id) REFERENCES public.complaints(id) ON DELETE CASCADE;


--
-- Name: complaint_investigators complaint_investigators_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaint_investigators
    ADD CONSTRAINT complaint_investigators_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES auth.users(id);


--
-- Name: complaint_investigators complaint_investigators_complaint_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaint_investigators
    ADD CONSTRAINT complaint_investigators_complaint_id_fkey FOREIGN KEY (complaint_id) REFERENCES public.complaints(id) ON DELETE CASCADE;


--
-- Name: complaint_investigators complaint_investigators_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaint_investigators
    ADD CONSTRAINT complaint_investigators_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: complaint_messages complaint_messages_complaint_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaint_messages
    ADD CONSTRAINT complaint_messages_complaint_id_fkey FOREIGN KEY (complaint_id) REFERENCES public.complaints(id) ON DELETE CASCADE;


--
-- Name: complaint_messages complaint_messages_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaint_messages
    ADD CONSTRAINT complaint_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES auth.users(id);


--
-- Name: complaints complaints_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaints
    ADD CONSTRAINT complaints_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.organizations(id);


--
-- Name: departments departments_establishment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_establishment_id_fkey FOREIGN KEY (establishment_id) REFERENCES public.establishments(id) ON DELETE CASCADE;


--
-- Name: departments departments_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: employee_profiles employee_profiles_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_profiles
    ADD CONSTRAINT employee_profiles_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id);


--
-- Name: employee_profiles employee_profiles_establishment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_profiles
    ADD CONSTRAINT employee_profiles_establishment_id_fkey FOREIGN KEY (establishment_id) REFERENCES public.establishments(id);


--
-- Name: employee_profiles employee_profiles_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_profiles
    ADD CONSTRAINT employee_profiles_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: employee_profiles employee_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_profiles
    ADD CONSTRAINT employee_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: establishments establishments_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.establishments
    ADD CONSTRAINT establishments_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: evidence_audit_log evidence_audit_log_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidence_audit_log
    ADD CONSTRAINT evidence_audit_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id);


--
-- Name: evidence_audit_log evidence_audit_log_evidence_package_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidence_audit_log
    ADD CONSTRAINT evidence_audit_log_evidence_package_id_fkey FOREIGN KEY (evidence_package_id) REFERENCES public.evidence_packages(id);


--
-- Name: evidence_audit_log evidence_audit_log_evidence_report_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidence_audit_log
    ADD CONSTRAINT evidence_audit_log_evidence_report_id_fkey FOREIGN KEY (evidence_report_id) REFERENCES public.evidence_reports(id);


--
-- Name: evidence_audit_log evidence_audit_log_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidence_audit_log
    ADD CONSTRAINT evidence_audit_log_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.organizations(id);


--
-- Name: evidence_package_items evidence_package_items_package_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidence_package_items
    ADD CONSTRAINT evidence_package_items_package_id_fkey FOREIGN KEY (package_id) REFERENCES public.evidence_packages(id) ON DELETE CASCADE;


--
-- Name: evidence_package_items evidence_package_items_report_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidence_package_items
    ADD CONSTRAINT evidence_package_items_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.evidence_reports(id);


--
-- Name: evidence_packages evidence_packages_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidence_packages
    ADD CONSTRAINT evidence_packages_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: evidence_packages evidence_packages_sealed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidence_packages
    ADD CONSTRAINT evidence_packages_sealed_by_fkey FOREIGN KEY (sealed_by) REFERENCES auth.users(id);


--
-- Name: evidence_packages evidence_packages_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidence_packages
    ADD CONSTRAINT evidence_packages_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.organizations(id);


--
-- Name: evidence_reports evidence_reports_generated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidence_reports
    ADD CONSTRAINT evidence_reports_generated_by_fkey FOREIGN KEY (generated_by) REFERENCES auth.users(id);


--
-- Name: evidence_reports evidence_reports_previous_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidence_reports
    ADD CONSTRAINT evidence_reports_previous_version_id_fkey FOREIGN KEY (previous_version_id) REFERENCES public.evidence_reports(id);


--
-- Name: evidence_reports evidence_reports_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidence_reports
    ADD CONSTRAINT evidence_reports_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.organizations(id);


--
-- Name: invoices invoices_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.tenant_subscriptions(id);


--
-- Name: invoices invoices_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: organization_audit_log organization_audit_log_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_audit_log
    ADD CONSTRAINT organization_audit_log_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.organizations(id);


--
-- Name: organization_members organization_members_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: organization_members organization_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: organization_members organization_members_user_id_profiles_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_user_id_profiles_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id);


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: questionnaire_items questionnaire_items_section_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.questionnaire_items
    ADD CONSTRAINT questionnaire_items_section_id_fkey FOREIGN KEY (section_id) REFERENCES public.questionnaire_sections(id) ON DELETE CASCADE;


--
-- Name: questionnaire_items questionnaire_items_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.questionnaire_items
    ADD CONSTRAINT questionnaire_items_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: questionnaire_sections questionnaire_sections_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.questionnaire_sections
    ADD CONSTRAINT questionnaire_sections_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.questionnaire_templates(id) ON DELETE CASCADE;


--
-- Name: questionnaire_sections questionnaire_sections_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.questionnaire_sections
    ADD CONSTRAINT questionnaire_sections_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: questionnaire_templates questionnaire_templates_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.questionnaire_templates
    ADD CONSTRAINT questionnaire_templates_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: risk_action_plans risk_action_plans_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risk_action_plans
    ADD CONSTRAINT risk_action_plans_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: risk_action_plans risk_action_plans_responsible_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risk_action_plans
    ADD CONSTRAINT risk_action_plans_responsible_user_id_fkey FOREIGN KEY (responsible_user_id) REFERENCES auth.users(id);


--
-- Name: risk_action_plans risk_action_plans_risk_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risk_action_plans
    ADD CONSTRAINT risk_action_plans_risk_item_id_fkey FOREIGN KEY (risk_item_id) REFERENCES public.risk_items(id);


--
-- Name: risk_action_plans risk_action_plans_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risk_action_plans
    ADD CONSTRAINT risk_action_plans_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.organizations(id);


--
-- Name: risk_audit_log risk_audit_log_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risk_audit_log
    ADD CONSTRAINT risk_audit_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id);


--
-- Name: risk_audit_log risk_audit_log_risk_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risk_audit_log
    ADD CONSTRAINT risk_audit_log_risk_item_id_fkey FOREIGN KEY (risk_item_id) REFERENCES public.risk_items(id);


--
-- Name: risk_items risk_items_cycle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risk_items
    ADD CONSTRAINT risk_items_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.assessment_cycles(id);


--
-- Name: risk_items risk_items_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risk_items
    ADD CONSTRAINT risk_items_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id);


--
-- Name: risk_items risk_items_establishment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risk_items
    ADD CONSTRAINT risk_items_establishment_id_fkey FOREIGN KEY (establishment_id) REFERENCES public.establishments(id);


--
-- Name: risk_items risk_items_identified_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risk_items
    ADD CONSTRAINT risk_items_identified_by_fkey FOREIGN KEY (identified_by) REFERENCES auth.users(id);


--
-- Name: risk_items risk_items_section_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risk_items
    ADD CONSTRAINT risk_items_section_id_fkey FOREIGN KEY (section_id) REFERENCES public.questionnaire_sections(id);


--
-- Name: risk_items risk_items_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risk_items
    ADD CONSTRAINT risk_items_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.organizations(id);


--
-- Name: risk_reviews risk_reviews_reviewer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risk_reviews
    ADD CONSTRAINT risk_reviews_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES auth.users(id);


--
-- Name: risk_reviews risk_reviews_risk_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risk_reviews
    ADD CONSTRAINT risk_reviews_risk_item_id_fkey FOREIGN KEY (risk_item_id) REFERENCES public.risk_items(id);


--
-- Name: risk_reviews risk_reviews_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risk_reviews
    ADD CONSTRAINT risk_reviews_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.organizations(id);


--
-- Name: tenant_subscriptions tenant_subscriptions_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_subscriptions
    ADD CONSTRAINT tenant_subscriptions_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.subscription_plans(id);


--
-- Name: tenant_subscriptions tenant_subscriptions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_subscriptions
    ADD CONSTRAINT tenant_subscriptions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: usage_records usage_records_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_records
    ADD CONSTRAINT usage_records_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: webhook_events webhook_events_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_events
    ADD CONSTRAINT webhook_events_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id);


--
-- Name: webhook_events webhook_events_delivery_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_events
    ADD CONSTRAINT webhook_events_delivery_id_fkey FOREIGN KEY (delivery_id) REFERENCES public.campaign_deliveries(id);


--
-- Name: campaign_acknowledgments acknowledgments_insert_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY acknowledgments_insert_self ON public.campaign_acknowledgments FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.campaign_recipients cr
  WHERE ((cr.id = campaign_acknowledgments.recipient_id) AND (cr.campaign_id = campaign_acknowledgments.campaign_id) AND (cr.user_id = auth.uid())))));


--
-- Name: campaign_acknowledgments acknowledgments_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY acknowledgments_select ON public.campaign_acknowledgments FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.campaigns c
     JOIN public.organization_members om ON ((om.tenant_id = c.tenant_id)))
  WHERE ((c.id = campaign_acknowledgments.campaign_id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['owner'::public.organization_role, 'admin'::public.organization_role, 'manager'::public.organization_role, 'auditor'::public.organization_role])) AND (om.deleted_at IS NULL)))));


--
-- Name: assessment_cycles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.assessment_cycles ENABLE ROW LEVEL SECURITY;

--
-- Name: assessment_cycles assessment_cycles_insert_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY assessment_cycles_insert_admin ON public.assessment_cycles FOR INSERT WITH CHECK (((tenant_id = public.fn_resolve_tenant_id()) AND public.fn_user_has_role(ARRAY['owner'::public.organization_role, 'admin'::public.organization_role, 'manager'::public.organization_role])));


--
-- Name: assessment_cycles assessment_cycles_select_tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY assessment_cycles_select_tenant ON public.assessment_cycles FOR SELECT USING (((tenant_id = public.fn_resolve_tenant_id()) AND (deleted_at IS NULL)));


--
-- Name: assessment_cycles assessment_cycles_update_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY assessment_cycles_update_admin ON public.assessment_cycles FOR UPDATE USING (((tenant_id = public.fn_resolve_tenant_id()) AND public.fn_user_has_role(ARRAY['owner'::public.organization_role, 'admin'::public.organization_role, 'manager'::public.organization_role]) AND (deleted_at IS NULL)));


--
-- Name: assessment_dispatches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.assessment_dispatches ENABLE ROW LEVEL SECURITY;

--
-- Name: assessment_dispatches assessment_dispatches_insert_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY assessment_dispatches_insert_admin ON public.assessment_dispatches FOR INSERT TO authenticated WITH CHECK (((tenant_id = public.fn_resolve_tenant_id()) AND public.fn_user_has_role(ARRAY['owner'::public.organization_role, 'admin'::public.organization_role, 'manager'::public.organization_role])));


--
-- Name: assessment_dispatches assessment_dispatches_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY assessment_dispatches_select_admin ON public.assessment_dispatches FOR SELECT TO authenticated USING (((tenant_id = public.fn_resolve_tenant_id()) AND public.fn_user_has_role(ARRAY['owner'::public.organization_role, 'admin'::public.organization_role, 'manager'::public.organization_role])));


--
-- Name: assessment_dispatches assessment_dispatches_update_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY assessment_dispatches_update_admin ON public.assessment_dispatches FOR UPDATE TO authenticated USING (((tenant_id = public.fn_resolve_tenant_id()) AND public.fn_user_has_role(ARRAY['owner'::public.organization_role, 'admin'::public.organization_role, 'manager'::public.organization_role]))) WITH CHECK (((tenant_id = public.fn_resolve_tenant_id()) AND public.fn_user_has_role(ARRAY['owner'::public.organization_role, 'admin'::public.organization_role, 'manager'::public.organization_role])));


--
-- Name: assessment_invitations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.assessment_invitations ENABLE ROW LEVEL SECURITY;

--
-- Name: assessment_invitations assessment_invitations_insert_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY assessment_invitations_insert_admin ON public.assessment_invitations FOR INSERT WITH CHECK (((tenant_id = public.fn_resolve_tenant_id()) AND public.fn_user_has_role(ARRAY['owner'::public.organization_role, 'admin'::public.organization_role, 'manager'::public.organization_role])));


--
-- Name: assessment_invitations assessment_invitations_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY assessment_invitations_select_admin ON public.assessment_invitations FOR SELECT USING (((tenant_id = public.fn_resolve_tenant_id()) AND public.fn_user_has_role(ARRAY['owner'::public.organization_role, 'admin'::public.organization_role, 'manager'::public.organization_role])));


--
-- Name: assessment_responses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.assessment_responses ENABLE ROW LEVEL SECURITY;

--
-- Name: complaint_audit_log audit_log_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_log_select ON public.complaint_audit_log FOR SELECT TO authenticated USING (((EXISTS ( SELECT 1
   FROM (public.complaints c
     JOIN public.organization_members om ON ((om.tenant_id = c.tenant_id)))
  WHERE ((c.id = complaint_audit_log.complaint_id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['owner'::public.organization_role, 'admin'::public.organization_role, 'auditor'::public.organization_role])) AND (om.deleted_at IS NULL)))) OR (EXISTS ( SELECT 1
   FROM public.complaint_investigators ci
  WHERE ((ci.complaint_id = complaint_audit_log.complaint_id) AND (ci.user_id = auth.uid()) AND (ci.removed_at IS NULL))))));


--
-- Name: billing_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;

--
-- Name: billing_events billing_events_tenant_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY billing_events_tenant_select ON public.billing_events FOR SELECT TO authenticated USING ((tenant_id = public.fn_resolve_tenant_id()));


--
-- Name: campaign_acknowledgments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.campaign_acknowledgments ENABLE ROW LEVEL SECURITY;

--
-- Name: campaign_deliveries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.campaign_deliveries ENABLE ROW LEVEL SECURITY;

--
-- Name: campaign_recipients; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.campaign_recipients ENABLE ROW LEVEL SECURITY;

--
-- Name: campaign_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.campaign_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: campaign_templates campaign_templates_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY campaign_templates_insert ON public.campaign_templates FOR INSERT TO authenticated WITH CHECK (((tenant_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.tenant_id = campaign_templates.tenant_id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['owner'::public.organization_role, 'admin'::public.organization_role, 'manager'::public.organization_role])) AND (om.deleted_at IS NULL))))));


--
-- Name: campaign_templates campaign_templates_select_system; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY campaign_templates_select_system ON public.campaign_templates FOR SELECT TO authenticated USING (((tenant_id IS NULL) AND (deleted_at IS NULL) AND (status = 'published'::text)));


--
-- Name: campaign_templates campaign_templates_select_tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY campaign_templates_select_tenant ON public.campaign_templates FOR SELECT TO authenticated USING (((tenant_id IS NOT NULL) AND (deleted_at IS NULL) AND (EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.tenant_id = campaign_templates.tenant_id) AND (om.user_id = auth.uid()) AND (om.deleted_at IS NULL))))));


--
-- Name: campaign_templates campaign_templates_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY campaign_templates_update ON public.campaign_templates FOR UPDATE TO authenticated USING (((tenant_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.tenant_id = campaign_templates.tenant_id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['owner'::public.organization_role, 'admin'::public.organization_role, 'manager'::public.organization_role])) AND (om.deleted_at IS NULL))))));


--
-- Name: campaigns; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

--
-- Name: campaigns campaigns_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY campaigns_insert ON public.campaigns FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.tenant_id = campaigns.tenant_id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['owner'::public.organization_role, 'admin'::public.organization_role, 'manager'::public.organization_role])) AND (om.deleted_at IS NULL)))));


--
-- Name: campaigns campaigns_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY campaigns_select ON public.campaigns FOR SELECT TO authenticated USING (((deleted_at IS NULL) AND (EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.tenant_id = campaigns.tenant_id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['owner'::public.organization_role, 'admin'::public.organization_role, 'manager'::public.organization_role, 'auditor'::public.organization_role])) AND (om.deleted_at IS NULL))))));


--
-- Name: campaigns campaigns_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY campaigns_update ON public.campaigns FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.tenant_id = campaigns.tenant_id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['owner'::public.organization_role, 'admin'::public.organization_role, 'manager'::public.organization_role])) AND (om.deleted_at IS NULL)))));


--
-- Name: complaint_audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.complaint_audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: complaint_contents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.complaint_contents ENABLE ROW LEVEL SECURITY;

--
-- Name: complaint_investigators; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.complaint_investigators ENABLE ROW LEVEL SECURITY;

--
-- Name: complaint_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.complaint_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: complaint_pin_attempts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.complaint_pin_attempts ENABLE ROW LEVEL SECURITY;

--
-- Name: complaints; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.complaints ENABLE ROW LEVEL SECURITY;

--
-- Name: complaints complaints_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY complaints_select_admin ON public.complaints FOR SELECT TO authenticated USING (((deleted_at IS NULL) AND (EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.tenant_id = complaints.tenant_id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['owner'::public.organization_role, 'admin'::public.organization_role, 'manager'::public.organization_role, 'investigator'::public.organization_role])) AND (om.deleted_at IS NULL))))));


--
-- Name: complaints complaints_select_investigator; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY complaints_select_investigator ON public.complaints FOR SELECT TO authenticated USING (((deleted_at IS NULL) AND public.fn_is_assigned_investigator(id)));


--
-- Name: complaints complaints_update_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY complaints_update_admin ON public.complaints FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.tenant_id = complaints.tenant_id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['owner'::public.organization_role, 'admin'::public.organization_role])) AND (om.deleted_at IS NULL))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.tenant_id = complaints.tenant_id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['owner'::public.organization_role, 'admin'::public.organization_role])) AND (om.deleted_at IS NULL)))));


--
-- Name: complaint_contents contents_select_investigator; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY contents_select_investigator ON public.complaint_contents FOR SELECT TO authenticated USING (public.fn_is_assigned_investigator(complaint_id));


--
-- Name: campaign_deliveries deliveries_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY deliveries_select ON public.campaign_deliveries FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.campaigns c
     JOIN public.organization_members om ON ((om.tenant_id = c.tenant_id)))
  WHERE ((c.id = campaign_deliveries.campaign_id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['owner'::public.organization_role, 'admin'::public.organization_role, 'manager'::public.organization_role, 'auditor'::public.organization_role])) AND (om.deleted_at IS NULL)))));


--
-- Name: departments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

--
-- Name: departments departments_insert_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY departments_insert_admin ON public.departments FOR INSERT WITH CHECK (((tenant_id = public.fn_resolve_tenant_id()) AND public.fn_user_has_role(ARRAY['owner'::public.organization_role, 'admin'::public.organization_role])));


--
-- Name: departments departments_select_tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY departments_select_tenant ON public.departments FOR SELECT USING (((tenant_id = public.fn_resolve_tenant_id()) AND (deleted_at IS NULL)));


--
-- Name: departments departments_update_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY departments_update_admin ON public.departments FOR UPDATE USING (((tenant_id = public.fn_resolve_tenant_id()) AND public.fn_user_has_role(ARRAY['owner'::public.organization_role, 'admin'::public.organization_role]) AND (deleted_at IS NULL)));


--
-- Name: employee_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.employee_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: employee_profiles employee_profiles_insert_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employee_profiles_insert_admin ON public.employee_profiles FOR INSERT WITH CHECK (((tenant_id = public.fn_resolve_tenant_id()) AND public.fn_user_has_role(ARRAY['owner'::public.organization_role, 'admin'::public.organization_role])));


--
-- Name: employee_profiles employee_profiles_select_tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employee_profiles_select_tenant ON public.employee_profiles FOR SELECT USING (((tenant_id = public.fn_resolve_tenant_id()) AND (deleted_at IS NULL)));


--
-- Name: employee_profiles employee_profiles_update_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employee_profiles_update_admin ON public.employee_profiles FOR UPDATE USING (((tenant_id = public.fn_resolve_tenant_id()) AND public.fn_user_has_role(ARRAY['owner'::public.organization_role, 'admin'::public.organization_role]) AND (deleted_at IS NULL)));


--
-- Name: establishments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.establishments ENABLE ROW LEVEL SECURITY;

--
-- Name: establishments establishments_insert_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY establishments_insert_admin ON public.establishments FOR INSERT WITH CHECK (((tenant_id = public.fn_resolve_tenant_id()) AND public.fn_user_has_role(ARRAY['owner'::public.organization_role, 'admin'::public.organization_role])));


--
-- Name: establishments establishments_select_tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY establishments_select_tenant ON public.establishments FOR SELECT USING (((tenant_id = public.fn_resolve_tenant_id()) AND (deleted_at IS NULL)));


--
-- Name: establishments establishments_update_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY establishments_update_admin ON public.establishments FOR UPDATE USING (((tenant_id = public.fn_resolve_tenant_id()) AND public.fn_user_has_role(ARRAY['owner'::public.organization_role, 'admin'::public.organization_role]) AND (deleted_at IS NULL)));


--
-- Name: evidence_audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.evidence_audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: evidence_audit_log evidence_audit_log_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY evidence_audit_log_select ON public.evidence_audit_log FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.tenant_id = evidence_audit_log.tenant_id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['owner'::public.organization_role, 'admin'::public.organization_role, 'auditor'::public.organization_role])) AND (om.deleted_at IS NULL)))));


--
-- Name: evidence_package_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.evidence_package_items ENABLE ROW LEVEL SECURITY;

--
-- Name: evidence_package_items evidence_package_items_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY evidence_package_items_delete ON public.evidence_package_items FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.evidence_packages ep
     JOIN public.organization_members om ON ((om.tenant_id = ep.tenant_id)))
  WHERE ((ep.id = evidence_package_items.package_id) AND (ep.status = 'draft'::public.package_status) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['owner'::public.organization_role, 'admin'::public.organization_role])) AND (om.deleted_at IS NULL) AND (ep.deleted_at IS NULL)))));


--
-- Name: evidence_package_items evidence_package_items_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY evidence_package_items_insert ON public.evidence_package_items FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.evidence_packages ep
     JOIN public.organization_members om ON ((om.tenant_id = ep.tenant_id)))
  WHERE ((ep.id = evidence_package_items.package_id) AND (ep.status = 'draft'::public.package_status) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['owner'::public.organization_role, 'admin'::public.organization_role])) AND (om.deleted_at IS NULL) AND (ep.deleted_at IS NULL)))));


--
-- Name: evidence_package_items evidence_package_items_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY evidence_package_items_select ON public.evidence_package_items FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.evidence_packages ep
     JOIN public.organization_members om ON ((om.tenant_id = ep.tenant_id)))
  WHERE ((ep.id = evidence_package_items.package_id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['owner'::public.organization_role, 'admin'::public.organization_role, 'manager'::public.organization_role, 'auditor'::public.organization_role])) AND (om.deleted_at IS NULL) AND (ep.deleted_at IS NULL)))));


--
-- Name: evidence_packages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.evidence_packages ENABLE ROW LEVEL SECURITY;

--
-- Name: evidence_packages evidence_packages_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY evidence_packages_insert ON public.evidence_packages FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.tenant_id = evidence_packages.tenant_id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['owner'::public.organization_role, 'admin'::public.organization_role])) AND (om.deleted_at IS NULL)))));


--
-- Name: evidence_packages evidence_packages_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY evidence_packages_select ON public.evidence_packages FOR SELECT TO authenticated USING (((deleted_at IS NULL) AND (EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.tenant_id = evidence_packages.tenant_id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['owner'::public.organization_role, 'admin'::public.organization_role, 'manager'::public.organization_role, 'auditor'::public.organization_role])) AND (om.deleted_at IS NULL))))));


--
-- Name: evidence_packages evidence_packages_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY evidence_packages_update ON public.evidence_packages FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.tenant_id = evidence_packages.tenant_id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['owner'::public.organization_role, 'admin'::public.organization_role])) AND (om.deleted_at IS NULL)))));


--
-- Name: evidence_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.evidence_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: evidence_reports evidence_reports_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY evidence_reports_select ON public.evidence_reports FOR SELECT TO authenticated USING (((deleted_at IS NULL) AND (EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.tenant_id = evidence_reports.tenant_id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['owner'::public.organization_role, 'admin'::public.organization_role, 'manager'::public.organization_role, 'auditor'::public.organization_role])) AND (om.deleted_at IS NULL))))));


--
-- Name: evidence_reports evidence_reports_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY evidence_reports_update ON public.evidence_reports FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.tenant_id = evidence_reports.tenant_id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['owner'::public.organization_role, 'admin'::public.organization_role])) AND (om.deleted_at IS NULL)))));


--
-- Name: complaint_investigators investigators_insert_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY investigators_insert_admin ON public.complaint_investigators FOR INSERT TO authenticated WITH CHECK (public.fn_is_complaint_tenant_admin(complaint_id));


--
-- Name: complaint_investigators investigators_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY investigators_select ON public.complaint_investigators FOR SELECT TO authenticated USING ((public.fn_is_complaint_tenant_admin(complaint_id) OR (user_id = auth.uid())));


--
-- Name: complaint_investigators investigators_update_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY investigators_update_admin ON public.complaint_investigators FOR UPDATE TO authenticated USING (public.fn_is_complaint_tenant_admin(complaint_id));


--
-- Name: invoices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

--
-- Name: invoices invoices_tenant_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY invoices_tenant_select ON public.invoices FOR SELECT TO authenticated USING ((tenant_id = public.fn_resolve_tenant_id()));


--
-- Name: complaint_messages messages_insert_investigator; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY messages_insert_investigator ON public.complaint_messages FOR INSERT TO authenticated WITH CHECK ((public.fn_is_assigned_investigator(complaint_id) AND (sender_type = 'investigator'::text)));


--
-- Name: complaint_messages messages_select_investigator; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY messages_select_investigator ON public.complaint_messages FOR SELECT TO authenticated USING (public.fn_is_assigned_investigator(complaint_id));


--
-- Name: organization_audit_log org_audit_log_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_audit_log_select_admin ON public.organization_audit_log FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.tenant_id = organization_audit_log.tenant_id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['owner'::public.organization_role, 'admin'::public.organization_role])) AND (om.deleted_at IS NULL)))));


--
-- Name: organization_audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organization_audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: organization_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

--
-- Name: organization_members organization_members_insert_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY organization_members_insert_admin ON public.organization_members FOR INSERT WITH CHECK (((tenant_id = public.fn_resolve_tenant_id()) AND public.fn_user_has_role(ARRAY['owner'::public.organization_role, 'admin'::public.organization_role])));


--
-- Name: organization_members organization_members_select_tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY organization_members_select_tenant ON public.organization_members FOR SELECT USING (((tenant_id = public.fn_resolve_tenant_id()) AND (deleted_at IS NULL)));


--
-- Name: organization_members organization_members_update_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY organization_members_update_admin ON public.organization_members FOR UPDATE USING (((tenant_id = public.fn_resolve_tenant_id()) AND public.fn_user_has_role(ARRAY['owner'::public.organization_role, 'admin'::public.organization_role]) AND (deleted_at IS NULL)));


--
-- Name: organizations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

--
-- Name: organizations organizations_select_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY organizations_select_member ON public.organizations FOR SELECT USING (((id = public.fn_resolve_tenant_id()) AND (deleted_at IS NULL)));


--
-- Name: organizations organizations_update_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY organizations_update_admin ON public.organizations FOR UPDATE USING (((id = public.fn_resolve_tenant_id()) AND public.fn_user_has_role(ARRAY['owner'::public.organization_role, 'admin'::public.organization_role]) AND (deleted_at IS NULL)));


--
-- Name: subscription_plans plans_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY plans_select ON public.subscription_plans FOR SELECT TO authenticated USING (true);


--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_select_own ON public.profiles FOR SELECT USING ((auth.uid() = id));


--
-- Name: profiles profiles_select_same_tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_select_same_tenant ON public.profiles FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.organization_members om1
     JOIN public.organization_members om2 ON ((om1.tenant_id = om2.tenant_id)))
  WHERE ((om1.user_id = auth.uid()) AND (om2.user_id = profiles.id) AND (om1.deleted_at IS NULL) AND (om2.deleted_at IS NULL)))));


--
-- Name: profiles profiles_service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_service_all ON public.profiles USING ((auth.role() = 'service_role'::text));


--
-- Name: profiles profiles_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_update_own ON public.profiles FOR UPDATE USING ((auth.uid() = id)) WITH CHECK ((auth.uid() = id));


--
-- Name: questionnaire_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.questionnaire_items ENABLE ROW LEVEL SECURITY;

--
-- Name: questionnaire_items questionnaire_items_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY questionnaire_items_select ON public.questionnaire_items FOR SELECT USING (((tenant_id IS NULL) OR (tenant_id = public.fn_resolve_tenant_id())));


--
-- Name: questionnaire_sections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.questionnaire_sections ENABLE ROW LEVEL SECURITY;

--
-- Name: questionnaire_sections questionnaire_sections_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY questionnaire_sections_select ON public.questionnaire_sections FOR SELECT USING (((tenant_id IS NULL) OR (tenant_id = public.fn_resolve_tenant_id())));


--
-- Name: questionnaire_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.questionnaire_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: questionnaire_templates questionnaire_templates_insert_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY questionnaire_templates_insert_admin ON public.questionnaire_templates FOR INSERT WITH CHECK (((tenant_id = public.fn_resolve_tenant_id()) AND public.fn_user_has_role(ARRAY['owner'::public.organization_role, 'admin'::public.organization_role])));


--
-- Name: questionnaire_templates questionnaire_templates_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY questionnaire_templates_select ON public.questionnaire_templates FOR SELECT USING ((((tenant_id IS NULL) OR (tenant_id = public.fn_resolve_tenant_id())) AND (deleted_at IS NULL)));


--
-- Name: campaign_recipients recipients_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY recipients_insert ON public.campaign_recipients FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.tenant_id = campaign_recipients.tenant_id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['owner'::public.organization_role, 'admin'::public.organization_role, 'manager'::public.organization_role])) AND (om.deleted_at IS NULL)))));


--
-- Name: campaign_recipients recipients_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY recipients_select ON public.campaign_recipients FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.tenant_id = campaign_recipients.tenant_id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['owner'::public.organization_role, 'admin'::public.organization_role, 'manager'::public.organization_role, 'auditor'::public.organization_role])) AND (om.deleted_at IS NULL)))));


--
-- Name: risk_action_plans; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.risk_action_plans ENABLE ROW LEVEL SECURITY;

--
-- Name: risk_action_plans risk_action_plans_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY risk_action_plans_insert ON public.risk_action_plans FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.tenant_id = risk_action_plans.tenant_id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['owner'::public.organization_role, 'admin'::public.organization_role, 'manager'::public.organization_role])) AND (om.deleted_at IS NULL)))));


--
-- Name: risk_action_plans risk_action_plans_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY risk_action_plans_select ON public.risk_action_plans FOR SELECT TO authenticated USING (((deleted_at IS NULL) AND (EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.tenant_id = risk_action_plans.tenant_id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['owner'::public.organization_role, 'admin'::public.organization_role, 'manager'::public.organization_role, 'investigator'::public.organization_role, 'auditor'::public.organization_role])) AND (om.deleted_at IS NULL))))));


--
-- Name: risk_action_plans risk_action_plans_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY risk_action_plans_update ON public.risk_action_plans FOR UPDATE TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.tenant_id = risk_action_plans.tenant_id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['owner'::public.organization_role, 'admin'::public.organization_role, 'manager'::public.organization_role])) AND (om.deleted_at IS NULL)))) OR (responsible_user_id = auth.uid())));


--
-- Name: risk_audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.risk_audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: risk_audit_log risk_audit_log_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY risk_audit_log_insert ON public.risk_audit_log FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.risk_items ri
     JOIN public.organization_members om ON ((om.tenant_id = ri.tenant_id)))
  WHERE ((ri.id = risk_audit_log.risk_item_id) AND (om.user_id = auth.uid()) AND (om.deleted_at IS NULL)))));


--
-- Name: risk_audit_log risk_audit_log_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY risk_audit_log_select ON public.risk_audit_log FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.risk_items ri
     JOIN public.organization_members om ON ((om.tenant_id = ri.tenant_id)))
  WHERE ((ri.id = risk_audit_log.risk_item_id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['owner'::public.organization_role, 'admin'::public.organization_role, 'auditor'::public.organization_role])) AND (om.deleted_at IS NULL)))));


--
-- Name: risk_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.risk_items ENABLE ROW LEVEL SECURITY;

--
-- Name: risk_items risk_items_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY risk_items_insert ON public.risk_items FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.tenant_id = risk_items.tenant_id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['owner'::public.organization_role, 'admin'::public.organization_role, 'manager'::public.organization_role])) AND (om.deleted_at IS NULL)))));


--
-- Name: risk_items risk_items_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY risk_items_select ON public.risk_items FOR SELECT TO authenticated USING (((deleted_at IS NULL) AND (EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.tenant_id = risk_items.tenant_id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['owner'::public.organization_role, 'admin'::public.organization_role, 'manager'::public.organization_role, 'investigator'::public.organization_role, 'auditor'::public.organization_role])) AND (om.deleted_at IS NULL))))));


--
-- Name: risk_items risk_items_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY risk_items_update ON public.risk_items FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.tenant_id = risk_items.tenant_id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['owner'::public.organization_role, 'admin'::public.organization_role, 'manager'::public.organization_role])) AND (om.deleted_at IS NULL)))));


--
-- Name: risk_reviews; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.risk_reviews ENABLE ROW LEVEL SECURITY;

--
-- Name: risk_reviews risk_reviews_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY risk_reviews_insert ON public.risk_reviews FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.tenant_id = risk_reviews.tenant_id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['owner'::public.organization_role, 'admin'::public.organization_role, 'manager'::public.organization_role])) AND (om.deleted_at IS NULL)))));


--
-- Name: risk_reviews risk_reviews_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY risk_reviews_select ON public.risk_reviews FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.organization_members om
  WHERE ((om.tenant_id = risk_reviews.tenant_id) AND (om.user_id = auth.uid()) AND (om.role = ANY (ARRAY['owner'::public.organization_role, 'admin'::public.organization_role, 'manager'::public.organization_role, 'investigator'::public.organization_role, 'auditor'::public.organization_role])) AND (om.deleted_at IS NULL)))));


--
-- Name: subscription_plans; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;

--
-- Name: tenant_subscriptions subscriptions_tenant_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY subscriptions_tenant_select ON public.tenant_subscriptions FOR SELECT TO authenticated USING ((tenant_id = public.fn_resolve_tenant_id()));


--
-- Name: tenant_subscriptions subscriptions_tenant_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY subscriptions_tenant_update ON public.tenant_subscriptions FOR UPDATE TO authenticated USING ((tenant_id = public.fn_resolve_tenant_id())) WITH CHECK ((tenant_id = public.fn_resolve_tenant_id()));


--
-- Name: tenant_subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tenant_subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: usage_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.usage_records ENABLE ROW LEVEL SECURITY;

--
-- Name: usage_records usage_tenant_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY usage_tenant_select ON public.usage_records FOR SELECT TO authenticated USING ((tenant_id = public.fn_resolve_tenant_id()));


--
-- Name: webhook_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\unrestrict A6Zhz5IJwJdToatIOqUQOAcnY9u6ElMSWBgmU7pj1Rb24IAQkoOzNDrjHQ20vQA

