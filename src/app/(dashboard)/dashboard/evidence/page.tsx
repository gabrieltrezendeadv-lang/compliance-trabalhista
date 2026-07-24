import Link from "next/link";
import { getEvidenceReports } from "@/lib/evidence/actions";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utils";
import { FileText, Package, ChevronLeft, ChevronRight } from "lucide-react";

export const metadata = {
  title: "Relatórios de Evidência — Compliance Trabalhista",
};

const STATUS_COLORS: Record<string, string> = {
  ready: "bg-green-100 text-green-800 border-green-200",
  generating: "bg-yellow-100 text-yellow-800 border-yellow-200",
  failed: "bg-red-100 text-red-800 border-red-200",
  superseded: "bg-gray-100 text-gray-600 border-gray-200",
};

const STATUS_LABELS: Record<string, string> = {
  ready: "Pronto",
  generating: "Gerando",
  failed: "Falhou",
  superseded: "Substituído",
};

const TYPE_COLORS: Record<string, string> = {
  risk_assessment: "bg-blue-100 text-blue-800 border-blue-200",
  complaint: "bg-purple-100 text-purple-800 border-purple-200",
  assessment: "bg-indigo-100 text-indigo-800 border-indigo-200",
  campaign: "bg-cyan-100 text-cyan-800 border-cyan-200",
};

const TYPE_LABELS: Record<string, string> = {
  risk_assessment: "Avaliação de Risco",
  complaint: "Denúncia",
  assessment: "Avaliação Psicossocial",
  campaign: "Campanha",
};

export default async function EvidenceReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const sp = await searchParams;
  const currentPage = Math.max(1, Number(sp.page) || 1);

  const result = await getEvidenceReports(currentPage);

  if ("error" in result && result.error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Relatórios de Evidência
          </h1>
          <p className="text-muted-foreground">
            Erro ao carregar relatórios: {result.error}
          </p>
        </div>
      </div>
    );
  }

  const reports = result.data ?? [];
  const total = result.total ?? 0;
  const pageSize = result.pageSize ?? 10;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Relatórios de Evidência
          </h1>
          <p className="text-muted-foreground">
            Relatórios gerados para comprovação de conformidade trabalhista.
          </p>
        </div>
        <Link href="/dashboard/evidence/packages">
          <Button variant="outline">
            <Package className="mr-2 h-4 w-4" />
            Pacotes de Evidência
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Relatórios</CardTitle>
          <CardDescription>
            {total} relatório{total !== 1 ? "s" : ""} encontrado
            {total !== 1 ? "s" : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {reports.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileText className="h-12 w-12 text-muted-foreground/50" />
              <h3 className="mt-4 text-lg font-semibold">
                Nenhum relatório gerado
              </h3>
              <p className="mt-2 text-sm text-muted-foreground max-w-sm">
                Os relatórios de evidência serão gerados automaticamente a
                partir das avaliações e denúncias registradas.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="hidden sm:grid sm:grid-cols-[1fr_auto_auto_auto_auto] gap-4 px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                <span>Título</span>
                <span>Tipo</span>
                <span>Status</span>
                <span>Versão</span>
                <span>Gerado em</span>
              </div>
              {reports.map((report: Record<string, unknown>) => {
                const status = (report.status as string) ?? "generating";
                const sourceType = (report.source_type as string) ?? "";

                return (
                  <Link
                    key={report.id as string}
                    href={`/dashboard/evidence/${report.id}`}
                    className="block"
                  >
                    <div className="flex flex-col sm:grid sm:grid-cols-[1fr_auto_auto_auto_auto] gap-2 sm:gap-4 sm:items-center rounded-lg border p-4 transition-colors hover:bg-muted/50">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="text-sm font-medium truncate">
                          {report.title as string}
                        </span>
                      </div>
                      <Badge
                        variant="outline"
                        className={TYPE_COLORS[sourceType] ?? ""}
                      >
                        {TYPE_LABELS[sourceType] ?? sourceType}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={STATUS_COLORS[status] ?? ""}
                      >
                        {STATUS_LABELS[status] ?? status}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        v{report.version as number}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {report.created_at
                          ? formatDateTime(report.created_at as string)
                          : "—"}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4">
              <p className="text-sm text-muted-foreground">
                Página {currentPage} de {totalPages}
              </p>
              <div className="flex items-center gap-2">
                {currentPage > 1 ? (
                  <Link href={`/dashboard/evidence?page=${currentPage - 1}`}>
                    <Button variant="outline" size="sm">
                      <ChevronLeft className="mr-1 h-4 w-4" />
                      Anterior
                    </Button>
                  </Link>
                ) : (
                  <Button variant="outline" size="sm" disabled>
                    <ChevronLeft className="mr-1 h-4 w-4" />
                    Anterior
                  </Button>
                )}
                {currentPage < totalPages ? (
                  <Link href={`/dashboard/evidence?page=${currentPage + 1}`}>
                    <Button variant="outline" size="sm">
                      Próxima
                      <ChevronRight className="ml-1 h-4 w-4" />
                    </Button>
                  </Link>
                ) : (
                  <Button variant="outline" size="sm" disabled>
                    Próxima
                    <ChevronRight className="ml-1 h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Disclaimer */}
      <p className="text-xs text-muted-foreground text-center">
        Este relatório depende de validação por profissional habilitado. Os
        dados gerados possuem caráter informativo e não substituem parecer
        técnico.
      </p>
    </div>
  );
}
