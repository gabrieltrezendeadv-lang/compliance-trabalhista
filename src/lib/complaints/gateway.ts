"use server";

/**
 * Gateway confiável para RPCs de denúncia.
 *
 * v1.2.2 — Reescrito com:
 * - headers() assíncrono (Next.js 16)
 * - Validação Zod strict (rejeita campos extras)
 * - HMAC-SHA256 obrigatório em produção (fail-closed)
 * - Sanitização de erros (correlation ID sem PII)
 * - Anti-enumeração (mesma mensagem para protocolo/PIN inválidos)
 * - Chamadas a fn_access_complaint_v2 e fn_send_reporter_message_v2
 * - service_role via createServiceClient() (nunca anon/authenticated)
 *
 * IMPORTANTE: Este módulo é "use server" — nunca importável por client components.
 * Nenhum IP bruto, protocolo, PIN, hash de PIN, conteúdo de denúncia ou
 * mensagem é registrado em logs.
 */

import crypto from "crypto";
import { headers } from "next/headers";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";

// ============================================================================
// Constants
// ============================================================================

const PROTOCOL_MAX_LENGTH = 20;
const MESSAGE_BODY_MAX_LENGTH = 10_000;
const HMAC_SECRET_MIN_LENGTH = 32;

// ============================================================================
// Gateway-specific Zod schemas (strict, server-side only)
//
// Defense-in-depth: revalida mesmo que actions.ts também valide.
// Modo strict rejeita campos inesperados (tenant_id, ip_hash, etc.).
// Mensagens de erro são genéricas — nunca revelam qual campo falhou.
// ============================================================================

const gatewayAccessSchema = z
  .object({
    protocol: z
      .string()
      .min(1)
      .max(PROTOCOL_MAX_LENGTH)
      .transform((v) => v.toUpperCase().replace(/\s/g, ""))
      .pipe(z.string().min(1)),
    pin: z
      .string()
      .min(4)
      .max(32)
      .regex(/^\d+$/),
  })
  .strict();

const gatewayMessageSchema = z
  .object({
    protocol: z
      .string()
      .min(1)
      .max(PROTOCOL_MAX_LENGTH)
      .transform((v) => v.toUpperCase().replace(/\s/g, ""))
      .pipe(z.string().min(1)),
    pin: z
      .string()
      .min(4)
      .max(32)
      .regex(/^\d+$/),
    body: z.string().min(1).max(MESSAGE_BODY_MAX_LENGTH),
  })
  .strict();

// ============================================================================
// Correlation ID — for server-side log correlation without PII
// ============================================================================

function generateCorrelationId(): string {
  return crypto.randomBytes(8).toString("hex");
}

// ============================================================================
// IP pseudonymization (HMAC-SHA256)
//
// Extracts the caller's IP with Vercel-aware priority:
//   1. x-vercel-forwarded-for — set by Vercel Edge, not spoofable by clients
//   2. x-forwarded-for        — standard proxy header (first entry in chain)
//   3. x-real-ip              — fallback from reverse proxies
//
// Produces a one-way HMAC hash. The raw IP is never stored or logged.
// ============================================================================

async function getCallerIpHash(): Promise<string | null> {
  const secret = process.env.RATE_LIMIT_HMAC_SECRET;
  if (!secret) return null;

  const hdrs = await headers();

  // Prefer x-vercel-forwarded-for (Vercel sets this to the real client IP,
  // cannot be spoofed by the client). Fall back to standard headers.
  const ip =
    hdrs.get("x-vercel-forwarded-for")?.split(",")[0].trim() ||
    hdrs.get("x-forwarded-for")?.split(",")[0].trim() ||
    hdrs.get("x-real-ip") ||
    null;

  if (!ip) return null;

  return crypto.createHmac("sha256", secret).update(ip).digest("hex");
}

// ============================================================================
// HMAC secret pre-flight validation
//
// Production: HMAC is MANDATORY — fail closed (do not execute RPC).
// Preview/staging: require secret when present; reject if too short.
// Development: allow missing ONLY with explicit RATE_LIMIT_HMAC_ALLOW_MISSING=true.
// Never use a default/hardcoded secret. Never log the secret value.
// Minimum secret length: 32 characters (256 bits for HMAC-SHA256).
// ============================================================================

interface HmacValidation {
  allowed: boolean;
  reason?: string;
}

function validateHmacSecret(): HmacValidation {
  const secret = process.env.RATE_LIMIT_HMAC_SECRET;

  if (process.env.NODE_ENV === "production") {
    if (!secret) {
      return { allowed: false, reason: "hmac_missing_production" };
    }
    if (secret.length < HMAC_SECRET_MIN_LENGTH) {
      return { allowed: false, reason: "hmac_too_short" };
    }
    return { allowed: true };
  }

  // Non-production (development, preview, staging, test)
  if (!secret) {
    if (process.env.RATE_LIMIT_HMAC_ALLOW_MISSING === "true") {
      // Explicit dev opt-in: proceed without IP-based rate limiting.
      // Rate limit by protocol still active in the DB function.
      return { allowed: true };
    }
    return { allowed: false, reason: "hmac_missing_dev" };
  }

  if (secret.length < HMAC_SECRET_MIN_LENGTH) {
    return { allowed: false, reason: "hmac_too_short" };
  }

  return { allowed: true };
}

// ============================================================================
// Return types (match what actions.ts and client components expect)
// ============================================================================

interface GatewayAccessResult {
  success?: boolean;
  error?: string;
  correlationId?: string;
  complaint?: {
    status: string;
    category: string;
    severity: string;
    is_anonymous: boolean;
    created_at: string;
    updated_at: string;
  };
  messages?: Array<{
    id: string;
    sender_type: string;
    body: string;
    created_at: string;
  }>;
}

interface GatewayMessageResult {
  success?: boolean;
  error?: string;
  correlationId?: string;
}

// ============================================================================
// Gateway: accessComplaint
//
// Flow: validate → HMAC pre-flight → IP hash → fn_access_complaint_v2 →
//       sanitize response.
//
// Anti-enumeration: same error message for nonexistent protocol,
// wrong PIN, and all other failures. No SQL/table/function/constraint
// details exposed. Rate limit info is safe to expose.
// ============================================================================

export async function gatewayAccessComplaint(
  raw: unknown
): Promise<GatewayAccessResult> {
  const correlationId = generateCorrelationId();

  // 1. HMAC pre-flight — fail closed in production
  const hmac = validateHmacSecret();
  if (!hmac.allowed) {
    console.error(
      `[gateway:access] cid=${correlationId} hmac_preflight=${hmac.reason}`
    );
    return { error: "Protocolo ou PIN inválido", correlationId };
  }

  // 2. Input validation (strict — rejects extra fields)
  const parsed = gatewayAccessSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: "Protocolo ou PIN inválido", correlationId };
  }

  try {
    // 3. IP hash (async — Next.js 16 headers())
    const ipHash = await getCallerIpHash();

    // 3b. Fail closed: in production, refuse to call RPC without IP hash.
    // Without the IP hash, dual rate limiting (by ip_hash) cannot operate,
    // leaving only protocol-based rate limiting active — insufficient protection.
    if (!ipHash && process.env.NODE_ENV === "production") {
      console.error(
        `[gateway:access] cid=${correlationId} ip_hash_unavailable`
      );
      return { error: "Protocolo ou PIN inválido", correlationId };
    }

    // 4. Call RPC via service_role
    const supabase = createServiceClient();
    const { data, error } = await supabase.rpc("fn_access_complaint_v2", {
      p_protocol: parsed.data.protocol,
      p_pin_hash: parsed.data.pin,
      p_caller_ip_hash: ipHash,
    });

    if (error) {
      // Server-side log: correlation ID only, no PII
      console.error(
        `[gateway:access] cid=${correlationId} rpc_error`
      );
      return { error: "Protocolo ou PIN inválido", correlationId };
    }

    const result = data as {
      success: boolean;
      error?: string;
      complaint?: GatewayAccessResult["complaint"];
      messages?: GatewayAccessResult["messages"];
    };

    if (!result.success) {
      if (result.error === "rate_limited") {
        return {
          error: "Muitas tentativas. Tente novamente em alguns minutos.",
          correlationId,
        };
      }
      // Anti-enumeration: all other failures get the same message
      return { error: "Protocolo ou PIN inválido", correlationId };
    }

    return {
      success: true,
      complaint: result.complaint,
      messages: result.messages ?? [],
    };
  } catch (_err) {
    console.error(
      `[gateway:access] cid=${correlationId} unexpected_error`
    );
    return { error: "Protocolo ou PIN inválido", correlationId };
  }
}

// ============================================================================
// Gateway: sendReporterMessage
//
// Flow: validate → HMAC pre-flight → IP hash → fn_send_reporter_message_v2 →
//       sanitize response.
//
// Same anti-enumeration as accessComplaint, plus complaint_closed handling
// (safe to expose — user needs to know the complaint is closed).
// ============================================================================

export async function gatewaySendReporterMessage(
  raw: unknown
): Promise<GatewayMessageResult> {
  const correlationId = generateCorrelationId();

  // 1. HMAC pre-flight — fail closed in production
  const hmac = validateHmacSecret();
  if (!hmac.allowed) {
    console.error(
      `[gateway:message] cid=${correlationId} hmac_preflight=${hmac.reason}`
    );
    return { error: "Protocolo ou PIN inválido", correlationId };
  }

  // 2. Input validation (strict — rejects extra fields)
  const parsed = gatewayMessageSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: "Protocolo ou PIN inválido", correlationId };
  }

  try {
    // 3. IP hash (async — Next.js 16 headers())
    const ipHash = await getCallerIpHash();

    // 3b. Fail closed: in production, refuse to call RPC without IP hash.
    if (!ipHash && process.env.NODE_ENV === "production") {
      console.error(
        `[gateway:message] cid=${correlationId} ip_hash_unavailable`
      );
      return { error: "Protocolo ou PIN inválido", correlationId };
    }

    // 4. Call RPC via service_role
    const supabase = createServiceClient();
    const { data, error } = await supabase.rpc("fn_send_reporter_message_v2", {
      p_protocol: parsed.data.protocol,
      p_pin_hash: parsed.data.pin,
      p_body: parsed.data.body,
      p_caller_ip_hash: ipHash,
    });

    if (error) {
      console.error(
        `[gateway:message] cid=${correlationId} rpc_error`
      );
      return { error: "Protocolo ou PIN inválido", correlationId };
    }

    const result = data as {
      success: boolean;
      error?: string;
      message_id?: string;
    };

    if (!result.success) {
      if (result.error === "rate_limited") {
        return {
          error: "Muitas tentativas. Tente novamente em alguns minutos.",
          correlationId,
        };
      }
      if (result.error === "complaint_closed") {
        return {
          error: "Esta denúncia foi encerrada e não aceita novas mensagens.",
          correlationId,
        };
      }
      // Anti-enumeration
      return { error: "Protocolo ou PIN inválido", correlationId };
    }

    return { success: true };
  } catch (_err) {
    console.error(
      `[gateway:message] cid=${correlationId} unexpected_error`
    );
    return { error: "Protocolo ou PIN inválido", correlationId };
  }
}
