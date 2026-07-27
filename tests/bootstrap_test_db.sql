-- =============================================================================
-- Bootstrap: Simulates Supabase environment for local testing
-- Creates roles, auth schema, pgcrypto wrappers, enums, tables
-- =============================================================================

-- 1. Roles (simulate Supabase roles)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    CREATE ROLE supabase_admin NOLOGIN;
  END IF;
END $$;

-- Grant usage on public schema to all roles
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, supabase_admin;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

-- 2. Pgcrypto wrappers in extensions schema (Supabase puts pgcrypto in extensions)
CREATE OR REPLACE FUNCTION extensions.crypt(text, text)
RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT public.crypt($1, $2); $$;

CREATE OR REPLACE FUNCTION extensions.gen_salt(text, integer DEFAULT 10)
RETURNS text LANGUAGE sql VOLATILE AS
$$ SELECT public.gen_salt($1, $2); $$;

CREATE OR REPLACE FUNCTION extensions.digest(bytea, text)
RETURNS bytea LANGUAGE sql IMMUTABLE AS
$$ SELECT public.digest($1, $2); $$;

CREATE OR REPLACE FUNCTION extensions.hmac(bytea, bytea, text)
RETURNS bytea LANGUAGE sql IMMUTABLE AS
$$ SELECT public.hmac($1, $2, $3); $$;

GRANT EXECUTE ON FUNCTION extensions.crypt(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION extensions.gen_salt(text, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION extensions.digest(bytea, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION extensions.hmac(bytea, bytea, text) TO anon, authenticated, service_role;

-- 3. auth.uid() and auth.role() simulation
-- We use a GUC (request.jwt.claim.sub) to simulate the current user
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid; $$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS text LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('request.jwt.claim.role', true), ''); $$;

-- auth.users table (minimal)
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  created_at timestamptz DEFAULT now()
);
GRANT SELECT ON auth.users TO authenticated, service_role;

-- 4. Enums
DO $$ BEGIN
  CREATE TYPE public.organization_role AS ENUM (
    'owner', 'admin', 'manager', 'investigator', 'auditor', 'viewer', 'collaborator'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.complaint_category AS ENUM (
    'harassment', 'discrimination', 'safety', 'fraud', 'retaliation', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.complaint_severity AS ENUM (
    'low', 'medium', 'high', 'critical'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.complaint_status AS ENUM (
    'pending', 'under_investigation', 'resolved', 'dismissed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.subscription_status AS ENUM (
    'active', 'trial', 'partially_blocked', 'fully_blocked', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.campaign_status AS ENUM (
    'draft', 'scheduled', 'sending', 'sent', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.delivery_channel AS ENUM (
    'email', 'whatsapp', 'both'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.delivery_status AS ENUM (
    'pending', 'queued', 'sent', 'delivered', 'read', 'failed', 'bounced', 'rejected'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.campaign_type AS ENUM (
    'informational', 'risk_assessment', 'policy_update', 'training', 'legal_notice', 'custom'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 5. Core tables (minimal for function testing)
CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  deleted_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id),
  full_name text,
  email text,
  phone text
);

CREATE TABLE IF NOT EXISTS public.organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  role public.organization_role NOT NULL DEFAULT 'viewer',
  establishment_id uuid,
  department_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  limits jsonb DEFAULT '{}'
);

-- Composite type for plan limits — check_plan_limit uses (p.limits).max_* syntax
DO $$ BEGIN
  CREATE TYPE public.plan_limits AS (
    max_establishments integer,
    max_departments integer,
    max_members integer,
    max_campaigns_per_month integer,
    max_assessments_per_month integer
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Replace jsonb 'limits' column with composite type column
-- (production schema uses composite type; bootstrap originally used jsonb)
ALTER TABLE public.subscription_plans DROP COLUMN IF EXISTS limits;
ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS limits public.plan_limits;

CREATE TABLE IF NOT EXISTS public.tenant_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id),
  plan_id uuid NOT NULL REFERENCES public.subscription_plans(id),
  status public.subscription_status NOT NULL DEFAULT 'active',
  deleted_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.complaints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id),
  protocol text NOT NULL UNIQUE,
  pin_hash text,
  category public.complaint_category DEFAULT 'other',
  severity public.complaint_severity DEFAULT 'medium',
  status public.complaint_status DEFAULT 'pending',
  is_anonymous boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  resolved_at timestamptz,
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.complaint_contents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id uuid NOT NULL REFERENCES public.complaints(id),
  subject text,
  description text,
  reporter_name text,
  reporter_email text,
  reporter_phone text,
  establishment_name text,
  department_name text
);

CREATE TABLE IF NOT EXISTS public.complaint_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id uuid NOT NULL REFERENCES public.complaints(id),
  sender_type text NOT NULL,
  sender_id uuid,
  body text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.complaint_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id uuid NOT NULL REFERENCES public.complaints(id),
  actor_id uuid,
  action text NOT NULL,
  details jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.complaint_investigators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id uuid NOT NULL REFERENCES public.complaints(id),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  assigned_at timestamptz DEFAULT now(),
  removed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.complaint_pin_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol text NOT NULL,
  ip_hash text,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pin_attempts_protocol_time
  ON public.complaint_pin_attempts (protocol, attempted_at DESC);

ALTER TABLE public.complaint_pin_attempts ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.organization_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id),
  actor_id uuid,
  action text NOT NULL,
  target_type text,
  target_id uuid,
  details jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- Campaign tables
CREATE TABLE IF NOT EXISTS public.campaign_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.organizations(id),
  name text NOT NULL,
  description text,
  type public.campaign_type NOT NULL DEFAULT 'informational',
  channel public.delivery_channel NOT NULL DEFAULT 'email',
  subject text NOT NULL DEFAULT '',
  body_html text,
  body_text text NOT NULL DEFAULT '',
  legal_basis text,
  requires_acknowledgment boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'draft',
  version int NOT NULL DEFAULT 1,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id),
  template_id uuid REFERENCES public.campaign_templates(id),
  name text NOT NULL,
  description text,
  type public.campaign_type NOT NULL DEFAULT 'informational',
  channel public.delivery_channel NOT NULL DEFAULT 'email',
  status public.campaign_status NOT NULL DEFAULT 'draft',
  subject text NOT NULL DEFAULT '',
  body_html text,
  body_text text NOT NULL DEFAULT '',
  legal_basis text,
  requires_acknowledgment boolean NOT NULL DEFAULT false,
  scheduled_at timestamptz,
  sent_at timestamptz,
  completed_at timestamptz,
  target_scope jsonb,
  assessment_cycle_id uuid,
  total_recipients int NOT NULL DEFAULT 0,
  idempotency_key text NOT NULL DEFAULT gen_random_uuid()::text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.campaign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.organizations(id),
  user_id uuid REFERENCES auth.users(id),
  full_name text NOT NULL,
  email text,
  phone text,
  establishment_id uuid,
  department_id uuid,
  channel public.delivery_channel NOT NULL DEFAULT 'email',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.campaign_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES public.campaign_recipients(id) ON DELETE CASCADE,
  channel public.delivery_channel NOT NULL,
  status public.delivery_status NOT NULL DEFAULT 'pending',
  provider_id text,
  idempotency_key text NOT NULL DEFAULT gen_random_uuid()::text,
  queued_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  error_code text,
  error_message text,
  attempt_count int NOT NULL DEFAULT 1,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.campaign_acknowledgments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES public.campaign_recipients(id) ON DELETE CASCADE,
  acknowledged_at timestamptz DEFAULT now(),
  ip_address inet,
  user_agent text,
  CONSTRAINT uq_acknowledgment UNIQUE (campaign_id, recipient_id)
);

-- Webhook events table
CREATE TABLE IF NOT EXISTS public.webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text,
  event_id text,
  provider_message_id text,
  event_type text,
  delivery_id uuid,
  campaign_id uuid,
  payload jsonb DEFAULT '{}'::jsonb,
  received_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_events_event_id_unique
  ON public.webhook_events (event_id);

CREATE INDEX IF NOT EXISTS idx_campaign_deliveries_provider_id
  ON public.campaign_deliveries (provider_id)
  WHERE provider_id IS NOT NULL;

-- Employee profiles (for SEC-005 campaign targeting)
CREATE TABLE IF NOT EXISTS public.employee_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id),
  user_id uuid REFERENCES auth.users(id),
  establishment_id uuid,
  department_id uuid,
  full_name text NOT NULL,
  email text,
  phone text,
  job_title text,
  hire_date date,
  status text DEFAULT 'active',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz
);

-- Establishments and departments tables (for check_plan_limit counting)
CREATE TABLE IF NOT EXISTS public.establishments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id),
  name text NOT NULL,
  deleted_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id),
  name text NOT NULL,
  establishment_id uuid REFERENCES public.establishments(id),
  deleted_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.assessment_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id),
  name text,
  deleted_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Dedup indexes from SEC-005
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_recipients_dedup
  ON public.campaign_recipients (campaign_id, user_id, channel)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_recipients_dedup_email
  ON public.campaign_recipients (campaign_id, email, channel)
  WHERE user_id IS NULL AND email IS NOT NULL;

-- Grant table access to roles
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;

-- Helper to set auth context for testing
CREATE OR REPLACE FUNCTION test_set_auth(p_user_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
END;
$$;

CREATE OR REPLACE FUNCTION test_clear_auth()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END;
$$;
