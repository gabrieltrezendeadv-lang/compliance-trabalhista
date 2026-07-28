import Link from "next/link";
import { notFound } from "next/navigation";
import { getRiskDetail } from "@/lib/risks/actions";
import { getMembers } from "@/lib/organizations/actions";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ActionPlanForm } from "@/components/risks/action-plan-form";
import { ReviewForm } from "@/components/risks/review-form";
import { formatDate, formatDateTime } from "@/lib/utils";
import {
  ArrowLeft,
  Shield,
  Clock,
  Target,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Activity,
} from "lucide-react";
import type { RiskDetail } from "@/lib/schemas/risk";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ riskId: string }>;
}) {
  const { riskId } = await params;
  const { data } = await getRiskDetail(riskId);
  const detail = data as RiskDetail | null;
  return {
    title: detail
      ? `${detail.title} — Inventario de Riscos`
      : "Risco — Compliance Trabalhista",
  };
}

// ── Label maps ──────────────────────────────────────────────────────────────

const LEVEL_LABELS: Record<string, string> = {
  low: "Baixo",
  moderate: "Moderado",
  high: "Alto",
  critical: "Critico",
};

const LEVEL_COLORS: Record<string, string> = {
  low: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  moderate: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300",
  critical: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
};

const STATUS_LABELS: Record<string, string> = {
  identified: "Identificado",
  action_planned: "Acao planejada",
  in_progress: "Em andamento",
  mitigated: "Mitigado",
  accepted: "Aceito",
  closed: "Encerrado",
};

const STATUS_COLORS: Record<string, string> = {
  identified: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  action_planned: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300",
  in_progress: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  mitigated: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  accepted: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300",
  closed: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300",
};

const SOURCE_LABELS: Record<string, string> = {
  assessment: "Avaliacao",
  complaint: "Denuncia",
  inspection: "Inspecao",
  manual: "Manual",
};

const CATEGORY_LABELS: Record<string, string> = {
  psychosocial: "Psicossocial",
  ergonomic: "Ergonomico",
  physical: "Fisico",
  chemical: "Quimico",
  biological: "Biologico",
  accident: "Acidente",
  organizational: "Organizacional",
};

const ACTION_STATUS_LABELS: Record<string, string> = {
  planned: "Planejado",
  in_progress: "Em andamento",
  completed: "Concluido",
  overdue: "Atrasado",
  cancelled: "Cancelado",
};

const ACTION_STATUS_COLORS: Record<string, string> = {
  planned: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  in_progress: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  completed: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  overdue: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
  cancelled: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300",
};

const CONTROL_LABELS: Record<string, string> = {
  elimination: "Eliminacao",
  substitution: "Substituicao",
  engineering: "Engenharia",
  administrative: "Administrativo",
  ppe: "EPI",
};

const RECOMMENDATION_LABELS: Record<string, string> = {
  maintain: "Manter",
  intensify: "Intensificar",
  close: "Encerrar",
  new_action: "Nova acao",
};

// ── Page ────────────────────────────────────────────────────────────────────

export default async function RiskDetailPage({
  params,
}: {
  params: Promise<{ riskId: string }>;
}) {
  const { riskId } = await params;

  const [riskResult, membersResult] = await Promise.all([
    getRiskDetail(riskId),
    getMembers(),
  ]);

  if (!riskResult.data || riskResult.error) {
    notFound();
  }

  const risk = riskResult.data as RiskDetail;
  const members = (membersResult.data ?? []).map((m: Record<string, unknown>) => {
    const profile = m.profiles as { full_name?: string } | null;
    return {
      id: m.user_id as string,
      full_name: profile?.full_name ?? "Membro",
    };
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <Link
            href="/dashboard/risks"
            className="mb-2 inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="mr-1 h-4 w-4" />
            Voltar ao inventario
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">{risk.title}</h1>
          <p className="mt-1 text-muted-foreground">
            {SOURCE_LABELS[risk.source] ?? risk.source} —{" "}
            {CATEGORY_LABELS[risk.category] ?? risk.category}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-md px-2.5 py-1 text-xs font-medium ${LEVEL_COLORS[risk.initial_risk_level] ?? ""}`}
          >
            {LEVEL_LABELS[risk.initial_risk_level] ?? risk.initial_risk_level}
          </span>
          <span
            className={`rounded-md px-2.5 py-1 text-xs font-medium ${STATUS_COLORS[risk.status] ?? ""}`}
          >
            {STATUS_LABELS[risk.status] ?? risk.status}
          </span>
        </div>
      </div>

      {/* Info cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Nivel Inicial
            </CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-sm font-medium">
              {LEVEL_LABELS[risk.initial_risk_level] ?? risk.initial_risk_level}
              {risk.initial_score != null && (
                <span className="ml-1 text-muted-foreground">
                  ({risk.initial_score}/100)
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Nivel Residual
            </CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-sm font-medium">
              {risk.residual_risk_level
                ? LEVEL_LABELS[risk.residual_risk_level] ?? risk.residual_risk_level
                : "Nao avaliado"}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Prioridade
            </CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {risk.priority ?? "—"}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Identificado em
            </CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-sm font-medium">
              {risk.identified_at ? formatDate(risk.identified_at) : "—"}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Description */}
      <Card>
        <CardHeader>
          <CardTitle>Descricao</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm whitespace-pre-wrap">{risk.description}</p>

          {risk.affected_group && (
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Grupo Afetado
              </p>
              <p className="mt-1 text-sm">{risk.affected_group}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Action Plans */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Planos de Acao
          </CardTitle>
          <CardDescription>
            {risk.action_plans?.length ?? 0} plano(s) de acao registrado(s).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {risk.action_plans && risk.action_plans.length > 0 ? (
            <div className="space-y-2">
              {risk.action_plans.map((plan) => (
                <div
                  key={plan.id}
                  className="rounded-lg border p-4 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium">{plan.title}</h4>
                    <div className="flex items-center gap-2">
                      {plan.control_level && (
                        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                          {CONTROL_LABELS[plan.control_level] ?? plan.control_level}
                        </span>
                      )}
                      <span
                        className={`rounded-md px-2 py-0.5 text-xs font-medium ${ACTION_STATUS_COLORS[plan.status] ?? ""}`}
                      >
                        {ACTION_STATUS_LABELS[plan.status] ?? plan.status}
                      </span>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {plan.description}
                  </p>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    {plan.due_date && (
                      <span>Vencimento: {formatDate(plan.due_date)}</span>
                    )}
                    {plan.completed_at && (
                      <span className="flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3 text-green-500" />
                        Concluido em {formatDate(plan.completed_at)}
                      </span>
                    )}
                  </div>
                  {plan.notes && (
                    <p className="text-xs text-muted-foreground italic">
                      {plan.notes}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              Nenhum plano de acao registrado ainda.
            </p>
          )}

          <ActionPlanForm riskItemId={riskId} members={members} />
        </CardContent>
      </Card>

      {/* Reviews */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Revisoes de Eficacia
          </CardTitle>
          <CardDescription>
            {risk.reviews?.length ?? 0} revisao(oes) registrada(s).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {risk.reviews && risk.reviews.length > 0 ? (
            <div className="space-y-2">
              {risk.reviews.map((review) => (
                <div
                  key={review.id}
                  className="rounded-lg border p-4 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      Revisao de {formatDate(review.review_date)}
                    </span>
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-md px-2 py-0.5 text-xs font-medium ${LEVEL_COLORS[review.new_risk_level] ?? ""}`}
                      >
                        {LEVEL_LABELS[review.new_risk_level] ?? review.new_risk_level}
                      </span>
                      <Badge variant="outline">
                        {RECOMMENDATION_LABELS[review.recommendation] ?? review.recommendation}
                      </Badge>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">
                      Metodo: {review.assessment_method}
                    </p>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {review.findings}
                  </p>
                  {review.new_score != null && (
                    <p className="text-xs text-muted-foreground">
                      Nova pontuacao: {review.new_score}/100
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              Nenhuma revisao de eficacia registrada ainda.
            </p>
          )}

          <ReviewForm riskItemId={riskId} />
        </CardContent>
      </Card>

      {/* Audit Log */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Audit Log
          </CardTitle>
          <CardDescription>
            Historico de alteracoes neste risco.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {risk.audit_log && risk.audit_log.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-3 pr-4 font-medium">Acao</th>
                    <th className="pb-3 pr-4 font-medium">Ator</th>
                    <th className="pb-3 pr-4 font-medium">Data</th>
                    <th className="pb-3 font-medium">Detalhes</th>
                  </tr>
                </thead>
                <tbody>
                  {risk.audit_log.map((log) => (
                    <tr key={log.id} className="border-b">
                      <td className="py-3 pr-4 font-medium">{log.action}</td>
                      <td className="py-3 pr-4 text-muted-foreground">
                        {log.actor_id ? log.actor_id.slice(0, 8) + "..." : "Sistema"}
                      </td>
                      <td className="py-3 pr-4 text-muted-foreground">
                        {formatDateTime(log.created_at)}
                      </td>
                      <td className="py-3 text-muted-foreground">
                        {log.details
                          ? Object.entries(log.details)
                              .map(([k, v]) => `${k}: ${v}`)
                              .join(", ")
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              Nenhum registro de auditoria disponivel.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Disclaimer */}
      <p className="text-xs text-muted-foreground text-center">
        Este relatorio depende de validacao por profissional habilitado. O
        inventario de riscos deve ser atualizado conforme NR-1 e demais normas
        regulamentadoras aplicaveis.
      </p>
    </div>
  );
}
