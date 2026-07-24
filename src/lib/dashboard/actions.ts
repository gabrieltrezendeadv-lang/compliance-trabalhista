"use server";

import { createClient } from "@/lib/supabase/server";

// ============================================================================
// Dashboard KPIs — dados consolidados de todos os módulos
// ============================================================================

export interface DashboardKPIs {
  // Organização
  establishments: number;
  departments: number;
  members: number;

  // Denúncias
  complaintsOpen: number;
  complaintsTotal: number;
  complaintsByStatus: Record<string, number>;

  // Campanhas
  campaignsActive: number;
  campaignsTotal: number;
  campaignDeliveryRate: number;

  // Riscos
  risksTotal: number;
  risksByLevel: Record<string, number>;
  actionPlansOverdue: number;
  actionPlansTotal: number;

  // Assessments
  assessmentCyclesActive: number;
  assessmentParticipationRate: number;

  // Evidências
  evidenceReports: number;
  evidencePackagesSealed: number;
}

export async function getDashboardKPIs(): Promise<{
  data: DashboardKPIs | null;
  error?: string;
}> {
  const supabase = await createClient();

  try {
    const [
      // Organização
      { count: establishmentCount },
      { count: departmentCount },
      { count: memberCount },
      // Denúncias
      { data: complaints },
      // Campanhas
      { data: campaigns },
      // Deliveries (para taxa de entrega)
      { data: deliveryCounts },
      // Riscos
      { data: risks },
      // Action plans
      { data: actionPlans },
      // Assessment cycles
      { data: cycles },
      // Invitations (para participação)
      { data: invitations },
      // Evidências
      { count: evidenceCount },
      { count: sealedPackageCount },
    ] = await Promise.all([
      // 1. Estabelecimentos
      supabase
        .from("establishments")
        .select("*", { count: "exact", head: true })
        .is("deleted_at", null),
      // 2. Departamentos
      supabase
        .from("departments")
        .select("*", { count: "exact", head: true })
        .is("deleted_at", null),
      // 3. Membros
      supabase
        .from("organization_members")
        .select("*", { count: "exact", head: true })
        .is("deleted_at", null),
      // 4. Denúncias (status)
      supabase
        .from("complaints")
        .select("status")
        .is("deleted_at", null),
      // 5. Campanhas (status)
      supabase
        .from("campaigns")
        .select("status")
        .is("deleted_at", null),
      // 6. Deliveries (status para taxa de entrega)
      supabase
        .from("campaign_deliveries")
        .select("status"),
      // 7. Riscos (level + status)
      supabase
        .from("risk_items")
        .select("initial_risk_level, residual_risk_level, status")
        .is("deleted_at", null),
      // 8. Action plans (status + due_date)
      supabase
        .from("risk_action_plans")
        .select("status, due_date")
        .is("deleted_at", null),
      // 9. Assessment cycles
      supabase
        .from("assessment_cycles")
        .select("id, status")
        .is("deleted_at", null),
      // 10. Invitations (respondido?)
      supabase
        .from("assessment_invitations")
        .select("id, responded_at"),
      // 11. Evidence reports
      supabase
        .from("evidence_reports")
        .select("*", { count: "exact", head: true })
        .is("deleted_at", null),
      // 12. Evidence packages seladas
      supabase
        .from("evidence_packages")
        .select("*", { count: "exact", head: true })
        .eq("status", "sealed")
        .is("deleted_at", null),
    ]);

    // --- Denúncias ---
    const complaintList = complaints ?? [];
    const complaintsByStatus: Record<string, number> = {};
    for (const c of complaintList) {
      complaintsByStatus[c.status] = (complaintsByStatus[c.status] ?? 0) + 1;
    }
    const openStatuses = ["open", "under_investigation", "awaiting_response"];
    const complaintsOpen = complaintList.filter((c) =>
      openStatuses.includes(c.status)
    ).length;

    // --- Campanhas ---
    const campaignList = campaigns ?? [];
    const campaignsActive = campaignList.filter(
      (c) => c.status === "sending" || c.status === "scheduled"
    ).length;

    // Taxa de entrega
    const deliveryList = deliveryCounts ?? [];
    const deliveredStatuses = ["delivered", "read"];
    const totalDeliveries = deliveryList.length;
    const deliveredCount = deliveryList.filter((d) =>
      deliveredStatuses.includes(d.status)
    ).length;
    const campaignDeliveryRate =
      totalDeliveries > 0
        ? Math.round((deliveredCount / totalDeliveries) * 100)
        : 0;

    // --- Riscos ---
    const riskList = risks ?? [];
    const risksByLevel: Record<string, number> = {};
    for (const r of riskList) {
      const level = r.residual_risk_level ?? r.initial_risk_level;
      if (level) {
        risksByLevel[level] = (risksByLevel[level] ?? 0) + 1;
      }
    }

    // Action plans vencidos
    const planList = actionPlans ?? [];
    const today = new Date().toISOString().slice(0, 10);
    const actionPlansOverdue = planList.filter(
      (p) =>
        p.due_date &&
        p.due_date < today &&
        p.status !== "completed" &&
        p.status !== "cancelled"
    ).length;

    // --- Assessments ---
    const cycleList = cycles ?? [];
    const assessmentCyclesActive = cycleList.filter(
      (c) => c.status === "active"
    ).length;

    const invitationList = invitations ?? [];
    const totalInvitations = invitationList.length;
    const respondedInvitations = invitationList.filter(
      (i) => i.responded_at
    ).length;
    const assessmentParticipationRate =
      totalInvitations > 0
        ? Math.round((respondedInvitations / totalInvitations) * 100)
        : 0;

    return {
      data: {
        establishments: establishmentCount ?? 0,
        departments: departmentCount ?? 0,
        members: memberCount ?? 0,
        complaintsOpen,
        complaintsTotal: complaintList.length,
        complaintsByStatus,
        campaignsActive,
        campaignsTotal: campaignList.length,
        campaignDeliveryRate,
        risksTotal: riskList.length,
        risksByLevel,
        actionPlansOverdue,
        actionPlansTotal: planList.length,
        assessmentCyclesActive,
        assessmentParticipationRate,
        evidenceReports: evidenceCount ?? 0,
        evidencePackagesSealed: sealedPackageCount ?? 0,
      },
    };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : "Erro ao carregar KPIs",
    };
  }
}
