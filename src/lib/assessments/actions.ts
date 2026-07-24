"use server";

import { createClient } from "@/lib/supabase/server";
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

  // Resolver tenant_id do usuário
  const { data: membership } = await supabase
    .from("organization_members")
    .select("tenant_id")
    .is("deleted_at", null)
    .limit(1)
    .single();

  if (!membership) {
    return { error: "Organização não encontrada" };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("assessment_cycles")
    .insert({
      ...parsed.data,
      tenant_id: membership.tenant_id,
      created_by: user?.id,
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
