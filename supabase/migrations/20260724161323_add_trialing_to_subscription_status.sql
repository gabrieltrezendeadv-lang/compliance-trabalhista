
ALTER TYPE public.subscription_status ADD VALUE IF NOT EXISTS 'trialing' BEFORE 'active';
