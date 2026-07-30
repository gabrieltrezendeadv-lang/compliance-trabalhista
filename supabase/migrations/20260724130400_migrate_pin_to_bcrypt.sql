
-- Drop existing functions first to allow signature changes
DROP FUNCTION IF EXISTS public.fn_submit_complaint(TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);

-- Helper: fn_verify_complaint_pin
CREATE OR REPLACE FUNCTION public.fn_verify_complaint_pin(
  p_stored_hash TEXT,
  p_pin TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sha256_hash TEXT;
BEGIN
  IF p_stored_hash LIKE '$2%' THEN
    RETURN p_stored_hash = extensions.crypt(p_pin, p_stored_hash);
  END IF;
  IF length(p_stored_hash) = 64 AND p_stored_hash ~ '^[0-9a-f]+$' THEN
    SELECT encode(
      extensions.digest(('complaint-pin-salt:' || p_pin)::bytea, 'sha256'),
      'hex'
    ) INTO v_sha256_hash;
    RETURN p_stored_hash = v_sha256_hash;
  END IF;
  RETURN FALSE;
END;
$$;

-- fn_submit_complaint: bcrypt hash (recreated)
CREATE FUNCTION public.fn_submit_complaint(
  p_tenant_slug TEXT,
  p_subject TEXT,
  p_description TEXT,
  p_category TEXT,
  p_is_anonymous BOOLEAN,
  p_reporter_name TEXT DEFAULT NULL,
  p_reporter_email TEXT DEFAULT NULL,
  p_reporter_phone TEXT DEFAULT NULL,
  p_establishment_name TEXT DEFAULT NULL,
  p_department_name TEXT DEFAULT NULL,
  p_pin_hash TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tenant_id UUID;
  v_complaint_id UUID;
  v_protocol TEXT;
  v_bcrypt_hash TEXT;
BEGIN
  SELECT id INTO v_tenant_id
  FROM public.organizations
  WHERE slug = p_tenant_slug AND deleted_at IS NULL;

  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_tenant');
  END IF;

  v_protocol := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  IF length(p_pin_hash) = 64 AND p_pin_hash ~ '^[0-9a-f]+$' THEN
    v_bcrypt_hash := p_pin_hash;
  ELSE
    v_bcrypt_hash := extensions.crypt(p_pin_hash, extensions.gen_salt('bf', 10));
  END IF;

  INSERT INTO public.complaints (
    id, tenant_id, protocol, category, severity, is_anonymous, pin_hash
  ) VALUES (
    gen_random_uuid(), v_tenant_id, v_protocol,
    p_category, 'medium', p_is_anonymous, v_bcrypt_hash
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
$$;

GRANT EXECUTE ON FUNCTION public.fn_submit_complaint(TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

-- fn_access_complaint: uses fn_verify_complaint_pin
CREATE OR REPLACE FUNCTION public.fn_access_complaint(
  p_protocol TEXT,
  p_pin_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_complaint RECORD;
  v_messages JSONB;
BEGIN
  SELECT c.id, c.status, c.category, c.severity, c.is_anonymous,
         c.pin_hash, c.created_at, c.updated_at
  INTO v_complaint
  FROM public.complaints c
  WHERE c.protocol = p_protocol;

  IF v_complaint IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_credentials');
  END IF;

  IF NOT public.fn_verify_complaint_pin(v_complaint.pin_hash, p_pin_hash) THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_credentials');
  END IF;

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
$$;

GRANT EXECUTE ON FUNCTION public.fn_access_complaint(TEXT, TEXT) TO anon, authenticated;

-- fn_send_reporter_message: uses fn_verify_complaint_pin
CREATE OR REPLACE FUNCTION public.fn_send_reporter_message(
  p_protocol TEXT,
  p_pin_hash TEXT,
  p_body TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_complaint RECORD;
  v_message_id UUID;
BEGIN
  SELECT c.id, c.status, c.pin_hash
  INTO v_complaint
  FROM public.complaints c
  WHERE c.protocol = p_protocol;

  IF v_complaint IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_credentials');
  END IF;

  IF NOT public.fn_verify_complaint_pin(v_complaint.pin_hash, p_pin_hash) THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_credentials');
  END IF;

  IF v_complaint.status IN ('closed', 'archived') THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'complaint_closed');
  END IF;

  INSERT INTO public.complaint_messages (
    complaint_id, sender_type, body
  ) VALUES (
    v_complaint.id, 'reporter', p_body
  ) RETURNING id INTO v_message_id;

  RETURN jsonb_build_object('success', TRUE, 'message_id', v_message_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_send_reporter_message(TEXT, TEXT, TEXT) TO anon, authenticated;
