import { generateComplianceReport } from "@/lib/reports/actions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FileText } from "lucide-react";
import { ReportDownloadButton } from "@/components/reports/report-download-button";

export const metadata = {
  title: "Relatório de Compliance — Compliance Trabalhista",
};

const RISK_LEVEL_LABELS: Record<string, string> = {
  critical: "Crítico",
  high: "Alto",
  moderate: "Moderado",
  low: "Baixo",
};

const RISK_CATEGORY_LABELS: Record<string, string> = {
  psychosocial: "Psicossocial",
  ergonomic: "Ergonômico",
  physical: "Físico",
  chemical: "Químico",
  biological: "Biológico",
  accident: "Acidente",
  organizational: "Organizacional",
};

const RISK_STATUS_LABELS: Record<string, string> = {
  identified: "Identificado",
  action_planned: "Ação planejada",
  in_progress: "Em andamento",
  mitigated: "Mitigado",
  accepted: "Aceito",
  closed: "Encerrado",
};

const ACTION_STATUS_LABELS: Record<string, string> = {
  planned: "Planejado",
  in_progress: "Em andamento",
  completed: "Concluído",
  overdue: "Vencido",
  cancelled: "Cancelado",
};

const COMPLAINT_STATUS_LABELS: Record<string, string> = {
  pending: "Pendente",
  under_review: "Em análise",
  investigating: "Em investigação",
  action_required: "Ação necessária",
  resolved: "Resolvida",
  dismissed: "Arquivada",
  reopened: "Reaberta",
};

const CAMPAIGN_TYPE_LABELS: Record<string, string> = {
  informational: "Informativo",
  risk_assessment: "Avaliação de risco",
  policy_update: "Atualização de política",
  training: "Treinamento",
  legal_notice: "Comunicação legal",
  custom: "Personalizada",
};

const CONTROL_LEVEL_LABELS: Record<string, string> = {
  elimination: "Eliminação",
  substitution: "Substituição",
  engineering: "Engenharia",
  administrative: "Administrativo",
  ppe: "EPI",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function ReportsPage() {
  const { data: report, error } = await generateComplianceReport();

  if (error || !report) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Relatório de Compliance
          </h1>
          <p className="text-red-600 mt-2">
            Erro ao gerar relatório: {error ?? "Dados indisponíveis"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 print:space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between print:block">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Relatório de Compliance Trabalhista
          </h1>
          <p className="text-muted-foreground mt-1">
            {report.organization.name}
            {report.organization.documentNumber &&
              ` — CNPJ ${report.organization.documentNumber}`}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Gerado em {formatDateTime(report.generatedAt)}
          </p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <ReportDownloadButton />
        </div>
      </div>

      {/* Hash de integridade */}
      <Card className="print:border-none print:shadow-none">
        <CardContent className="pt-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <FileText className="h-3.5 w-3.5" />
            <span>
              Integridade SHA-256:{" "}
              <code className="font-mono text-[10px] break-all">
                {report.hash}
              </code>
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Resumo executivo */}
      <Card>
        <CardHeader>
          <CardTitle>Resumo Executivo</CardTitle>
          <CardDescription>
            Visão consolidada dos indicadores de compliance
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <SummaryItem
              label="Estabelecimentos"
              value={report.summary.establishments}
            />
            <SummaryItem
              label="Departamentos"
              value={report.summary.departments}
            />
            <SummaryItem
              label="Colaboradores"
              value={report.summary.members}
            />
            <SummaryItem
              label="Riscos identificados"
              value={report.summary.totalRisks}
            />
            <SummaryItem
              label="Denúncias abertas"
              value={report.summary.openComplaints}
              alert={report.summary.openComplaints > 0}
            />
            <SummaryItem
              label="Campanhas enviadas"
              value={report.summary.campaignsSent}
            />
            <SummaryItem
              label="Pacotes de evidência selados"
              value={report.summary.evidencePackagesSealed}
            />
            <SummaryItem
              label="Ciclos de avaliação"
              value={report.summary.assessmentCycles}
            />
            <SummaryItem
              label="Taxa de participação"
              value={`${report.summary.participationRate}%`}
            />
          </div>
        </CardContent>
      </Card>

      {/* Inventário de Riscos */}
      <Card>
        <CardHeader>
          <CardTitle>Inventário de Riscos</CardTitle>
          <CardDescription>
            Riscos identificados conforme NR-1 — {report.risks.length}{" "}
            registro(s)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {report.risks.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Nenhum risco registrado.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-2 pr-4 font-medium text-muted-foreground">
                      Risco
                    </th>
                    <th className="pb-2 pr-4 font-medium text-muted-foreground">
                      Categoria
                    </th>
                    <th className="pb-2 pr-4 font-medium text-muted-foreground">
                      Nível inicial
                    </th>
                    <th className="pb-2 pr-4 font-medium text-muted-foreground">
                      Nível residual
                    </th>
                    <th className="pb-2 pr-4 font-medium text-muted-foreground">
                      Status
                    </th>
                    <th className="pb-2 font-medium text-muted-foreground">
                      Ações
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.risks.map((risk, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 pr-4">{risk.title}</td>
                      <td className="py-2 pr-4">
                        {RISK_CATEGORY_LABELS[risk.category] ?? risk.category}
                      </td>
                      <td className="py-2 pr-4">
                        {RISK_LEVEL_LABELS[risk.initialLevel] ??
                          risk.initialLevel}
                      </td>
                      <td className="py-2 pr-4">
                        {risk.residualLevel
                          ? (RISK_LEVEL_LABELS[risk.residualLevel] ??
                              risk.residualLevel)
                          : "—"}
                      </td>
                      <td className="py-2 pr-4">
                        {RISK_STATUS_LABELS[risk.status] ?? risk.status}
                      </td>
                      <td className="py-2">
                        {risk.actionPlansCompleted}/{risk.actionPlansCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Planos de Ação */}
      {report.actionPlans.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Planos de Ação</CardTitle>
            <CardDescription>
              Medidas de controle conforme hierarquia NR-1 1.5.4.4 —{" "}
              {report.actionPlans.length} plano(s)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-2 pr-4 font-medium text-muted-foreground">
                      Risco
                    </th>
                    <th className="pb-2 pr-4 font-medium text-muted-foreground">
                      Ação
                    </th>
                    <th className="pb-2 pr-4 font-medium text-muted-foreground">
                      Controle
                    </th>
                    <th className="pb-2 pr-4 font-medium text-muted-foreground">
                      Status
                    </th>
                    <th className="pb-2 pr-4 font-medium text-muted-foreground">
                      Prazo
                    </th>
                    <th className="pb-2 font-medium text-muted-foreground">
                      Conclusão
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.actionPlans.map((plan, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 pr-4 max-w-[150px] truncate">
                        {plan.riskTitle}
                      </td>
                      <td className="py-2 pr-4">{plan.title}</td>
                      <td className="py-2 pr-4">
                        {plan.controlLevel
                          ? (CONTROL_LEVEL_LABELS[plan.controlLevel] ??
                              plan.controlLevel)
                          : "—"}
                      </td>
                      <td className="py-2 pr-4">
                        {ACTION_STATUS_LABELS[plan.status] ?? plan.status}
                      </td>
                      <td className="py-2 pr-4">
                        {formatDate(plan.dueDate)}
                      </td>
                      <td className="py-2">
                        {formatDate(plan.completedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Denúncias */}
      <Card>
        <CardHeader>
          <CardTitle>Canal de Denúncias</CardTitle>
          <CardDescription>
            Estatísticas do canal — sem exposição de conteúdo (ADR-006)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 sm:grid-cols-3">
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">
                Por status
              </p>
              {Object.entries(report.complaints.byStatus).length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma denúncia.</p>
              ) : (
                <dl className="space-y-1">
                  {Object.entries(report.complaints.byStatus).map(
                    ([status, count]) => (
                      <div key={status} className="flex justify-between text-sm">
                        <dt className="text-muted-foreground">
                          {COMPLAINT_STATUS_LABELS[status] ?? status}
                        </dt>
                        <dd className="font-medium">{count}</dd>
                      </div>
                    )
                  )}
                </dl>
              )}
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">
                Por categoria
              </p>
              {Object.entries(report.complaints.byCategory).length === 0 ? (
                <p className="text-sm text-muted-foreground">—</p>
              ) : (
                <dl className="space-y-1">
                  {Object.entries(report.complaints.byCategory).map(
                    ([cat, count]) => (
                      <div key={cat} className="flex justify-between text-sm">
                        <dt className="text-muted-foreground capitalize">
                          {cat.replace(/_/g, " ")}
                        </dt>
                        <dd className="font-medium">{count}</dd>
                      </div>
                    )
                  )}
                </dl>
              )}
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">
                Por severidade
              </p>
              {Object.entries(report.complaints.bySeverity).length === 0 ? (
                <p className="text-sm text-muted-foreground">—</p>
              ) : (
                <dl className="space-y-1">
                  {Object.entries(report.complaints.bySeverity).map(
                    ([sev, count]) => (
                      <div key={sev} className="flex justify-between text-sm">
                        <dt className="text-muted-foreground capitalize">
                          {sev}
                        </dt>
                        <dd className="font-medium">{count}</dd>
                      </div>
                    )
                  )}
                </dl>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Campanhas */}
      <Card>
        <CardHeader>
          <CardTitle>Campanhas de Compliance</CardTitle>
          <CardDescription>
            Comunicações enviadas aos colaboradores — {report.campaigns.length}{" "}
            campanha(s)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {report.campaigns.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Nenhuma campanha registrada.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-2 pr-4 font-medium text-muted-foreground">
                      Campanha
                    </th>
                    <th className="pb-2 pr-4 font-medium text-muted-foreground">
                      Tipo
                    </th>
                    <th className="pb-2 pr-4 font-medium text-muted-foreground">
                      Canal
                    </th>
                    <th className="pb-2 pr-4 font-medium text-muted-foreground">
                      Destinatários
                    </th>
                    <th className="pb-2 font-medium text-muted-foreground">
                      Enviada em
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.campaigns.map((c, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 pr-4">{c.name}</td>
                      <td className="py-2 pr-4">
                        {CAMPAIGN_TYPE_LABELS[c.type] ?? c.type}
                      </td>
                      <td className="py-2 pr-4 capitalize">{c.channel}</td>
                      <td className="py-2 pr-4">{c.totalRecipients}</td>
                      <td className="py-2">{formatDate(c.sentAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Avaliações */}
      <Card>
        <CardHeader>
          <CardTitle>Avaliações de Riscos Psicossociais</CardTitle>
          <CardDescription>
            Ciclos de avaliação e participação — dados agregados (respostas
            individuais protegidas)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {report.assessments.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Nenhum ciclo de avaliação registrado.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-2 pr-4 font-medium text-muted-foreground">
                      Ciclo
                    </th>
                    <th className="pb-2 pr-4 font-medium text-muted-foreground">
                      Status
                    </th>
                    <th className="pb-2 pr-4 font-medium text-muted-foreground">
                      Convidados
                    </th>
                    <th className="pb-2 pr-4 font-medium text-muted-foreground">
                      Responderam
                    </th>
                    <th className="pb-2 font-medium text-muted-foreground">
                      Participação
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.assessments.map((a, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 pr-4">{a.cycleName}</td>
                      <td className="py-2 pr-4 capitalize">{a.status}</td>
                      <td className="py-2 pr-4">{a.totalInvitations}</td>
                      <td className="py-2 pr-4">{a.totalResponded}</td>
                      <td className="py-2">{a.participationRate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Evidências */}
      <Card>
        <CardHeader>
          <CardTitle>Pacotes de Evidência</CardTitle>
          <CardDescription>
            Documentos de compliance congelados — {report.evidence.reports}{" "}
            relatório(s), {report.evidence.packages.length} pacote(s)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {report.evidence.packages.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Nenhum pacote de evidência registrado.
            </p>
          ) : (
            <div className="space-y-3">
              {report.evidence.packages.map((pkg, i) => (
                <div key={i} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{pkg.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {pkg.itemCount} item(ns) —{" "}
                        {pkg.status === "sealed" ? "Selado" : pkg.status}
                        {pkg.sealedAt && ` em ${formatDate(pkg.sealedAt)}`}
                      </p>
                    </div>
                  </div>
                  {pkg.packageHash && (
                    <p className="text-[10px] text-muted-foreground mt-1 font-mono break-all">
                      SHA-256: {pkg.packageHash}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Disclaimer obrigatório */}
      <Card className="border-amber-200 bg-amber-50/50 print:border print:border-amber-300">
        <CardContent className="pt-4">
          <p className="text-sm text-amber-900 font-medium text-center">
            Este relatório depende de validação por profissional habilitado.
          </p>
          <p className="text-xs text-amber-800 text-center mt-1">
            Documento gerado automaticamente com base nos dados cadastrados no
            sistema. Não substitui parecer técnico de engenheiro de segurança
            do trabalho, médico do trabalho ou advogado trabalhista. Os dados
            de denúncias são apresentados apenas em forma estatística,
            preservando o anonimato dos denunciantes conforme ADR-006.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Componentes auxiliares ──────────────────────────────────────────────────

function SummaryItem({
  label,
  value,
  alert,
}: {
  label: string;
  value: string | number;
  alert?: boolean;
}) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={`text-xl font-bold mt-1 ${alert ? "text-red-600" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}
