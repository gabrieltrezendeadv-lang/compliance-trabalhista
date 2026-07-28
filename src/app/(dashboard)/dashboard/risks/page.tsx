import Link from "next/link";
import { getRiskItems, getRiskSummary } from "@/lib/risks/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ImportRisksButton } from "@/components/risks/import-risks-button";
import { formatDate } from "@/lib/utils";
import { RISKS_PAGE_SIZE } from "@/lib/constants";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Plus,
  Shield,
  Activity,
  BarChart3,
} from "lucide-react";
export const metadata = {
  title: "Inventario de Riscos — Compliance Trabalhista",
};

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

const SOURCE_COLORS: Record<string, string> = {
  assessment: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-300",
  complaint: "bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-300",
  inspection: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300",
  manual: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300",
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

// ── Page ────────────────────────────────────────────────────────────────────

export default async function RisksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;

  const page = Number(sp.page) || 1;
  const filters = {
    status: typeof sp.status === "string" ? sp.status : undefined,
    category: typeof sp.category === "string" ? sp.category : undefined,
    level: typeof sp.level === "string" ? sp.level : undefined,
    source: typeof sp.source === "string" ? sp.source : undefined,
  };

  const [risksResult, summaryResult] = await Promise.all([
    getRiskItems(page, filters),
    getRiskSummary(),
  ]);

  const risks = risksResult.data ?? [];
  const total = risksResult.total ?? 0;
  const totalPages = Math.ceil(total / RISKS_PAGE_SIZE);

  const summary = summaryResult.data as {
    total?: number;
    by_level?: Record<string, number>;
    by_status?: Record<string, number>;
    overdue_actions?: number;
    pending_reviews?: number;
  } | null;

  // Build query string helper for pagination/filter links
  function buildQuery(overrides: Record<string, string | undefined>) {
    const params = new URLSearchParams();
    const merged = { ...filters, page: String(page), ...overrides };
    for (const [key, value] of Object.entries(merged)) {
      if (value) params.set(key, value);
    }
    return params.toString();
  }

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Inventario de Riscos
          </h1>
          <p className="text-muted-foreground">
            Gestao centralizada dos riscos identificados na organizacao.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ImportRisksButton />
          <Link href="/dashboard/risks/new">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Novo Risco
            </Button>
          </Link>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total de Riscos
            </CardTitle>
            <Shield className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary?.total ?? total}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Alto / Muito alto
            </CardTitle>
            <AlertTriangle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600 dark:text-red-400">
              {(summary?.by_level?.high ?? 0) + (summary?.by_level?.critical ?? 0)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Em Tratamento
            </CardTitle>
            <Activity className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {summary?.by_status?.in_progress ?? 0}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Acoes Atrasadas
            </CardTitle>
            <BarChart3 className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">
              {summary?.overdue_actions ?? 0}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground mr-2">
              Filtros:
            </span>

            {/* Status filter */}
            {(["identified", "action_planned", "in_progress", "mitigated", "accepted", "closed"] as const).map(
              (s) => {
                const isActive = filters.status === s;
                return (
                  <Link
                    key={s}
                    href={`/dashboard/risks?${buildQuery({
                      status: isActive ? undefined : s,
                      page: "1",
                    })}`}
                  >
                    <Badge variant={isActive ? "default" : "outline"}>
                      {STATUS_LABELS[s]}
                    </Badge>
                  </Link>
                );
              }
            )}

            <span className="mx-1 text-muted-foreground">|</span>

            {/* Level filter */}
            {(["low", "moderate", "high", "critical"] as const).map(
              (l) => {
                const isActive = filters.level === l;
                return (
                  <Link
                    key={l}
                    href={`/dashboard/risks?${buildQuery({
                      level: isActive ? undefined : l,
                      page: "1",
                    })}`}
                  >
                    <Badge
                      variant={isActive ? "default" : "outline"}
                      className={isActive ? "" : LEVEL_COLORS[l]}
                    >
                      {LEVEL_LABELS[l]}
                    </Badge>
                  </Link>
                );
              }
            )}

            {activeFilterCount > 0 && (
              <Link href="/dashboard/risks">
                <Badge variant="secondary" className="ml-2">
                  Limpar filtros
                </Badge>
              </Link>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Risk list table */}
      <Card>
        <CardHeader>
          <CardTitle>Riscos Identificados</CardTitle>
          <CardDescription>
            {total} risco(s) encontrado(s)
            {activeFilterCount > 0 && " com os filtros aplicados"}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {risks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Shield className="h-12 w-12 text-muted-foreground/50" />
              <h3 className="mt-4 text-lg font-semibold">
                Nenhum risco encontrado
              </h3>
              <p className="mt-2 text-sm text-muted-foreground max-w-sm">
                {activeFilterCount > 0
                  ? "Nenhum risco corresponde aos filtros selecionados. Tente alterar os filtros."
                  : "Os riscos identificados em avaliacoes, denuncias e inspecoes aparecerao aqui."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-3 pr-4 font-medium">Titulo</th>
                    <th className="pb-3 pr-4 font-medium">Fonte</th>
                    <th className="pb-3 pr-4 font-medium">Categoria</th>
                    <th className="pb-3 pr-4 font-medium">Nivel</th>
                    <th className="pb-3 pr-4 font-medium">Status</th>
                    <th className="pb-3 pr-4 font-medium">Prioridade</th>
                    <th className="pb-3 font-medium">Identificado em</th>
                  </tr>
                </thead>
                <tbody>
                  {risks.map((risk: Record<string, unknown>) => {
                    const riskId = risk.id as string;
                    const level = risk.initial_risk_level as string;
                    const status = risk.status as string;
                    const source = risk.source as string;
                    const category = risk.category as string;

                    return (
                      <tr
                        key={riskId}
                        className="border-b transition-colors hover:bg-muted/50"
                      >
                        <td className="py-3 pr-4">
                          <Link
                            href={`/dashboard/risks/${riskId}`}
                            className="font-medium hover:underline"
                          >
                            {risk.title as string}
                          </Link>
                        </td>
                        <td className="py-3 pr-4">
                          <span
                            className={`rounded-md px-2 py-0.5 text-xs font-medium ${SOURCE_COLORS[source] ?? ""}`}
                          >
                            {SOURCE_LABELS[source] ?? source}
                          </span>
                        </td>
                        <td className="py-3 pr-4 text-muted-foreground">
                          {CATEGORY_LABELS[category] ?? category}
                        </td>
                        <td className="py-3 pr-4">
                          <span
                            className={`rounded-md px-2 py-0.5 text-xs font-medium ${LEVEL_COLORS[level] ?? ""}`}
                          >
                            {LEVEL_LABELS[level] ?? level}
                          </span>
                        </td>
                        <td className="py-3 pr-4">
                          <span
                            className={`rounded-md px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[status] ?? ""}`}
                          >
                            {STATUS_LABELS[status] ?? status}
                          </span>
                        </td>
                        <td className="py-3 pr-4 text-center text-muted-foreground">
                          {(risk.priority as number) ?? "—"}
                        </td>
                        <td className="py-3 text-muted-foreground">
                          {risk.identified_at
                            ? formatDate(risk.identified_at as string)
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Pagina {page} de {totalPages}
              </p>
              <div className="flex items-center gap-2">
                {page > 1 && (
                  <Link
                    href={`/dashboard/risks?${buildQuery({
                      page: String(page - 1),
                    })}`}
                  >
                    <Button variant="outline" size="sm">
                      <ChevronLeft className="mr-1 h-4 w-4" />
                      Anterior
                    </Button>
                  </Link>
                )}
                {page < totalPages && (
                  <Link
                    href={`/dashboard/risks?${buildQuery({
                      page: String(page + 1),
                    })}`}
                  >
                    <Button variant="outline" size="sm">
                      Proxima
                      <ChevronRight className="ml-1 h-4 w-4" />
                    </Button>
                  </Link>
                )}
              </div>
            </div>
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
