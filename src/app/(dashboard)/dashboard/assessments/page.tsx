import { getAssessmentCycles } from "@/lib/assessments/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ClipboardCheck, Plus, Calendar, Users } from "lucide-react";
import Link from "next/link";
import {
  STATUS_LABELS,
  STATUS_COLORS,
} from "@/lib/schemas/assessment";
import type { AssessmentStatus } from "@/lib/schemas/assessment";

export const metadata = {
  title: "Avaliações Psicossociais — Compliance Trabalhista",
};

export default async function AssessmentsPage() {
  const { data: cycles } = await getAssessmentCycles();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Avaliações Psicossociais
          </h1>
          <p className="text-muted-foreground">
            Ciclos de avaliação de riscos psicossociais (NR-1/NR-17)
          </p>
        </div>
        {/* TODO: modal de criação de ciclo */}
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Novo ciclo
        </Button>
      </div>

      {cycles.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <ClipboardCheck className="h-12 w-12 text-muted-foreground/50" />
            <h3 className="mt-4 text-lg font-semibold">
              Nenhuma avaliação criada
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Crie um ciclo de avaliação psicossocial para começar a avaliar os
              riscos no ambiente de trabalho.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {cycles.map((cycle) => {
            const template = cycle.questionnaire_templates as unknown as {
              name: string;
              instrument_code: string | null;
            } | null;
            const status = cycle.status as AssessmentStatus;
            const startsAt = new Date(cycle.starts_at);
            const endsAt = new Date(cycle.ends_at);

            return (
              <Link
                key={cycle.id}
                href={`/dashboard/assessments/${cycle.id}`}
              >
                <Card className="transition-colors hover:bg-muted/50">
                  <CardHeader className="flex flex-row items-start justify-between pb-2">
                    <div className="space-y-1">
                      <CardTitle className="text-base">{cycle.name}</CardTitle>
                      {template && (
                        <p className="text-xs text-muted-foreground">
                          {template.name}
                          {template.instrument_code &&
                            ` (${template.instrument_code})`}
                        </p>
                      )}
                    </div>
                    <span
                      className={`rounded-md px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[status]}`}
                    >
                      {STATUS_LABELS[status]}
                    </span>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-6 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {startsAt.toLocaleDateString("pt-BR")} —{" "}
                        {endsAt.toLocaleDateString("pt-BR")}
                      </span>
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        Limiar: {cycle.min_respondents_threshold} respondentes
                      </span>
                    </div>
                    {cycle.description && (
                      <p className="mt-2 text-sm text-muted-foreground line-clamp-2">
                        {cycle.description}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
