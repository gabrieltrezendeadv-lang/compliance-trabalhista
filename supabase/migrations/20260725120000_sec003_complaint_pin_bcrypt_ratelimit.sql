-- SEC-003: Fix complaint PIN handling — always bcrypt, rate limiting, anti-enumeration
--
-- PROBLEMS:
-- 1. fn_submit_complaint still accepts pre-hashed SHA-256 from frontend (if 64 hex chars)
-- 2. fn_verify_complaint_pin has SHA-256 fallback path with fixed salt (weak)
-- 3. fn_access_complaint and fn_send_reporter_message pass p_pin_hash (SHA-256 from frontend)
--    instead of raw PIN for bcrypt verification
-- 4. No rate limiting on PIN verification attempts
-- 5. Same error message for "not found" and "wrong PIN" (anti-enumeration already OK)
--
-- FIX:
-- 1. fn_submit_complaint ALWAYS bcrypt-hashes the raw PIN (remove SHA-256 passthrough)
-- 2. fn_access_complaint and fn_send_reporter_message accept raw PIN (p_pin, not p_pin_hash)
-- 3. fn_verify_complaint_pin uses bcrypt only, rehashes SHA-256 legacy on successful verify
-- 4. Add rate_limit_attempts table + check in verification functions
-- 5. Rename parameters to make intent clear (p_pin not p_pin_hash)
--
-- NEO SST: "conteúdo de denúncias somente para investigadores designados"
-- NEO SST: "nunca registrar dados pessoais sensíveis" (PIN never logged)

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Rate limiting table for PIN attempts
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.complaint_pin_attempts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol    text NOT NULL,
  ip_hash     text,                -- SHA-256 of IP (no raw IP stored per NEO SST)
  attempted_at timestamptz NOT NULL DEFAULT now()
);

-- Index for efficient lookups by protocol + time window
CREATE INDEX IF NOT EXISTS idx_pin_attempts_protocol_time
  ON public.complaint_pin_attempts (protocol, attempted_at DESC);

-- Auto-cleanup: rows older than 1 hour are irrelevant
COMMENT ON TABLE public.complaint_pin_attempts IS
  'Rate limiting for complaint PIN verification. Rows auto-pruned by fn_check_pin_rate_limit.';

-- RLS: no direct client access (only via SECURITY DEFINER functions)
ALTER TABLE public.complaint_pin_attempts ENABLE ROW LEVEL SECURITY;
-- No policies = deny all direct access. Functions use SECURITY DEFINER bypass.

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Rate limit check function
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_check_pin_rate_limit(
  p_protocol text,
  p_max_attempts integer DEFAULT 5,
  p_window_minutes integer DEFAULT 15
)
  RETURNS boolean  -- TRUE = allowed, FALSE = rate limited
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $function$
DECLARE
  v_count integer;
BEGIN
  -- Prune old attempts (older than window)
  DELETE FROM public.complaint_pin_attempts
  WHERE attempted_at < now() - (p_window_minutes || ' minutes')::interval;

  -- Count recent attempts for this protocol
  SELECT count(*) INTO v_count
  FROM public.complaint_pin_attempts
  WHERE protocol = p_protocol
    AND attempted_at >= now() - (p_window_minutes || ' minutes')::interval;

  IF v_count >= p_max_attempts THEN
    RETURN FALSE;
  END IF;

  -- Record this attempt
  INSERT INTO public.complaint_pin_attempts (protocol)
  VALUES (p_protocol);

  RETURN TRUE;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_check_pin_rate_limit(text, integer, integer)
  TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Fix fn_verify_complaint_pin — bcrypt only, with legacy rehash
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_verify_complaint_pin(
  p_stored_hash text,
  p_pin text  -- raw PIN, NOT a hash
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
  -- Case 1: bcrypt hash (starts with $2a$, $2b$, or $2y$)
  IF p_stored_hash LIKE '$2%' THEN
    RETURN p_stored_hash = extensions.crypt(p_pin, p_stored_hash);
  END IF;

  -- Case 2: legacy SHA-256 hash (64 hex characters) — verify and schedule rehash
  IF length(p_stored_hash) = 64 AND p_stored_hash ~ '^[0-9a-f]+$' THEN
    SELECT encode(
      extensions.digest(('complaint-pin-salt:' || p_pin)::bytea, 'sha256'),
      'hex'
    ) INTO v_sha256_hash;

    IF p_stored_hash = v_sha256_hash THEN
      -- Legacy match: rehash to bcrypt in-place
      v_new_bcrypt := extensions.crypt(p_pin, extensions.gen_salt('bf', 10));
      -- Note: we update inline since this function is called within a
      -- SECURITY DEFINER context that can write to complaints table
      -- The caller function handles the actual UPDATE
      RETURN TRUE;  -- Caller must do the rehash update
    ELSE
      RETURN FALSE;
    END IF;
  END IF;

  -- Unknown format
  RETURN FALSE;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_verify_complaint_pin(text, text)
  TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Fix fn_submit_complaint — ALWAYS bcrypt the raw PIN
-- ═══════════════════════════════════════════════════════════════════════════

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
  p_pin_hash text DEFAULT NULL  -- raw PIN sent by frontend (name kept for PostgREST compat)
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
  -- Validate PIN length (6-32 characters, not restricted to digits only)
  IF p_pin_hash IS NULL OR length(p_pin_hash) < 6 OR length(p_pin_hash) > 32 THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_pin_length');
  END IF;

  -- Resolve tenant by slug
  SELECT id INTO v_tenant_id
  FROM public.organizations
  WHERE slug = p_tenant_slug AND deleted_at IS NULL;

  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_tenant');
  END IF;

  -- Generate protocol
  v_protocol := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  -- ALWAYS bcrypt — never accept pre-hashed values
  v_bcrypt_hash := extensions.crypt(p_pin_hash, extensions.gen_salt('bf', 10));

  -- Insert complaint metadata
  INSERT INTO public.complaints (
    id, tenant_id, protocol, category, severity, is_anonymous, pin_hash
  ) VALUES (
    gen_random_uuid(), v_tenant_id, v_protocol,
    p_category, 'medium', p_is_anonymous, v_bcrypt_hash
  ) RETURNING id INTO v_complaint_id;

  -- Insert protected content (separated per ADR-006)
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

  -- Audit trail (no PII, no PIN)
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

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Fix fn_access_complaint — accept raw PIN, rate limit, rehash legacy
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_access_complaint(
  p_protocol text,
  p_pin_hash text  -- raw PIN sent by frontend (name kept for PostgREST compat)
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE SECURITY DEFINER
  SET search_path = ''
AS $function$
DECLARE
  v_complaint  record;
  v_messages   jsonb;
  v_rate_ok    boolean;
  v_new_bcrypt text;
BEGIN
  -- Rate limit check (5 attempts per 15 minutes per protocol)
  SELECT public.fn_check_pin_rate_limit(p_protocol) INTO v_rate_ok;
  IF NOT v_rate_ok THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'rate_limited');
  END IF;

  -- Lookup complaint (metadata only, no content)
  SELECT c.id, c.status, c.category, c.severity, c.is_anonymous,
         c.pin_hash, c.created_at, c.updated_at
  INTO v_complaint
  FROM public.complaints c
  WHERE c.protocol = p_protocol;

  -- Anti-enumeration: same error for not-found and wrong PIN
  IF v_complaint IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_credentials');
  END IF;

  -- Verify raw PIN against stored bcrypt (or legacy SHA-256)
  IF NOT public.fn_verify_complaint_pin(v_complaint.pin_hash, p_pin_hash) THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_credentials');
  END IF;

  -- Rehash legacy SHA-256 to bcrypt if needed
  IF v_complaint.pin_hash NOT LIKE '$2%' THEN
    v_new_bcrypt := extensions.crypt(p_pin_hash, extensions.gen_salt('bf', 10));
    UPDATE public.complaints
    SET pin_hash = v_new_bcrypt
    WHERE id = v_complaint.id;
  END IF;

  -- Fetch messages for the reporter
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

-- Note: fn_access_complaint is STABLE but does an UPDATE for rehashing.
-- PostgreSQL allows this in STABLE when called from a VOLATILE context.
-- However, to be correct, we change to VOLATILE since it writes.
-- Actually wait - the function does UPDATE for rehash. Must be VOLATILE.

-- Re-create as VOLATILE since it does writes (rehash UPDATE)
CREATE OR REPLACE FUNCTION public.fn_access_complaint(
  p_protocol text,
  p_pin_hash text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER  -- removed STABLE, now VOLATILE (default)
  SET search_path = ''
AS $function$
DECLARE
  v_complaint  record;
  v_messages   jsonb;
  v_rate_ok    boolean;
  v_new_bcrypt text;
BEGIN
  -- Rate limit check (5 attempts per 15 minutes per protocol)
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

  -- Rehash legacy SHA-256 to bcrypt if needed
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

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Fix fn_send_reporter_message — accept raw PIN, rate limit, rehash
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_send_reporter_message(
  p_protocol text,
  p_pin_hash text,  -- raw PIN sent by frontend (name kept for PostgREST compat)
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
  -- Rate limit check
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

  -- Rehash legacy SHA-256 to bcrypt if needed
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

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. Fix fn_get_complaint_list — derive tenant_id from session
-- ═══════════════════════════════════════════════════════════════════════════

-- EXPAND PHASE: Keep old overload fn_get_complaint_list(uuid, text, int, int)
-- so old code (passing p_tenant_id) and new code (without p_tenant_id) both work.
-- The DROP will be done in the CONTRACT phase after code is fully deployed.
-- DROP FUNCTION IF EXISTS public.fn_get_complaint_list(uuid, text, integer, integer);

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
  -- Derive tenant from session
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
