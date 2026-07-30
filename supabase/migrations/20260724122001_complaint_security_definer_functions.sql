-- ============================================================================
-- Migration: Canal de Denúncias — Funções SECURITY DEFINER
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_submit_complaint(
  p_tenant_slug  TEXT,
  p_subject      TEXT,
  p_description  TEXT,
  p_category     TEXT DEFAULT 'other',
  p_is_anonymous BOOLEAN DEFAULT TRUE,
  p_reporter_name  TEXT DEFAULT NULL,
  p_reporter_email TEXT DEFAULT NULL,
  p_reporter_phone TEXT DEFAULT NULL,
  p_establishment_name TEXT DEFAULT NULL,
  p_department_name    TEXT DEFAULT NULL,
  p_pin_hash     TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tenant_id   UUID;
  v_complaint_id UUID;
  v_protocol    TEXT;
BEGIN
  SELECT id INTO v_tenant_id
  FROM public.organizations
  WHERE slug = p_tenant_slug
    AND deleted_at IS NULL;

  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_request');
  END IF;

  IF p_subject IS NULL OR length(trim(p_subject)) < 5 THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'subject_too_short');
  END IF;

  IF p_description IS NULL OR length(trim(p_description)) < 10 THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'description_too_short');
  END IF;

  IF p_pin_hash IS NULL OR length(p_pin_hash) < 10 THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'pin_required');
  END IF;

  LOOP
    v_protocol := upper(encode(gen_random_bytes(4), 'hex'));
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.complaints WHERE protocol = v_protocol
    );
  END LOOP;

  INSERT INTO public.complaints (
    tenant_id, protocol, pin_hash, category, severity, status, is_anonymous
  ) VALUES (
    v_tenant_id, v_protocol, p_pin_hash,
    p_category::public.complaint_category,
    'medium'::public.complaint_severity,
    'pending'::public.complaint_status,
    p_is_anonymous
  )
  RETURNING id INTO v_complaint_id;

  INSERT INTO public.complaint_contents (
    complaint_id, subject, description,
    reporter_name, reporter_email, reporter_phone,
    establishment_name, department_name
  ) VALUES (
    v_complaint_id, trim(p_subject), trim(p_description),
    CASE WHEN p_is_anonymous THEN NULL ELSE p_reporter_name END,
    CASE WHEN p_is_anonymous THEN NULL ELSE p_reporter_email END,
    CASE WHEN p_is_anonymous THEN NULL ELSE p_reporter_phone END,
    p_establishment_name, p_department_name
  );

  INSERT INTO public.complaint_audit_log (
    complaint_id, actor_id, action, details
  ) VALUES (
    v_complaint_id, NULL, 'created',
    jsonb_build_object('category', p_category, 'is_anonymous', p_is_anonymous)
  );

  RETURN jsonb_build_object('success', TRUE, 'protocol', v_protocol);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_submit_complaint(TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
  TO anon, authenticated;


CREATE OR REPLACE FUNCTION public.fn_access_complaint(
  p_protocol TEXT,
  p_pin_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_complaint RECORD;
  v_messages  JSONB;
BEGIN
  SELECT c.id, c.status, c.category, c.severity, c.pin_hash,
         c.created_at, c.updated_at, c.is_anonymous
  INTO v_complaint
  FROM public.complaints c
  WHERE c.protocol = upper(trim(p_protocol))
    AND c.deleted_at IS NULL;

  IF v_complaint IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_credentials');
  END IF;

  IF v_complaint.pin_hash <> p_pin_hash THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_credentials');
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', m.id, 'sender_type', m.sender_type,
      'body', m.body, 'created_at', m.created_at
    ) ORDER BY m.created_at ASC
  ), '[]'::jsonb)
  INTO v_messages
  FROM public.complaint_messages m
  WHERE m.complaint_id = v_complaint.id;

  INSERT INTO public.complaint_audit_log (
    complaint_id, actor_id, action, details
  ) VALUES (
    v_complaint.id, NULL, 'reporter_accessed',
    jsonb_build_object('message_count', jsonb_array_length(v_messages))
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'complaint', jsonb_build_object(
      'status', v_complaint.status, 'category', v_complaint.category,
      'severity', v_complaint.severity, 'is_anonymous', v_complaint.is_anonymous,
      'created_at', v_complaint.created_at, 'updated_at', v_complaint.updated_at
    ),
    'messages', v_messages
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_access_complaint(TEXT, TEXT) TO anon, authenticated;


CREATE OR REPLACE FUNCTION public.fn_send_reporter_message(
  p_protocol TEXT,
  p_pin_hash TEXT,
  p_body     TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_complaint_id UUID;
  v_pin_hash_db  TEXT;
  v_status       public.complaint_status;
  v_message_id   UUID;
BEGIN
  SELECT id, pin_hash, status
  INTO v_complaint_id, v_pin_hash_db, v_status
  FROM public.complaints
  WHERE protocol = upper(trim(p_protocol))
    AND deleted_at IS NULL;

  IF v_complaint_id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_credentials');
  END IF;

  IF v_pin_hash_db <> p_pin_hash THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_credentials');
  END IF;

  IF v_status IN ('resolved', 'dismissed') THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'complaint_closed');
  END IF;

  IF p_body IS NULL OR length(trim(p_body)) < 1 THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'empty_message');
  END IF;

  INSERT INTO public.complaint_messages (
    complaint_id, sender_type, sender_id, body
  ) VALUES (
    v_complaint_id, 'reporter', NULL, trim(p_body)
  )
  RETURNING id INTO v_message_id;

  INSERT INTO public.complaint_audit_log (
    complaint_id, actor_id, action, details
  ) VALUES (
    v_complaint_id, NULL, 'message_sent',
    jsonb_build_object('sender_type', 'reporter', 'message_id', v_message_id)
  );

  RETURN jsonb_build_object('success', TRUE, 'message_id', v_message_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_send_reporter_message(TEXT, TEXT, TEXT) TO anon, authenticated;


CREATE OR REPLACE FUNCTION public.fn_get_complaint_list(
  p_tenant_id UUID,
  p_status    TEXT DEFAULT NULL,
  p_limit     INT DEFAULT 50,
  p_offset    INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
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
      'id', c.id, 'protocol', c.protocol,
      'category', c.category, 'severity', c.severity,
      'status', c.status, 'is_anonymous', c.is_anonymous,
      'created_at', c.created_at, 'updated_at', c.updated_at,
      'resolved_at', c.resolved_at,
      'investigator_count', (
        SELECT count(*) FROM public.complaint_investigators ci
        WHERE ci.complaint_id = c.id AND ci.removed_at IS NULL
      ),
      'message_count', (
        SELECT count(*) FROM public.complaint_messages cm
        WHERE cm.complaint_id = c.id
      )
    ) ORDER BY c.created_at DESC
  ), '[]'::jsonb)
  INTO v_results
  FROM public.complaints c
  WHERE c.tenant_id = p_tenant_id
    AND c.deleted_at IS NULL
    AND (p_status IS NULL OR c.status::text = p_status)
  LIMIT p_limit
  OFFSET p_offset;

  RETURN jsonb_build_object('success', TRUE, 'complaints', v_results, 'total', v_total);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_complaint_list(UUID, TEXT, INT, INT) TO authenticated;


CREATE OR REPLACE FUNCTION public.fn_get_complaint_detail(
  p_complaint_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
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

GRANT EXECUTE ON FUNCTION public.fn_get_complaint_detail(UUID) TO authenticated;


CREATE OR REPLACE FUNCTION public.fn_update_complaint_status(
  p_complaint_id UUID,
  p_new_status   TEXT,
  p_reason       TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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

GRANT EXECUTE ON FUNCTION public.fn_update_complaint_status(UUID, TEXT, TEXT) TO authenticated;
