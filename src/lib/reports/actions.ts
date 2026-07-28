"use server";

import { createClient } from "@/lib/supabase/server";
import crypto from "crypto";

// ============================================================================
// Tipos do Relatório de Compliance
// ============================================================================

export interface ComplianceReportData {
  generatedAt: string;
  hash: string;

  organization: {
    name: string;
    legalName: string | null;
    documentNumber: string | null;
    slug: string;
    plan: string;
  };

  summary: {
    establishments: number;
    departments: number;
    members: number;
    totalRisks: number;
    openComplaints: number;
    campaignsSent: number;
    evidencePackagesSealed: number;
    assessmentCycles: number;
    participationRate: number;
  };

  risks: Array<{
    title: string;
    category: string;
    source: string;
    initialLevel: string;
    residualLevel: string | null;
    status: string;
    actionPlansCount: number;
    actionPlansCompleted: number;
  }>;

  actionPlans: Array<{
    riskTitle: string;
    title: string;
    controlLevel: string | null;
    status: string;
    dueDate: string | null;
    completedAt: string | null;
  }>;

  complaints: {
    total: number;
    byStatus: Record<string, number>;
    byCategory: Record<string, number>;
    bySeverity: Record<string, number>;
  };

  campaigns: Array<{
    name: string;
    type: string;
    channel: string;
    status: string;
    totalRecipients: number;
    sentAt: string | null;
  }>;

  assessments: Array<{
    cycleName: string;
    status: string;
    totalInvitations: number;
    totalResponded: number;
    participationRate: number;
  }>;

  evidence: {
    reports: number;
    packages: Array<{
      name: string;
      status: string;
      itemCount: number;
      sealedAt: string | null;
      packageHash: string | null;
    }>;
  };
}

// ============================================================================
// Gerar Relatório de Compliance
// ============================================================================

export async function generateComplianceReport(): Promise<{
  data: ComplianceReportData | null;
  error?: string;
}> {
  const supabase = await createClient();

  try {
    // --- Organização ---
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { data: null, error: "Não autenticado" };
    }

    const { data: membership } = await supabase
      .from("organization_members")
      .select(
        "tenant_id, organizations(name, slug, cnpj, settings)"
      )
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .limit(1)
      .single();

    const org = membership?.organizations as unknown as {
      name: string;
      slug: string;
      cnpj: string | null;
      settings: Record<string, unknown> | null;
    } | null;

    if (!membership || !org) {
      return { data: null, error: "NO_TENANT" };
    }

    // --- Queries paralelas ---
    const [
      { count: estCount },
      { count: deptCount },
      { count: memberCount },
      { data: riskItems },
      { data: allActionPlans },
      { data: complaintRows },
      { data: campaignRows },
      { data: cycleRows },
      { data: invitationRows },
      { count: evidenceReportCount },
      { data: packages },
    ] = await Promise.all([
      supabase
        .from("establishments")
        .select("*", { count: "exact", head: true })
        .is("deleted_at", null),
      supabase
        .from("departments")
        .select("*", { count: "exact", head: true })
        .is("deleted_at", null),
      supabase
        .from("organization_members")
        .select("*", { count: "exact", head: true })
        .is("deleted_at", null),
      supabase
        .from("risk_items")
        .select("id, title, category, source, initial_risk_level, residual_risk_level, status")
        .is("deleted_at", null)
        .order("initial_risk_level"),
      supabase
        .from("risk_action_plans")
        .select("id, risk_item_id, title, control_level, status, due_date, completed_at")
        .is("deleted_at", null),
      supabase
        .from("complaints")
        .select("status, category, severity")
        .is("deleted_at", null),
      supabase
        .from("campaigns")
        .select("name, type, channel, status, total_recipients, sent_at")
        .is("deleted_at", null)
        .order("created_at", { ascending: false }),
      supabase
        .from("assessment_cycles")
        .select("id, name, status")
        .is("deleted_at", null)
        .order("created_at", { ascending: false }),
      supabase
        .from("assessment_invitations")
        .select("cycle_id, used_at"),
      supabase
        .from("evidence_reports")
        .select("*", { count: "exact", head: true })
        .is("deleted_at", null),
      supabase
        .from("evidence_packages")
        .select("id, name, status, sealed_at, package_hash")
        .is("deleted_at", null)
        .order("created_at", { ascending: false }),
    ]);

    // --- Processar riscos ---
    const risks = (riskItems ?? []).map((r) => {
      const plans = (allActionPlans ?? []).filter(
        (p) => p.risk_item_id === r.id
      );
      return {
        title: r.title,
        category: r.category,
        source: r.source,
        initialLevel: r.initial_risk_level,
        residualLevel: r.residual_risk_level,
        status: r.status,
        actionPlansCount: plans.length,
        actionPlansCompleted: plans.filter((p) => p.status === "completed")
          .length,
      };
    });

    // --- Processar action plans com nome do risco ---
    const riskMap = new Map(
      (riskItems ?? []).map((r) => [r.id, r.title])
    );
    const actionPlans = (allActionPlans ?? []).map((p) => ({
      riskTitle: riskMap.get(p.risk_item_id) ?? "—",
      title: p.title,
      controlLevel: p.control_level,
      status: p.status,
      dueDate: p.due_date,
      completedAt: p.completed_at,
    }));

    // --- Processar denúncias ---
    const cList = complaintRows ?? [];
    const complaintsByStatus: Record<string, number> = {};
    const complaintsByCategory: Record<string, number> = {};
    const complaintsBySeverity: Record<string, number> = {};
    for (const c of cList) {
      complaintsByStatus[c.status] = (complaintsByStatus[c.status] ?? 0) + 1;
      if (c.category) {
        complaintsByCategory[c.category] =
          (complaintsByCategory[c.category] ?? 0) + 1;
      }
      if (c.severity) {
        complaintsBySeverity[c.severity] =
          (complaintsBySeverity[c.severity] ?? 0) + 1;
      }
    }

    // --- Processar campaigns ---
    const campaigns = (campaignRows ?? []).map((c) => ({
      name: c.name,
      type: c.type,
      channel: c.channel,
      status: c.status,
      totalRecipients: c.total_recipients,
      sentAt: c.sent_at,
    }));

    const campaignsSent = campaigns.filter(
      (c) => c.status === "sent"
    ).length;

    // --- Processar assessments ---
    const invList = invitationRows ?? [];
    const assessments = (cycleRows ?? []).map((cycle) => {
      const cycleInvitations = invList.filter(
        (i) => i.cycle_id === cycle.id
      );
      const responded = cycleInvitations.filter(
        (i) => i.used_at
      ).length;
      const total = cycleInvitations.length;
      return {
        cycleName: cycle.name,
        status: cycle.status,
        totalInvitations: total,
        totalResponded: responded,
        participationRate:
          total > 0 ? Math.round((responded / total) * 100) : 0,
      };
    });

    const totalInv = invList.length;
    const totalResp = invList.filter((i) => i.used_at).length;
    const overallParticipation =
      totalInv > 0 ? Math.round((totalResp / totalInv) * 100) : 0;

    // --- Processar evidências ---
    const packageItems = await Promise.all(
      (packages ?? []).map(async (pkg) => {
        const { count } = await supabase
          .from("evidence_package_items")
          .select("*", { count: "exact", head: true })
          .eq("package_id", pkg.id);
        return {
          name: pkg.name,
          status: pkg.status,
          itemCount: count ?? 0,
          sealedAt: pkg.sealed_at,
          packageHash: pkg.package_hash,
        };
      })
    );

    const sealedCount = (packages ?? []).filter(
      (p) => p.status === "sealed"
    ).length;

    // --- Montar relatório ---
    const generatedAt = new Date().toISOString();

    const reportData: Omit<ComplianceReportData, "hash"> = {
      generatedAt,
      organization: {
        name: org.name,
        legalName: null,
        documentNumber: org.cnpj,
        slug: org.slug,
        plan: "Não aplicável",
      },
      summary: {
        establishments: estCount ?? 0,
        departments: deptCount ?? 0,
        members: memberCount ?? 0,
        totalRisks: risks.length,
        openComplaints: cList.filter((c) =>
          ["pending", "under_review", "investigating", "reopened"].includes(c.status)
        ).length,
        campaignsSent,
        evidencePackagesSealed: sealedCount,
        assessmentCycles: (cycleRows ?? []).length,
        participationRate: overallParticipation,
      },
      risks,
      actionPlans,
      complaints: {
        total: cList.length,
        byStatus: complaintsByStatus,
        byCategory: complaintsByCategory,
        bySeverity: complaintsBySeverity,
      },
      campaigns,
      assessments,
      evidence: {
        reports: evidenceReportCount ?? 0,
        packages: packageItems,
      },
    };

    // Hash SHA-256 do conteúdo para integridade
    const hash = crypto
      .createHash("sha256")
      .update(JSON.stringify(reportData))
      .digest("hex");

    return {
      data: { ...reportData, hash } as ComplianceReportData,
    };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : "Erro ao gerar relatório",
    };
  }
}
