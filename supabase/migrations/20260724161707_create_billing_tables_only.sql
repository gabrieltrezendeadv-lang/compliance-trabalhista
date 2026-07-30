
-- Enums
DO $$ BEGIN CREATE TYPE public.billing_cycle AS ENUM ('monthly', 'yearly'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.payment_method AS ENUM ('boleto', 'pix', 'credit_card'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.invoice_status AS ENUM ('pending', 'paid', 'overdue', 'cancelled', 'refunded'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- plan_limits como tipo composto
DO $$ BEGIN
  CREATE TYPE public.plan_limits AS (
    max_establishments integer, max_departments integer, max_members integer,
    max_campaigns_per_month integer, max_assessments_per_month integer,
    evidence_storage_mb integer, has_api_access boolean, has_custom_branding boolean, has_priority_support boolean
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- subscription_plans
CREATE TABLE public.subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, slug text NOT NULL UNIQUE, description text,
  price_monthly integer NOT NULL, price_yearly integer,
  limits public.plan_limits NOT NULL,
  is_active boolean DEFAULT true, display_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "plans_select" ON public.subscription_plans FOR SELECT TO authenticated USING (true);
CREATE TRIGGER set_updated_at_subscription_plans BEFORE UPDATE ON public.subscription_plans FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- tenant_subscriptions
CREATE TABLE public.tenant_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.subscription_plans(id),
  status public.subscription_status DEFAULT 'trialing',
  billing_cycle public.billing_cycle DEFAULT 'monthly',
  payment_method public.payment_method,
  current_period_start timestamptz, current_period_end timestamptz,
  trial_ends_at timestamptz DEFAULT (now() + interval '14 days'),
  cancelled_at timestamptz,
  external_customer_id text, external_subscription_id text,
  grace_period_ends_at timestamptz, block_escalation_at timestamptz,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz,
  CONSTRAINT one_active_sub_per_tenant UNIQUE (tenant_id)
);
ALTER TABLE public.tenant_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "subscriptions_tenant_select" ON public.tenant_subscriptions FOR SELECT TO authenticated USING (tenant_id = fn_resolve_tenant_id());
CREATE POLICY "subscriptions_tenant_update" ON public.tenant_subscriptions FOR UPDATE TO authenticated USING (tenant_id = fn_resolve_tenant_id()) WITH CHECK (tenant_id = fn_resolve_tenant_id());
CREATE TRIGGER set_updated_at_tenant_subscriptions BEFORE UPDATE ON public.tenant_subscriptions FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- invoices
CREATE TABLE public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES public.tenant_subscriptions(id),
  status public.invoice_status DEFAULT 'pending',
  amount integer NOT NULL, currency text DEFAULT 'BRL',
  external_invoice_id text, external_payment_link text,
  due_date date NOT NULL, paid_at timestamptz, description text, metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "invoices_tenant_select" ON public.invoices FOR SELECT TO authenticated USING (tenant_id = fn_resolve_tenant_id());
CREATE TRIGGER set_updated_at_invoices BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- usage_records
CREATE TABLE public.usage_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  metric text NOT NULL, quantity integer NOT NULL DEFAULT 1,
  recorded_at timestamptz DEFAULT now(), period_start date NOT NULL, period_end date NOT NULL,
  metadata jsonb DEFAULT '{}'
);
ALTER TABLE public.usage_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "usage_tenant_select" ON public.usage_records FOR SELECT TO authenticated USING (tenant_id = fn_resolve_tenant_id());

-- billing_events
CREATE TABLE public.billing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  subscription_id uuid REFERENCES public.tenant_subscriptions(id),
  event_type text NOT NULL, description text, metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "billing_events_tenant_select" ON public.billing_events FOR SELECT TO authenticated USING (tenant_id = fn_resolve_tenant_id());

-- Índices
CREATE INDEX idx_tenant_subscriptions_tenant ON public.tenant_subscriptions(tenant_id);
CREATE INDEX idx_tenant_subscriptions_status ON public.tenant_subscriptions(status);
CREATE INDEX idx_invoices_tenant ON public.invoices(tenant_id);
CREATE INDEX idx_invoices_status ON public.invoices(status);
CREATE INDEX idx_invoices_due_date ON public.invoices(due_date);
CREATE INDEX idx_usage_records_tenant_metric ON public.usage_records(tenant_id, metric, period_start);
CREATE INDEX idx_billing_events_tenant ON public.billing_events(tenant_id);
CREATE INDEX idx_billing_events_type ON public.billing_events(event_type);

-- Seed planos
INSERT INTO public.subscription_plans (name, slug, description, price_monthly, price_yearly, limits, display_order) VALUES
  ('Starter', 'starter', 'Ideal para pequenas empresas iniciando seu programa de compliance', 19900, 199000, ROW(3,10,15,5,3,512,false,false,false)::public.plan_limits, 1),
  ('Professional', 'professional', 'Para empresas em crescimento com necessidades avançadas', 49900, 499000, ROW(10,50,50,20,10,2048,true,true,false)::public.plan_limits, 2),
  ('Enterprise', 'enterprise', 'Solução completa para grandes organizações', 149900, 1499000, ROW(NULL,NULL,NULL,NULL,NULL,NULL,true,true,true)::public.plan_limits, 3)
ON CONFLICT (slug) DO NOTHING;
