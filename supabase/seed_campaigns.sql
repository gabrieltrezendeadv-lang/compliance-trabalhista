-- ============================================================================
-- Seed: Campanhas de Compliance — dados de teste
-- Pressupõe tenant Acme Corp com membros, estabelecimentos e departamentos.
-- ============================================================================

DO $$
DECLARE
  v_tenant_id       UUID;
  v_admin_id        UUID;
  v_template1_id    UUID;
  v_template2_id    UUID;
  v_campaign1_id    UUID;
  v_campaign2_id    UUID;
  v_campaign3_id    UUID;
  v_member          RECORD;
  v_recipient_id    UUID;
  v_delivery_id     UUID;
  v_count           INT := 0;
BEGIN

  -- Resolver IDs
  SELECT id INTO v_tenant_id
  FROM public.organizations
  WHERE slug = 'acme-corp'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE NOTICE 'Tenant acme-corp não encontrado, pulando seed de campanhas';
    RETURN;
  END IF;

  SELECT om.user_id INTO v_admin_id
  FROM public.organization_members om
  WHERE om.tenant_id = v_tenant_id
    AND om.role = 'admin'
    AND om.deleted_at IS NULL
  LIMIT 1;

  -- -------------------------------------------------------
  -- Template 1: Comunicação Lei 15.377/2025
  -- -------------------------------------------------------
  v_template1_id := gen_random_uuid();

  INSERT INTO public.campaign_templates (
    id, tenant_id, name, description, type, channel,
    subject, body_html, body_text,
    legal_basis, requires_acknowledgment, status, created_by
  ) VALUES (
    v_template1_id, NULL,
    'Informativo sobre Riscos Psicossociais — Lei 15.377/2025',
    'Template padrão para comunicação dos resultados da avaliação de riscos psicossociais conforme Lei 15.377/2025.',
    'legal_notice', 'email',
    'Resultados da Avaliação de Riscos Psicossociais — {{empresa}}',
    '<h1>Resultados da Avaliação de Riscos Psicossociais</h1>
<p>Prezado(a) {{nome}},</p>
<p>Em cumprimento à Lei nº 15.377/2025 e à NR-1, informamos os resultados agregados da avaliação de riscos psicossociais realizada em nossa organização.</p>
<p>Os resultados completos estão disponíveis para consulta no painel de compliance da empresa.</p>
<h2>Principais achados</h2>
<p>{{resumo_resultados}}</p>
<h2>Plano de ação</h2>
<p>Com base nos resultados, a empresa está implementando as seguintes medidas:</p>
<p>{{plano_acao}}</p>
<p>Em caso de dúvidas, entre em contato com o setor de Recursos Humanos.</p>
<p><em>Este relatório depende de validação por profissional habilitado.</em></p>',
    'Resultados da Avaliação de Riscos Psicossociais

Prezado(a) {{nome}},

Em cumprimento à Lei nº 15.377/2025 e à NR-1, informamos os resultados agregados da avaliação de riscos psicossociais realizada em nossa organização.

Os resultados completos estão disponíveis para consulta no painel de compliance da empresa.

Em caso de dúvidas, entre em contato com o setor de Recursos Humanos.

Este relatório depende de validação por profissional habilitado.',
    'Lei 15.377/2025, art. 2º; NR-1 item 1.5.3.3',
    TRUE,
    'published',
    v_admin_id
  );

  -- -------------------------------------------------------
  -- Template 2: Canal de denúncias
  -- -------------------------------------------------------
  v_template2_id := gen_random_uuid();

  INSERT INTO public.campaign_templates (
    id, tenant_id, name, description, type, channel,
    subject, body_text,
    legal_basis, requires_acknowledgment, status, created_by
  ) VALUES (
    v_template2_id, NULL,
    'Divulgação do Canal de Denúncias',
    'Template para comunicação sobre existência e acesso ao canal de denúncias conforme Lei 14.457/2022.',
    'informational', 'both',
    'Canal de Denúncias — {{empresa}}',
    'Prezado(a) {{nome}},

Informamos que a {{empresa}} disponibiliza um Canal de Denúncias seguro e confidencial para relato de irregularidades, em conformidade com a Lei 14.457/2022.

Acesse: {{link_canal}}

O canal aceita denúncias anônimas. Nenhum dado de identificação é registrado sem seu consentimento.

Em caso de dúvidas, procure o setor de Compliance.',
    'Lei 14.457/2022, art. 23',
    FALSE,
    'published',
    v_admin_id
  );

  -- -------------------------------------------------------
  -- Campanha 1: Enviada (Lei 15.377)
  -- -------------------------------------------------------
  v_campaign1_id := gen_random_uuid();

  INSERT INTO public.campaigns (
    id, tenant_id, template_id, name, description,
    type, channel, status,
    subject, body_text,
    legal_basis, requires_acknowledgment,
    sent_at, completed_at,
    total_recipients, created_by,
    created_at
  ) VALUES (
    v_campaign1_id, v_tenant_id, v_template1_id,
    'Comunicação de Resultados — Avaliação Jul/2026',
    'Divulgação dos resultados agregados da avaliação de riscos psicossociais conforme Lei 15.377/2025.',
    'risk_assessment', 'email', 'sent',
    'Resultados da Avaliação de Riscos Psicossociais — Acme Corp',
    'Prezado(a) colaborador(a), informamos os resultados da avaliação de riscos psicossociais realizada em julho de 2026. Os resultados foram analisados por profissional habilitado e as medidas cabíveis estão sendo implementadas. Consulte o painel de compliance para mais detalhes. Este relatório depende de validação por profissional habilitado.',
    'Lei 15.377/2025, art. 2º',
    TRUE,
    now() - interval '5 days',
    now() - interval '5 days',
    0, v_admin_id,
    now() - interval '7 days'
  );

  -- Recipients e deliveries para a campanha 1
  FOR v_member IN
    SELECT om.user_id, COALESCE(p.full_name, p.email, 'Colaborador') AS full_name,
           p.email, om.establishment_id, om.department_id
    FROM public.organization_members om
    LEFT JOIN public.profiles p ON p.id = om.user_id
    WHERE om.tenant_id = v_tenant_id
      AND om.deleted_at IS NULL
      AND om.role IN ('collaborator', 'manager')
    LIMIT 8
  LOOP
    v_recipient_id := gen_random_uuid();

    INSERT INTO public.campaign_recipients (
      id, campaign_id, tenant_id, user_id,
      full_name, email, establishment_id, department_id, channel
    ) VALUES (
      v_recipient_id, v_campaign1_id, v_tenant_id, v_member.user_id,
      v_member.full_name, v_member.email,
      v_member.establishment_id, v_member.department_id,
      'email'
    );

    v_delivery_id := gen_random_uuid();
    v_count := v_count + 1;

    -- Simular entregas em vários status
    INSERT INTO public.campaign_deliveries (
      id, campaign_id, recipient_id, channel, status,
      provider_id, queued_at, sent_at, delivered_at,
      created_at
    ) VALUES (
      v_delivery_id, v_campaign1_id, v_recipient_id, 'email',
      CASE
        WHEN v_count <= 5 THEN 'delivered'::public.delivery_status
        WHEN v_count <= 7 THEN 'sent'::public.delivery_status
        ELSE 'bounced'::public.delivery_status
      END,
      'resend_' || encode(gen_random_bytes(8), 'hex'),
      now() - interval '5 days',
      now() - interval '5 days',
      CASE WHEN v_count <= 5 THEN now() - interval '5 days' ELSE NULL END,
      now() - interval '5 days'
    );

    -- Acknowledgments (3 dos 5 entregues confirmaram ciência)
    IF v_count <= 3 THEN
      INSERT INTO public.campaign_acknowledgments (
        campaign_id, recipient_id, acknowledged_at
      ) VALUES (
        v_campaign1_id, v_recipient_id,
        now() - interval '4 days' + (v_count || ' hours')::interval
      );
    END IF;
  END LOOP;

  -- Atualizar total_recipients
  UPDATE public.campaigns SET total_recipients = v_count WHERE id = v_campaign1_id;

  -- -------------------------------------------------------
  -- Campanha 2: Agendada (Canal de denúncias)
  -- -------------------------------------------------------
  v_campaign2_id := gen_random_uuid();

  INSERT INTO public.campaigns (
    id, tenant_id, template_id, name, description,
    type, channel, status,
    subject, body_text,
    legal_basis, requires_acknowledgment,
    scheduled_at,
    total_recipients, created_by,
    created_at
  ) VALUES (
    v_campaign2_id, v_tenant_id, v_template2_id,
    'Divulgação do Canal de Denúncias — Agosto 2026',
    'Campanha de conscientização sobre o canal de denúncias, conforme Lei 14.457/2022.',
    'informational', 'email', 'scheduled',
    'Canal de Denúncias — Acme Corp',
    'Prezado(a) colaborador(a), informamos que a Acme Corp disponibiliza um Canal de Denúncias seguro e confidencial. Acesse: https://app.example.com/report/acme-corp. O canal aceita denúncias anônimas.',
    'Lei 14.457/2022, art. 23',
    FALSE,
    now() + interval '7 days',
    0, v_admin_id,
    now() - interval '1 day'
  );

  -- -------------------------------------------------------
  -- Campanha 3: Rascunho
  -- -------------------------------------------------------
  v_campaign3_id := gen_random_uuid();

  INSERT INTO public.campaigns (
    id, tenant_id, name, description,
    type, channel, status,
    subject, body_text,
    total_recipients, created_by,
    created_at
  ) VALUES (
    v_campaign3_id, v_tenant_id,
    'Treinamento NR-1 — Prevenção de Riscos Psicossociais',
    'Convocação para treinamento obrigatório sobre prevenção de riscos psicossociais no ambiente de trabalho.',
    'training', 'email', 'draft',
    'Convocação: Treinamento sobre Riscos Psicossociais',
    'Prezado(a) colaborador(a), você está convocado(a) para o treinamento obrigatório sobre prevenção de riscos psicossociais, conforme NR-1. Data e local serão informados em breve.',
    0, v_admin_id,
    now()
  );

  RAISE NOTICE 'Seed de campanhas criado: 2 templates, 3 campanhas (sent, scheduled, draft)';
END;
$$;
