-- Tabela profiles — espelho público de auth.users
CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name   TEXT NOT NULL DEFAULT '',
  email       TEXT NOT NULL DEFAULT '',
  phone       TEXT,
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);

COMMENT ON TABLE public.profiles IS 'Perfil público do usuário — espelho de auth.users com campos editáveis';

CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles (email);

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- Trigger: auto-criar profile quando usuário é inserido em auth.users
CREATE OR REPLACE FUNCTION public.fn_handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.fn_handle_new_user();

-- RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE POLICY profiles_select_same_tenant ON public.profiles
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members om1
      JOIN public.organization_members om2 ON om1.tenant_id = om2.tenant_id
      WHERE om1.user_id = auth.uid()
        AND om2.user_id = profiles.id
        AND om1.deleted_at IS NULL
        AND om2.deleted_at IS NULL
    )
  );

CREATE POLICY profiles_service_all ON public.profiles
  FOR ALL USING (auth.role() = 'service_role');

-- Criar profiles para auth.users existentes
INSERT INTO public.profiles (id, full_name, email)
SELECT
  u.id,
  COALESCE(u.raw_user_meta_data->>'full_name', ''),
  COALESCE(u.email, '')
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id);

-- FK para Supabase client resolver relação em .select("*, profiles(...)")
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organization_members_user_id_profiles_fkey'
  ) THEN
    ALTER TABLE public.organization_members
      ADD CONSTRAINT organization_members_user_id_profiles_fkey
      FOREIGN KEY (user_id) REFERENCES public.profiles(id);
  END IF;
END;
$$;
