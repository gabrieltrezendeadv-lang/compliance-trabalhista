/**
 * Supabase client com service_role key.
 *
 * Usado APENAS em server actions / route handlers que precisam
 * chamar RPCs restritas a service_role:
 *   - fn_access_complaint_v2
 *   - fn_send_reporter_message_v2
 *   - fn_check_pin_rate_limit_v2
 *   - fn_record_pin_failure
 *
 * SEGURANÇA:
 * - NUNCA exponha esta key ao cliente.
 * - NUNCA importe este módulo em componentes "use client".
 * - SUPABASE_SERVICE_ROLE_KEY é variável de ambiente server-only
 *   (sem prefixo NEXT_PUBLIC_).
 * - Este módulo NÃO tem "use server" porque não é um server action —
 *   é uma factory importada por módulos "use server" (gateway.ts).
 *   O Next.js impede importação transitiva por client components
 *   quando o caller tem "use server".
 */

import "server-only";

import { createClient } from "@supabase/supabase-js";

export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL is not configured"
    );
  }

  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured. "
      + "This key must be set as a server-only environment variable."
    );
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
