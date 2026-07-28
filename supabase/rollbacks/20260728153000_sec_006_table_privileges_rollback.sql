-- Restaura somente os privilégios confirmados antes de SEC-006.
GRANT SELECT ON TABLE public.questionnaire_sections TO anon;
GRANT SELECT ON TABLE public.questionnaire_items TO anon;
GRANT SELECT ON TABLE public.subscription_plans TO authenticated;

