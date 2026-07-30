BEGIN;

CREATE TABLE IF NOT EXISTS public.complaint_pin_attempts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol    text NOT NULL,
  ip_hash     text,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pin_attempts_protocol_time
  ON public.complaint_pin_attempts (protocol, attempted_at DESC);

COMMENT ON TABLE public.complaint_pin_attempts IS
  'Rate limiting for complaint PIN verification. Rows auto-pruned by fn_check_pin_rate_limit.';

ALTER TABLE public.complaint_pin_attempts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.fn_check_pin_rate_limit(
  p_protocol text,
  p_max_attempts integer DEFAULT 5,
  p_window_minutes integer DEFAULT 15
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $function$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM public.complaint_pin_attempts
  WHERE attempted_at < now() - (p_window_minutes || ' minutes')::interval;

  SELECT count(*) INTO v_count
  FROM public.complaint_pin_attempts
  WHERE protocol = p_protocol
    AND attempted_at >= now() - (p_window_minutes || ' minutes')::interval;

  IF v_count >= p_max_attempts THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.complaint_pin_attempts (protocol)
  VALUES (p_protocol);

  RETURN TRUE;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_check_pin_rate_limit(text, integer, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.fn_verify_complaint_pin(
  p_stored_hash text,
  p_pin text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $function$
DECLARE
  v_sha256_hash text;
  v_new_bcrypt  text;
BEGIN
  IF p_stored_hash LIKE '$2%' THEN
    RETURN p_stored_hash = extensions.crypt(p_pin, p_stored_hash);
  END IF;

  IF length(p_stored_hash) = 64 AND p_stored_hash ~ '^[0-9a-f]+$' THEN
    SELECT encode(
      extensions.digest(('complaint-pin-salt:' || p_pin)::bytea, 'sha256'),
      'hex'
    ) INTO v_sha256_hash;

    IF p_stored_hash = v_sha256_hash THEN
      v_new_bcrypt := extensions.crypt(p_pin, extensions.gen_salt('bf', 10));
      RETURN TRUE;
    ELSE
      RETURN FALSE;
    END IF;
  END IF;

  RETURN FALSE;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_verify_complaint_pin(text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.fn_submit_complaint(
  p_tenant_slug text,
  p_subject text,
  p_description text,
  p_category text,
  p_is_anonymous boolean,
  p_reporter_name text DEFAULT NULL,
  p_reporter_email text DEFAULT NULL,
  p_reporter_phone text DEFAULT NULL,
  p_establishment_name text DEFAULT NULL,
  p_department_name text DEFAULT NULL,
  p_pin_hash text DEFAULT NULL
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $function$
DECLARE
  v_tenant_id    uuid;
  v_complaint_id uuid;
  v_protocol     text;
  v_bcrypt_hash  text;
BEGIN
  IF p_pin_hash IS NULL OR length(p_pin_hash) < 6 OR length(p_pin_hash) > 32 THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_pin_length');
  END IF;

  SELECT id INTO v_tenant_id
  FROM public.organizations
  WHERE slug = p_tenant_slug AND deleted_at IS NULL;

  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_tenant');
  END IF;

  v_protocol := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  v_bcrypt_hash := extensions.crypt(p_pin_hash, extensions.gen_salt('bf', 10));

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
$function$;

GRANT EXECUTE ON FUNCTION public.fn_submit_complaint(text, text, text, text, boolean, text, text, text, text, text, text)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_access_complaint(
  p_protocol text,
  p_pin_hash text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $function$
DECLARE
  v_complaint  record;
  v_messages   jsonb;
  v_rate_ok    boolean;
  v_new_bcrypt text;
BEGIN
  SELECT public.fn_check_pin_rate_limit(p_protocol) INTO v_rate_ok;
  IF NOT v_rate_ok THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'rate_limited');
  END IF;

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

  IF v_complaint.pin_hash NOT LIKE '$2%' THEN
    v_new_bcrypt := extensions.crypt(p_pin_hash, extensions.gen_salt('bf', 10));
    UPDATE public.complaints
    SET pin_hash = v_new_bcrypt
    WHERE id = v_complaint.id;
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
$function$;

GRANT EXECUTE ON FUNCTION public.fn_access_complaint(text, text)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_send_reporter_message(
  p_protocol text,
  p_pin_hash text,
  p_body text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $function$
DECLARE
  v_complaint  record;
  v_message_id uuid;
  v_rate_ok    boolean;
  v_new_bcrypt text;
BEGIN
  SELECT public.fn_check_pin_rate_limit(p_protocol) INTO v_rate_ok;
  IF NOT v_rate_ok THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'rate_limited');
  END IF;

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

  IF v_complaint.pin_hash NOT LIKE '$2%' THEN
    v_new_bcrypt := extensions.crypt(p_pin_hash, extensions.gen_salt('bf', 10));
    UPDATE public.complaints
    SET pin_hash = v_new_bcrypt
    WHERE id = v_complaint.id;
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
$function$;

GRANT EXECUTE ON FUNCTION public.fn_send_reporter_message(text, text, text)
  TO anon, authenticated, service_role;

-- EXPAND PHASE: Keep old overload fn_get_complaint_list(uuid, text, int, int)
-- New overload with (text, int, int) added below — PostgREST resolves by param names

CREATE OR REPLACE FUNCTION public.fn_get_complaint_list(
  p_status text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE SECURITY DEFINER
  SET search_path = ''
AS $function$
DECLARE
  v_tenant_id uuid;
  v_user_role text;
  v_results   jsonb;
  v_total     bigint;
BEGIN
  SELECT om.tenant_id, om.role::text INTO v_tenant_id, v_user_role
  FROM public.organization_members om
  WHERE om.user_id = auth.uid()
    AND om.deleted_at IS NULL
    AND om.role IN ('owner', 'admin', 'manager', 'investigator')
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'forbidden');
  END IF;

  SELECT count(*) INTO v_total
  FROM public.complaints c
  WHERE c.tenant_id = v_tenant_id
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
  WHERE c.tenant_id = v_tenant_id
    AND c.deleted_at IS NULL
    AND (p_status IS NULL OR c.status::text = p_status)
  LIMIT p_limit
  OFFSET p_offset;

  RETURN jsonb_build_object('success', TRUE, 'complaints', v_results, 'total', v_total);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_get_complaint_list(text, integer, integer)
  TO authenticated, service_role;

COMMIT;
