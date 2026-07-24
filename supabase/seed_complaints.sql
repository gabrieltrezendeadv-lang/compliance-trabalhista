-- ============================================================================
-- Seed: Canal de Denúncias — dados de teste
-- Pressupõe que o tenant Acme Corp (slug 'acme-corp') já existe,
-- e que existem usuários com roles admin, investigator no tenant.
-- ============================================================================

-- Usamos um bloco DO para gerar IDs dinâmicos
DO $$
DECLARE
  v_tenant_id    UUID;
  v_admin_id     UUID;
  v_investigator1_id UUID;
  v_investigator2_id UUID;
  v_complaint1_id UUID;
  v_complaint2_id UUID;
  v_complaint3_id UUID;
  v_complaint4_id UUID;
BEGIN

  -- -------------------------------------------------------
  -- Resolver IDs existentes
  -- -------------------------------------------------------
  SELECT id INTO v_tenant_id
  FROM public.organizations
  WHERE slug = 'acme-corp'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE NOTICE 'Tenant acme-corp não encontrado, pulando seed de denúncias';
    RETURN;
  END IF;

  -- Pegar o admin do tenant
  SELECT om.user_id INTO v_admin_id
  FROM public.organization_members om
  WHERE om.tenant_id = v_tenant_id
    AND om.role = 'admin'
    AND om.deleted_at IS NULL
  LIMIT 1;

  -- Pegar investigadores (se existirem; caso contrário, usar admin)
  SELECT om.user_id INTO v_investigator1_id
  FROM public.organization_members om
  WHERE om.tenant_id = v_tenant_id
    AND om.role = 'investigator'
    AND om.deleted_at IS NULL
  LIMIT 1;

  IF v_investigator1_id IS NULL THEN
    v_investigator1_id := v_admin_id;
  END IF;

  SELECT om.user_id INTO v_investigator2_id
  FROM public.organization_members om
  WHERE om.tenant_id = v_tenant_id
    AND om.role IN ('investigator', 'manager')
    AND om.user_id <> v_investigator1_id
    AND om.deleted_at IS NULL
  LIMIT 1;

  IF v_investigator2_id IS NULL THEN
    v_investigator2_id := v_investigator1_id;
  END IF;

  -- -------------------------------------------------------
  -- Denúncia 1: Assédio moral (investigating, com investigador)
  -- -------------------------------------------------------
  v_complaint1_id := gen_random_uuid();

  INSERT INTO public.complaints (
    id, tenant_id, protocol, pin_hash,
    category, severity, status, is_anonymous,
    created_at
  ) VALUES (
    v_complaint1_id, v_tenant_id, 'A1B2C3D4',
    -- PIN "1234" — hash simulado para seed (em produção seria bcrypt)
    '$2b$10$seedhashplaceholder1234assediomoral000000000000000000',
    'harassment', 'high', 'investigating', TRUE,
    now() - interval '15 days'
  );

  INSERT INTO public.complaint_contents (
    complaint_id, subject, description,
    establishment_name, department_name
  ) VALUES (
    v_complaint1_id,
    'Comportamento abusivo do gestor direto',
    'Venho relatar que nos últimos 3 meses o gestor da equipe tem adotado comportamentos que configuram assédio moral: humilhações públicas durante reuniões, atribuição de tarefas impossíveis com prazos irreais, isolamento de membros da equipe e ameaças veladas de demissão. Outros colegas também são afetados mas têm medo de reportar. Os incidentes mais graves ocorreram nas reuniões semanais de segunda-feira.',
    'Matriz São Paulo',
    'Produção'
  );

  -- Designar investigador
  INSERT INTO public.complaint_investigators (
    complaint_id, user_id, assigned_by, assigned_at
  ) VALUES (
    v_complaint1_id, v_investigator1_id, v_admin_id,
    now() - interval '14 days'
  );

  -- Mensagens na caixa segura
  INSERT INTO public.complaint_messages (complaint_id, sender_type, sender_id, body, created_at) VALUES
  (v_complaint1_id, 'investigator', v_investigator1_id,
   'Agradecemos o relato. Estamos iniciando a investigação. Poderia informar aproximadamente quantos colegas são afetados pela situação?',
   now() - interval '13 days'),
  (v_complaint1_id, 'reporter', NULL,
   'Somos cerca de 4 pessoas da mesma equipe. Os episódios acontecem principalmente durante as reuniões de segunda-feira às 10h.',
   now() - interval '12 days'),
  (v_complaint1_id, 'investigator', v_investigator1_id,
   'Obrigado pela informação adicional. A investigação está em andamento. Manteremos você informado sobre os desdobramentos.',
   now() - interval '10 days');

  -- Audit log
  INSERT INTO public.complaint_audit_log (complaint_id, actor_id, action, details, created_at) VALUES
  (v_complaint1_id, NULL, 'created',
   '{"category": "harassment", "is_anonymous": true}'::jsonb,
   now() - interval '15 days'),
  (v_complaint1_id, v_admin_id, 'status_changed',
   '{"old_status": "pending", "new_status": "under_review"}'::jsonb,
   now() - interval '14 days'),
  (v_complaint1_id, v_admin_id, 'investigator_assigned',
   jsonb_build_object('investigator_id', v_investigator1_id),
   now() - interval '14 days'),
  (v_complaint1_id, v_admin_id, 'status_changed',
   '{"old_status": "under_review", "new_status": "investigating"}'::jsonb,
   now() - interval '14 days');

  -- -------------------------------------------------------
  -- Denúncia 2: Assédio sexual (pending, recente)
  -- -------------------------------------------------------
  v_complaint2_id := gen_random_uuid();

  INSERT INTO public.complaints (
    id, tenant_id, protocol, pin_hash,
    category, severity, status, is_anonymous,
    created_at
  ) VALUES (
    v_complaint2_id, v_tenant_id, 'E5F6G7H8',
    '$2b$10$seedhashplaceholder5678assediosexual00000000000000000',
    'sexual_harassment', 'critical', 'pending', TRUE,
    now() - interval '2 days'
  );

  INSERT INTO public.complaint_contents (
    complaint_id, subject, description,
    establishment_name
  ) VALUES (
    v_complaint2_id,
    'Conduta inadequada em confraternização',
    'Durante a confraternização da empresa realizada na última sexta-feira, um gestor de outro departamento teve comportamento inapropriado: comentários de natureza sexual, contato físico não consentido (abraços forçados) e insistência para encontro fora do ambiente de trabalho. Há testemunhas do ocorrido.',
    'Matriz São Paulo'
  );

  INSERT INTO public.complaint_audit_log (complaint_id, actor_id, action, details, created_at) VALUES
  (v_complaint2_id, NULL, 'created',
   '{"category": "sexual_harassment", "is_anonymous": true}'::jsonb,
   now() - interval '2 days');

  -- -------------------------------------------------------
  -- Denúncia 3: Fraude (resolved, com identificação)
  -- -------------------------------------------------------
  v_complaint3_id := gen_random_uuid();

  INSERT INTO public.complaints (
    id, tenant_id, protocol, pin_hash,
    category, severity, status, is_anonymous,
    created_at, resolved_at
  ) VALUES (
    v_complaint3_id, v_tenant_id, 'I9J0K1L2',
    '$2b$10$seedhashplaceholder9012fraude000000000000000000000000',
    'fraud', 'medium', 'resolved', FALSE,
    now() - interval '45 days',
    now() - interval '10 days'
  );

  INSERT INTO public.complaint_contents (
    complaint_id, subject, description,
    reporter_name, reporter_email,
    establishment_name, department_name
  ) VALUES (
    v_complaint3_id,
    'Irregularidades em notas fiscais de fornecedor',
    'Identifiquei que o fornecedor XYZ Ltda tem emitido notas fiscais com valores superiores aos efetivamente praticados. A diferença entre o valor da NF e o valor real do serviço tem sido sistematicamente de 15-20%. Tenho documentos que comprovam 5 ocorrências nos últimos 6 meses.',
    'João da Silva',
    'joao.silva@example.com',
    'Filial Campinas',
    'Administrativo'
  );

  -- Investigador designado e removido (caso concluído)
  INSERT INTO public.complaint_investigators (
    complaint_id, user_id, assigned_by, assigned_at
  ) VALUES (
    v_complaint3_id, v_investigator2_id, v_admin_id,
    now() - interval '43 days'
  );

  INSERT INTO public.complaint_messages (complaint_id, sender_type, sender_id, body, created_at) VALUES
  (v_complaint3_id, 'investigator', v_investigator2_id,
   'Recebemos seu relato. Poderia nos enviar os documentos mencionados de forma segura?',
   now() - interval '42 days'),
  (v_complaint3_id, 'reporter', NULL,
   'Anexo as cópias das 5 notas fiscais e os comprovantes de pagamento real. O padrão de superfaturamento é consistente.',
   now() - interval '40 days'),
  (v_complaint3_id, 'investigator', v_investigator2_id,
   'A investigação foi concluída. As irregularidades foram confirmadas e as medidas corretivas estão sendo implementadas. O contrato com o fornecedor foi rescindido. Agradecemos o relato.',
   now() - interval '10 days');

  INSERT INTO public.complaint_audit_log (complaint_id, actor_id, action, details, created_at) VALUES
  (v_complaint3_id, NULL, 'created',
   '{"category": "fraud", "is_anonymous": false}'::jsonb,
   now() - interval '45 days'),
  (v_complaint3_id, v_admin_id, 'status_changed',
   '{"old_status": "pending", "new_status": "investigating"}'::jsonb,
   now() - interval '43 days'),
  (v_complaint3_id, v_admin_id, 'investigator_assigned',
   jsonb_build_object('investigator_id', v_investigator2_id),
   now() - interval '43 days'),
  (v_complaint3_id, v_admin_id, 'status_changed',
   '{"old_status": "investigating", "new_status": "resolved", "reason": "Irregularidades confirmadas. Contrato rescindido."}'::jsonb,
   now() - interval '10 days');

  -- -------------------------------------------------------
  -- Denúncia 4: Violação de segurança (dismissed)
  -- -------------------------------------------------------
  v_complaint4_id := gen_random_uuid();

  INSERT INTO public.complaints (
    id, tenant_id, protocol, pin_hash,
    category, severity, status, is_anonymous,
    created_at, resolved_at
  ) VALUES (
    v_complaint4_id, v_tenant_id, 'M3N4O5P6',
    '$2b$10$seedhashplaceholder3456seguranca0000000000000000000000',
    'safety_violation', 'low', 'dismissed', TRUE,
    now() - interval '30 days',
    now() - interval '20 days'
  );

  INSERT INTO public.complaint_contents (
    complaint_id, subject, description,
    establishment_name
  ) VALUES (
    v_complaint4_id,
    'Extintor de incêndio vencido no 3º andar',
    'O extintor de incêndio localizado no corredor do 3º andar está com a validade vencida desde o mês passado. Já informei à recepção mas nenhuma providência foi tomada.',
    'Matriz São Paulo'
  );

  INSERT INTO public.complaint_audit_log (complaint_id, actor_id, action, details, created_at) VALUES
  (v_complaint4_id, NULL, 'created',
   '{"category": "safety_violation", "is_anonymous": true}'::jsonb,
   now() - interval '30 days'),
  (v_complaint4_id, v_admin_id, 'status_changed',
   '{"old_status": "pending", "new_status": "dismissed", "reason": "Redirecionado para canal de manutenção predial. Não configura denúncia para o canal de compliance."}'::jsonb,
   now() - interval '20 days');

  RAISE NOTICE 'Seed de denúncias criado: 4 denúncias com mensagens e investigadores';
END;
$$;
