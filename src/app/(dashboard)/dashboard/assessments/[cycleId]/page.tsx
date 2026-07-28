import { notFound } from "next/navigation";
import {
  getAssessmentCycle,
  getCycleSummary,
  getParticipationStats,
} from "@/lib/assessments/actions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  STATUS_LABELS,
  STATUS_COLORS,
  classifyRisk,
  RISK_LABELS,
  RISK_COLORS,
} from "@/lib/schemas/assessment";
import type { AssessmentStatus } from "@/lib/schemas/assessment";
import { Calendar, Users, ShieldAlert, AlertTriangle, Lock } from "lucide-react";
import { GenerateEvidenceButton } from "@/components/evidence/generate-evidence-button";
import { SendAssessmentInvitations } from "@/components/assessment/send-assessment-invitations";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ cycleId: string }>;
}) {
  const { cycleId } = await params;
  const { data: cycle } = await getAssessmentCycle(cycleId);
  return {
    title: cycle
      ? `${cycle.name} — Compliance Trabalhista`
      : "Avaliação — Compliance Trabalhista",
  };
}

export default async function CycleDetailPage({
  params,
}: {
  params: Promise<{ cycleId: string }>;
}) {
  const { cycleId } = await params;
  const [{ data: cycle }, { data: summary }, { data: participation }] =
    await Promise.all([
      getAssessmentCycle(cycleId),
      getCycleSummary(cycleId),
      getParticipationStats(cycleId),
    ]);

  if (!cycle) {
    notFound();
  }

  const status = cycle.status as AssessmentStatus;
  const startsAt = new Date(cycle.starts_at);
  const endsAt = new Date(cycle.ends_at);
  const overallParticipation = participation.find(
    (item) => item.scope === "overall"
  );
  const groupParticipation = participation.filter(
    (item) => item.scope !== "overall"
  );
  const overallProtected = overallParticipation?.below_threshold ?? false;
  const totalInvited = Number(overallParticipation?.invited_count ?? 0);
  const totalResponded = Number(overallParticipation?.responded_count ?? 0);
  const overallRate =
    totalInvited > 0
      ? ((totalResponded / totalInvited) * 100).toFixed(1)
      : "0";

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{cycle.name}</h1>
          {cycle.description && (
            <p className="mt-1 text-muted-foreground">{cycle.description}</p>
          )}
        </div>
        <div className="flex items-start gap-2">
          <GenerateEvidenceButton
            sourceId={cycleId}
            sourceType="assessment_cycle"
            reportType="assessment_result"
            title={`Evidência — ${cycle.name}`}
          />
          <span
            className={`rounded-md px-2.5 py-1 text-xs font-medium ${STATUS_COLORS[status]}`}
          >
            {STATUS_LABELS[status]}
          </span>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="text-base">Enviar avaliação</CardTitle>
            <CardDescription>
              Os convites usam os contatos ativos de Colaboradores. O token é
              armazenado como hash e as respostas futuras não guardam vínculo
              com o convite ou com a identidade do colaborador.
            </CardDescription>
          </div>
          <SendAssessmentInvitations
            disabled={status === "closed" || status === "archived"}
          />
        </CardHeader>
      </Card>

      {/* Resumo rápido */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Período
            </CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-sm font-medium">
              {startsAt.toLocaleDateString("pt-BR")} —{" "}
              {endsAt.toLocaleDateString("pt-BR")}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Convidados
            </CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {overallProtected ? "Protegido" : totalInvited}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Respostas
            </CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {overallProtected ? "Protegido" : totalResponded}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Adesão
            </CardTitle>
            <ShieldAlert className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {overallProtected ? "Protegido" : `${overallRate}%`}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Resultados agregados por dimensão */}
      <Card>
        <CardHeader>
          <CardTitle>Resultados por Dimensão</CardTitle>
          <CardDescription>
            Pontuações médias agregadas. Dimensões com menos de{" "}
            {cycle.min_respondents_threshold} respondentes têm resultados
            ocultados para proteção do anonimato.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {summary.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Nenhuma resposta registrada ainda.
            </p>
          ) : (
            <div className="space-y-3">
              {summary.map((dim) => {
                if (dim.below_threshold) {
                  return (
                    <div
                      key={dim.section_id}
                      className="flex items-center justify-between rounded-lg border border-dashed p-4"
                    >
                      <div className="flex items-center gap-3">
                        <Lock className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium">
                            {dim.section_name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {dim.respondent_count} respondentes — abaixo do
                            limiar de {cycle.min_respondents_threshold}
                          </p>
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        Dados protegidos
                      </span>
                    </div>
                  );
                }

                const risk = classifyRisk(dim.avg_score!);

                return (
                  <div
                    key={dim.section_id}
                    className="rounded-lg border p-4"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="text-sm font-medium">
                          {dim.section_name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {dim.respondent_count} respondentes
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-md px-2 py-0.5 text-xs font-medium ${RISK_COLORS[risk]}`}
                        >
                          {RISK_LABELS[risk]}
                        </span>
                        <span className="text-lg font-bold">
                          {dim.avg_score?.toFixed(1)}
                        </span>
                      </div>
                    </div>
                    {/* Barra de progresso visual */}
                    <div className="h-2 w-full rounded-full bg-muted">
                      <div
                        className={`h-2 rounded-full ${
                          risk === "low"
                            ? "bg-green-500"
                            : risk === "moderate"
                              ? "bg-yellow-500"
                              : risk === "high"
                                ? "bg-orange-500"
                                : "bg-red-500"
                        }`}
                        style={{
                          width: `${((dim.avg_score ?? 0) / 5) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Participação por grupo */}
      <Card>
        <CardHeader>
          <CardTitle>Participação por Grupo</CardTitle>
          <CardDescription>
            Taxa de adesão por estabelecimento e departamento.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {groupParticipation.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Nenhum convite enviado ainda.
            </p>
          ) : (
            <div className="space-y-2">
              {groupParticipation.map((stat, idx) => {
                const rate = Number(stat.participation_rate ?? 0);
                return (
                  <div
                    key={idx}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        {stat.establishment_name}
                        {stat.department_name && ` → ${stat.department_name}`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {stat.below_threshold
                          ? "Participação protegida pelo limiar de anonimato"
                          : `${Number(stat.responded_count)} de ${Number(stat.invited_count)} convidados`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {!stat.below_threshold && rate < 50 && (
                        <AlertTriangle className="h-4 w-4 text-yellow-500" />
                      )}
                      <span
                        className={`text-sm font-medium ${
                          rate >= 80
                            ? "text-green-600"
                            : rate >= 50
                              ? "text-yellow-600"
                              : "text-red-600"
                        }`}
                      >
                        {stat.below_threshold
                          ? "Protegido"
                          : `${rate.toFixed(0)}%`}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Aviso de compliance */}
      <p className="text-xs text-muted-foreground text-center">
        Este relatório depende de validação por profissional habilitado. As
        pontuações refletem dados agregados; respostas individuais não são
        acessíveis por nenhum usuário do sistema.
      </p>
    </div>
  );
}
