REVOKE SELECT ON TABLE public.questionnaire_sections FROM anon;
REVOKE SELECT ON TABLE public.questionnaire_items FROM anon;
REVOKE SELECT ON TABLE public.subscription_plans FROM anon, authenticated;
