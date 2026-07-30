"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  isRealProviderConfigured,
  resolveProvider,
} from "@/lib/integrations/registry";
import type { Channel } from "@/lib/integrations/types";
import {
  createCycleSchema,
  updateCycleSchema,
  submitAssessmentSchema,
} from "@/lib/schemas/assessment";
import type {
  DimensionResult,
  ParticipationStat,
} from "@/lib/schemas/assessment";

// ============================================================================
// Assessment Cycles
// ============================================================================

export async function getAssessmentCycles() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("assessment_cycles")
    .select("*, questionnaire_templates(name, instrument_code)")
    .is("deleted_at", null)
    .order("starts_at", { ascending: false });

  if (error) {
    return { error: error.message, data: [] };
  }

  return { data: data ?? [] };
}

export async function getAssessmentCycle(cycleId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("assessment_cycles")
    .select("*, questionnaire_templates(name, instrument_code, response_scale)")
    .eq("id", cycleId)
    .is("deleted_at", null)
    .single();

  if (error) {
    return { error: error.message, data: null };
  }

  return { data };
}

export async function createAssessmentCycle(raw: unknown) {
  const parsed = createCycleSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Usuário não autenticado" };
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("tenant_id, role")
    .eq("user_id", user.id)
    .in("role", ["owner", "admin", "manager"])
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!membership) {
    return { error: "Organização não encontrada ou permissão insuficiente" };
  }

  const { data, error } = await supabase
    .from("assessment_cycles")
    .insert({
      ...parsed.data,
      tenant_id: membership.tenant_id,
      created_by: user.id,
      settings: { max_value: 5 },
    })
    .select()
    .single();

  if (error) {
    return { error: error.message };
  }

  return { data };
}

export async function updateAssessmentCycle(cycleId: string, raw: unknown) {
  const parsed = updateCycleSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("assessment_cycles")
    .update(parsed.data)
    .eq("id", cycleId);

  if (error) {
    return { error: error.message };
  }

  return { success: true };
}

export async function sendAssessmentInvitations(
  cycleId: string,
  channel: Channel
) {
  if (!["email", "whatsapp"].includes(channel)) {
    return { error: "Canal inválido" };
  }

  if (!isRealProviderConfigured(channel)) {
    return {
      error:
        channel === "email"
          ? "O provedor de e-mail não está configurado"
          : "O provedor de WhatsApp não está configurado",
    };
  }

  const appUrlRaw =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "");
  let appUrl: URL;
  try {
    appUrl = new URL(appUrlRaw);
  } catch {
    return { error: "A URL pública do aplicativo não está configurada" };
  }
  if (process.env.NODE_ENV === "production" && appUrl.protocol !== "https:") {
    return { error: "A URL pública precisa usar HTTPS em produção" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Usuário não autenticado" };

  const { data: cycle } = await supabase
    .from("assessment_cycles")
    .select("id, tenant_id, name, status, starts_at, ends_at")
    .eq("id", cycleId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!cycle) return { error: "Ciclo não encontrado" };

  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("tenant_id", cycle.tenant_id)
    .eq("user_id", user.id)
    .in("role", ["owner", "admin", "manager"])
    .is("deleted_at", null)
    .maybeSingle();
  if (!membership) return { error: "Permissão insuficiente" };

  const now = new Date();
  if (new Date(cycle.ends_at) <= now) {
    return { error: "O ciclo está encerrado" };
  }
  if (new Date(cycle.starts_at) > now) {
    return { error: "O ciclo ainda não está ativo" };
  }
  if (cycle.status === "planning") {
    const { error } = await supabase
      .from("assessment_cycles")
      .update({ status: "active" })
      .eq("id", cycle.id)
      .eq("tenant_id", cycle.tenant_id);
    if (error) return { error: error.message };
  } else if (cycle.status !== "active") {
    return { error: "O ciclo não permite novos convites" };
  }

  const contactColumn = channel === "email" ? "email" : "phone";
  const { data: employees, error: employeeError } = await supabase
    .from("employee_profiles")
    .select("id, full_name, email, phone, establishment_id, department_id")
    .eq("tenant_id", cycle.tenant_id)
    .eq("status", "active")
    .not(contactColumn, "is", null)
    .is("deleted_at", null)
    .order("id");
  if (employeeError) return { error: employeeError.message };

  const { data: dispatched } = await supabase
    .from("assessment_dispatches")
    .select("employee_id")
    .eq("cycle_id", cycle.id)
    .eq("status", "sent");
  const alreadySent = new Set((dispatched ?? []).map((item) => item.employee_id));
  const pendingEmployees = (employees ?? []).filter(
    (employee) => !alreadySent.has(employee.id)
  );

  if (pendingEmployees.length === 0) {
    return { success: true, sent: 0, skipped: alreadySent.size, failed: 0 };
  }

  const provider = resolveProvider(channel);
  let sent = 0;
  let failed = 0;

  for (const employee of pendingEmployees) {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
    const { data: invitation, error: invitationError } = await supabase
      .from("assessment_invitations")
      .insert({
        cycle_id: cycle.id,
        tenant_id: cycle.tenant_id,
        token: null,
        token_hash: tokenHash,
        establishment_id: employee.establishment_id,
        department_id: employee.department_id,
        expires_at: cycle.ends_at,
      })
      .select("id")
      .single();

    if (invitationError || !invitation) {
      failed += 1;
      continue;
    }

    const assessmentUrl = new URL(
      `/assessment/${encodeURIComponent(token)}`,
      appUrl
    ).toString();
    const result = await provider.send({
      idempotencyKey: `assessment:${cycle.id}:${employee.id}:${channel}`,
      recipientName: employee.full_name,
      recipientEmail: employee.email ?? undefined,
      recipientPhone: employee.phone ?? undefined,
      subject: `Avaliação psicossocial — ${cycle.name}`,
      bodyText:
        `Você foi convidado(a) a responder uma avaliação psicossocial anônima.\n\n` +
        `A empresa verá somente resultados agregados. Acesse: ${assessmentUrl}`,
      metadata: {
        cycleId: cycle.id,
        tenantId: cycle.tenant_id,
      },
    });

    const { error: dispatchError } = await supabase
      .from("assessment_dispatches")
      .upsert(
        {
          tenant_id: cycle.tenant_id,
          cycle_id: cycle.id,
          employee_id: employee.id,
          establishment_id: employee.establishment_id,
          department_id: employee.department_id,
          channel,
          status: result.success ? "sent" : "failed",
          provider_id: result.providerId ?? null,
          error_code: result.error?.code ?? null,
          created_by: user.id,
        },
        { onConflict: "cycle_id,employee_id" }
      );

    if (result.success && !dispatchError) {
      sent += 1;
    } else {
      failed += 1;
    }
  }

  revalidatePath(`/dashboard/assessments/${cycle.id}`);
  return { success: failed === 0, sent, failed, skipped: alreadySent.size };
}

// ============================================================================
// Questionnaire Templates (leitura)
// ============================================================================

export async function getQuestionnaireTemplates() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("questionnaire_templates")
    .select("id, name, description, instrument_code, status, version")
    .eq("status", "published")
    .is("deleted_at", null)
    .order("name");

  if (error) {
    return { error: error.message, data: [] };
  }

  return { data: data ?? [] };
}

// ============================================================================
// Aggregated Results (via SECURITY DEFINER functions)
// ============================================================================

export async function getCycleSummary(
  cycleId: string
): Promise<{ data: DimensionResult[]; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_assessment_cycle_summary", {
    p_cycle_id: cycleId,
  });

  if (error) {
    return { error: error.message, data: [] };
  }

  return { data: (data as DimensionResult[]) ?? [] };
}

export async function getGroupResults(
  cycleId: string,
  establishmentId: string,
  departmentId?: string
): Promise<{ data: DimensionResult[]; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "fn_assessment_group_results",
    {
      p_cycle_id: cycleId,
      p_establishment_id: establishmentId,
      p_department_id: departmentId ?? null,
    }
  );

  if (error) {
    return { error: error.message, data: [] };
  }

  return { data: (data as DimensionResult[]) ?? [] };
}

export async function getParticipationStats(
  cycleId: string
): Promise<{ data: ParticipationStat[]; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "fn_assessment_participation_stats",
    {
      p_cycle_id: cycleId,
    }
  );

  if (error) {
    return { error: error.message, data: [] };
  }

  return { data: (data as ParticipationStat[]) ?? [] };
}

// ============================================================================
// Public: questionário e submissão (sem autenticação)
// ============================================================================

export async function getQuestionnaireByToken(token: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "fn_get_questionnaire_for_token",
    {
      p_token: token,
    }
  );

  if (error) {
    return { error: error.message, data: null };
  }

  return { data: data as {
    valid: boolean;
    template?: {
      name: string;
      description: string;
      response_scale: {
        type: string;
        points: number;
        min_value: number;
        max_value: number;
        labels: Record<string, string>;
      };
    };
    sections?: Array<{
      id: string;
      name: string;
      description: string;
      dimension_code: string;
      items: Array<{
        id: string;
        text: string;
        help_text: string | null;
        required: boolean;
      }>;
    }>;
  } | null };
}

export async function submitAssessment(raw: unknown) {
  const parsed = submitAssessmentSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_submit_assessment", {
    p_token: parsed.data.token,
    p_responses: JSON.stringify(parsed.data.responses),
  });

  if (error) {
    return { error: error.message };
  }

  const result = data as { success: boolean; error?: string; items_recorded?: number };

  if (!result.success) {
    return { error: result.error ?? "Erro ao enviar avaliação" };
  }

  return { success: true, items_recorded: result.items_recorded };
}
