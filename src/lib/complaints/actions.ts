"use server";

import { createClient } from "@/lib/supabase/server";
import {
  submitComplaintSchema,
  accessComplaintSchema,
  sendReporterMessageSchema,
  updateComplaintStatusSchema,
} from "@/lib/schemas/complaint";
import type {
  ComplaintListItem,
  ComplaintDetail,
} from "@/lib/schemas/complaint";

// ============================================================================
// Public: Submissão de denúncia (sem autenticação)
// ============================================================================

export async function submitComplaint(raw: unknown) {
  const parsed = submitComplaintSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const { pin, ...rest } = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_submit_complaint", {
    p_tenant_slug: rest.tenant_slug,
    p_subject: rest.subject,
    p_description: rest.description,
    p_category: rest.category,
    p_is_anonymous: rest.is_anonymous,
    p_reporter_name: rest.reporter_name || null,
    p_reporter_email: rest.reporter_email || null,
    p_reporter_phone: rest.reporter_phone || null,
    p_establishment_name: rest.establishment_name || null,
    p_department_name: rest.department_name || null,
    p_pin_hash: pin,  // raw PIN — bcrypt hashing happens in the DB function
  });

  if (error) {
    console.error("submitComplaint RPC error:", error.message);
    return { error: "Erro ao registrar denúncia. Tente novamente." };
  }

  const result = data as { success: boolean; error?: string; protocol?: string };

  if (!result.success) {
    return { error: result.error ?? "Erro ao registrar denúncia" };
  }

  return { success: true, protocol: result.protocol };
}

// ============================================================================
// Public: Acesso à caixa segura (protocolo + PIN)
// ============================================================================

export async function accessComplaint(raw: unknown) {
  const parsed = accessComplaintSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_access_complaint", {
    p_protocol: parsed.data.protocol,
    p_pin_hash: parsed.data.pin,  // raw PIN — bcrypt verification in DB
  });

  if (error) {
    console.error("accessComplaint RPC error:", error.message);
    return { error: "Protocolo ou PIN inválido" };
  }

  const result = data as {
    success: boolean;
    error?: string;
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
  };

  if (!result.success) {
    // Anti-enumeração: mensagem genérica
    return { error: "Protocolo ou PIN inválido" };
  }

  return {
    success: true,
    complaint: result.complaint,
    messages: result.messages ?? [],
  };
}

// ============================================================================
// Public: Envio de mensagem pelo denunciante
// ============================================================================

export async function sendReporterMessage(raw: unknown) {
  const parsed = sendReporterMessageSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_send_reporter_message", {
    p_protocol: parsed.data.protocol,
    p_pin_hash: parsed.data.pin,  // raw PIN — bcrypt verification in DB
    p_body: parsed.data.body,
  });

  if (error) {
    console.error("sendReporterMessage RPC error:", error.message);
    return { error: "Protocolo ou PIN inválido" };
  }

  const result = data as { success: boolean; error?: string; message_id?: string };

  if (!result.success) {
    if (result.error === "complaint_closed") {
      return { error: "Esta denúncia foi encerrada e não aceita novas mensagens." };
    }
    return { error: "Protocolo ou PIN inválido" };
  }

  return { success: true };
}

// ============================================================================
// Dashboard: Lista de denúncias (admin — metadata only)
// ============================================================================

export async function getComplaints(
  statusFilter?: string
): Promise<{ data: ComplaintListItem[]; total: number; error?: string }> {
  const supabase = await createClient();

  // Resolver tenant_id do usuário logado
  const { data: membership } = await supabase
    .from("organization_members")
    .select("tenant_id")
    .is("deleted_at", null)
    .limit(1)
    .single();

  if (!membership) {
    return { error: "Organização não encontrada", data: [], total: 0 };
  }

  const { data, error } = await supabase.rpc("fn_get_complaint_list", {
    p_tenant_id: membership.tenant_id,
    p_status: statusFilter || null,
    p_limit: 50,
    p_offset: 0,
  });

  if (error) {
    return { error: error.message, data: [], total: 0 };
  }

  const result = data as {
    success: boolean;
    complaints: ComplaintListItem[];
    total: number;
  };

  if (!result.success) {
    return { error: "Sem permissão", data: [], total: 0 };
  }

  return { data: result.complaints ?? [], total: result.total ?? 0 };
}

// ============================================================================
// Dashboard: Detalhe da denúncia (investigador/admin)
// ============================================================================

export async function getComplaintDetail(
  complaintId: string
): Promise<{ data: ComplaintDetail | null; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_get_complaint_detail", {
    p_complaint_id: complaintId,
  });

  if (error) {
    return { error: error.message, data: null };
  }

  const result = data as { success: boolean; error?: string } & ComplaintDetail;

  if (!result.success) {
    return { error: result.error ?? "Sem permissão", data: null };
  }

  return {
    data: {
      complaint: result.complaint,
      is_investigator: result.is_investigator,
      is_admin: result.is_admin,
      content: result.content,
      messages: result.messages,
      investigators: result.investigators ?? [],
    },
  };
}

// ============================================================================
// Dashboard: Atualizar status da denúncia
// ============================================================================

export async function updateComplaintStatus(raw: unknown) {
  const parsed = updateComplaintStatusSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_update_complaint_status", {
    p_complaint_id: parsed.data.complaint_id,
    p_new_status: parsed.data.new_status,
    p_reason: parsed.data.reason || null,
  });

  if (error) {
    return { error: error.message };
  }

  const result = data as { success: boolean; error?: string };

  if (!result.success) {
    return { error: result.error ?? "Erro ao atualizar status" };
  }

  return { success: true };
}

// ============================================================================
// Dashboard: Enviar mensagem como investigador
// ============================================================================

export async function sendInvestigatorMessage(
  complaintId: string,
  body: string
) {
  if (!body || body.trim().length < 1) {
    return { error: "Mensagem não pode estar vazia" };
  }

  const supabase = await createClient();

  const { error } = await supabase.from("complaint_messages").insert({
    complaint_id: complaintId,
    sender_type: "investigator",
    sender_id: (await supabase.auth.getUser()).data.user?.id,
    body: body.trim(),
  });

  if (error) {
    return { error: error.message };
  }

  // Registrar no audit log
  await supabase.from("complaint_audit_log").insert({
    complaint_id: complaintId,
    actor_id: (await supabase.auth.getUser()).data.user?.id,
    action: "message_sent",
    details: { sender_type: "investigator" },
  });

  return { success: true };
}
