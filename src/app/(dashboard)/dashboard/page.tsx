import Link from "next/link";
import { getDashboardKPIs } from "@/lib/dashboard/actions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  MapPin,
  FolderTree,
  Users,
  Shield,
  Send,
  AlertTriangle,
  ClipboardCheck,
  FileText,
  Package,
  TrendingUp,
  Clock,
  CheckCircle,
} from "lucide-react";

export const metadata = {
  title: "Painel — Compliance Trabalhista",
};

const RISK_LEVEL_COLORS: Record<string, string> = {
  very_high: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-yellow-500",
  low: "bg-green-500",
  very_low: "bg-emerald-400",
};

const RISK_LEVEL_LABELS: Record<string, string> = {
  very_high: "Muito alto",
  high: "Alto",
  medium: "Médio",
  low: "Baixo",
  very_low: "Muito baixo",
};

export default async function DashboardPage() {
  const { data: kpis } = await getDashboardKPIs();

  if (!kpis) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Painel</h1>
          <p className="text-muted-foreground">
            Não foi possível carregar os dados do painel.
          </p>
        </div>
      </div>
    );
  }

  const riskLevelOrder = ["very_high", "high", "medium", "low", "very_low"];
  const totalRiskBar = kpis.risksTotal || 1;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Painel</h1>
        <p className="text-muted-foreground">
          Visão geral consolidada da compliance trabalhista
        </p>
      </div>

      {/* Row 1: organização */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          title="Estabelecimentos"
          value={kpis.establishments}
          icon={<MapPin className="h-4 w-4" />}
          href="/dashboard/establishments"
        />
        <StatCard
          title="Departamentos"
          value={kpis.departments}
          icon={<FolderTree className="h-4 w-4" />}
          href="/dashboard/departments"
        />
        <StatCard
          title="Membros"
          value={kpis.members}
          icon={<Users className="h-4 w-4" />}
          href="/dashboard/members"
        />
      </div>

      {/* Row 2: módulos de compliance */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Denúncias abertas"
          value={kpis.complaintsOpen}
          subtitle={`${kpis.complaintsTotal} total`}
          icon={<Shield className="h-4 w-4" />}
          href="/dashboard/complaints"
          accent={kpis.complaintsOpen > 0 ? "yellow" : undefined}
        />
        <StatCard
          title="Campanhas ativas"
          value={kpis.campaignsActive}
          subtitle={`${kpis.campaignsTotal} total`}
          icon={<Send className="h-4 w-4" />}
          href="/dashboard/campaigns"
        />
        <StatCard
          title="Ciclos de avaliação"
          value={kpis.assessmentCyclesActive}
          subtitle={`${kpis.assessmentParticipationRate}% participação`}
          icon={<ClipboardCheck className="h-4 w-4" />}
          href="/dashboard/assessments"
        />
        <StatCard
          title="Evidências"
          value={kpis.evidenceReports}
          subtitle={`${kpis.evidencePackagesSealed} pacote(s) selado(s)`}
          icon={<FileText className="h-4 w-4" />}
          href="/dashboard/evidence"
        />
      </div>

      {/* Row 3: Riscos + Planos de ação */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Riscos por nível */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Inventário de Riscos</CardTitle>
                <CardDescription>
                  {kpis.risksTotal} risco(s) identificado(s)
                </CardDescription>
              </div>
              <Link
                href="/dashboard/risks"
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Ver todos →
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {kpis.risksTotal === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                Nenhum risco identificado ainda.
              </p>
            ) : (
              <div className="space-y-3">
                {/* Barra empilhada */}
                <div className="flex h-3 w-full overflow-hidden rounded-full">
                  {riskLevelOrder.map((level) => {
                    const count = kpis.risksByLevel[level] ?? 0;
                    if (count === 0) return null;
                    const pct = (count / totalRiskBar) * 100;
                    return (
                      <div
                        key={level}
                        className={`${RISK_LEVEL_COLORS[level]} transition-all`}
                        style={{ width: `${pct}%` }}
                        title={`${RISK_LEVEL_LABELS[level]}: ${count}`}
                      />
                    );
                  })}
                </div>
                {/* Legenda */}
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {riskLevelOrder.map((level) => {
                    const count = kpis.risksByLevel[level] ?? 0;
                    if (count === 0) return null;
                    return (
                      <div key={level} className="flex items-center gap-1.5">
                        <div
                          className={`h-2.5 w-2.5 rounded-full ${RISK_LEVEL_COLORS[level]}`}
                        />
                        <span className="text-xs text-muted-foreground">
                          {RISK_LEVEL_LABELS[level]}: {count}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Planos de ação */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Planos de Ação</CardTitle>
                <CardDescription>
                  {kpis.actionPlansTotal} plano(s) cadastrado(s)
                </CardDescription>
              </div>
              <Link
                href="/dashboard/risks"
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Ver todos →
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-3 rounded-lg border p-3">
                <Clock className="h-5 w-5 text-red-500" />
                <div>
                  <p className="text-2xl font-bold text-red-600">
                    {kpis.actionPlansOverdue}
                  </p>
                  <p className="text-xs text-muted-foreground">Vencido(s)</p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-lg border p-3">
                <CheckCircle className="h-5 w-5 text-green-500" />
                <div>
                  <p className="text-2xl font-bold text-green-600">
                    {kpis.actionPlansTotal - kpis.actionPlansOverdue}
                  </p>
                  <p className="text-xs text-muted-foreground">Em dia</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Row 4: Taxa de entrega + Participação */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Taxa de Entrega de Campanhas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <TrendingUp className="h-8 w-8 text-muted-foreground" />
              <div className="flex-1">
                <p className="text-3xl font-bold">{kpis.campaignDeliveryRate}%</p>
                <div className="mt-2 h-2 w-full rounded-full bg-muted">
                  <div
                    className="h-2 rounded-full bg-green-500 transition-all"
                    style={{ width: `${kpis.campaignDeliveryRate}%` }}
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Participação em Avaliações</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <ClipboardCheck className="h-8 w-8 text-muted-foreground" />
              <div className="flex-1">
                <p className="text-3xl font-bold">
                  {kpis.assessmentParticipationRate}%
                </p>
                <div className="mt-2 h-2 w-full rounded-full bg-muted">
                  <div
                    className="h-2 rounded-full bg-blue-500 transition-all"
                    style={{ width: `${kpis.assessmentParticipationRate}%` }}
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Alertas */}
      {(kpis.complaintsOpen > 0 || kpis.actionPlansOverdue > 0) && (
        <Card className="border-yellow-200 bg-yellow-50/50">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-yellow-800">
              <AlertTriangle className="h-4 w-4" />
              Atenção necessária
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm text-yellow-800">
              {kpis.complaintsOpen > 0 && (
                <li>
                  <Link
                    href="/dashboard/complaints"
                    className="underline hover:no-underline"
                  >
                    {kpis.complaintsOpen} denúncia(s) aberta(s)
                  </Link>{" "}
                  aguardando tratamento
                </li>
              )}
              {kpis.actionPlansOverdue > 0 && (
                <li>
                  <Link
                    href="/dashboard/risks"
                    className="underline hover:no-underline"
                  >
                    {kpis.actionPlansOverdue} plano(s) de ação vencido(s)
                  </Link>{" "}
                  requerem ação imediata
                </li>
              )}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Disclaimer */}
      <p className="text-xs text-muted-foreground text-center">
        Este relatório depende de validação por profissional habilitado. Os
        indicadores são calculados em tempo real com base nos dados cadastrados.
      </p>
    </div>
  );
}

// ─── Componente auxiliar ──────────────────────────────────────────────────────

function StatCard({
  title,
  value,
  subtitle,
  icon,
  href,
  accent,
}: {
  title: string;
  value: number;
  subtitle?: string;
  icon: React.ReactNode;
  href: string;
  accent?: "yellow" | "red";
}) {
  const accentClass =
    accent === "yellow"
      ? "border-yellow-200 bg-yellow-50/50"
      : accent === "red"
        ? "border-red-200 bg-red-50/50"
        : "";

  return (
    <Link href={href}>
      <Card
        className={`transition-colors hover:bg-accent/50 ${accentClass}`}
      >
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {title}
          </CardTitle>
          <div className="text-muted-foreground">{icon}</div>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{value}</div>
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
