import Link from "next/link";
import { notFound } from "next/navigation";
import { getEvidenceReportDetail } from "@/lib/evidence/actions";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, formatDateTime } from "@/lib/utils";
import {
  FileText,
  ArrowLeft,
  Hash,
  Calendar,
  History,
  ShieldCheck,
} from "lucide-react";

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

const TYPE_LABELS: Record<string, string> = {
  risk_assessment: "Avaliação de Risco",
  complaint: "Denúncia",
  assessment: "Avaliação Psicossocial",
  campaign: "Campanha",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { data } = await getEvidenceReportDetail(id);
  return {
    title: data
      ? `${data.title} — Compliance Trabalhista`
      : "Relatório de Evidência — Compliance Trabalhista",
  };
}

export default async function EvidenceReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { data, error, disclaimer } = await getEvidenceReportDetail(id);

  if (!data || error) {
    notFound();
  }

  const status = (data.status as string) ?? "generating";
  const sourceType = (data.source_type as string) ?? "";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <Link
            href="/dashboard/evidence"
            className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors mb-2"
          >
            <ArrowLeft className="mr-1 h-4 w-4" />
            Voltar para relatórios
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">{data.title}</h1>
          <p className="text-muted-foreground">
            {TYPE_LABELS[sourceType] ?? sourceType} — Versão {data.version}
          </p>
        </div>
        <Badge variant="outline" className={STATUS_COLORS[status] ?? ""}>
          {STATUS_LABELS[status] ?? status}
        </Badge>
      </div>

      {/* Metadata cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Versão
            </CardTitle>
            <History className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.version}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Gerado em
            </CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-sm font-medium">
              {data.created_at ? formatDateTime(data.created_at) : "—"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Tipo
            </CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-sm font-medium">
              {TYPE_LABELS[sourceType] ?? sourceType}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Period */}
      {(data.period_start || data.period_end) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Período de Referência</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4 text-sm">
              {data.period_start && (
                <div>
                  <span className="text-muted-foreground">Início: </span>
                  <span className="font-medium">
                    {formatDate(data.period_start)}
                  </span>
                </div>
              )}
              {data.period_end && (
                <div>
                  <span className="text-muted-foreground">Fim: </span>
                  <span className="font-medium">
                    {formatDate(data.period_end)}
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Content snapshot */}
      {data.content_snapshot && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Snapshot do Conteúdo</CardTitle>
            <CardDescription>
              Dados capturados no momento da geração do relatório.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="overflow-auto rounded-lg bg-muted p-4 text-xs leading-relaxed">
              <code>
                {typeof data.content_snapshot === "string"
                  ? data.content_snapshot
                  : JSON.stringify(data.content_snapshot, null, 2)}
              </code>
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Content hash */}
      {data.content_hash && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base">Integridade</CardTitle>
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">
                Hash do conteúdo
              </p>
              <code className="text-xs bg-muted px-2 py-1 rounded break-all">
                {data.content_hash}
              </code>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Metadata */}
      {data.metadata && Object.keys(data.metadata).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Metadados</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="overflow-auto rounded-lg bg-muted p-4 text-xs leading-relaxed">
              <code>{JSON.stringify(data.metadata, null, 2)}</code>
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Previous version link */}
      {data.previous_version_id && (
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <History className="h-5 w-5 text-muted-foreground" />
            <div className="flex-1">
              <p className="text-sm font-medium">Versão anterior disponível</p>
              <p className="text-xs text-muted-foreground">
                Este relatório substituiu uma versão anterior.
              </p>
            </div>
            <Link href={`/dashboard/evidence/${data.previous_version_id}`}>
              <Button variant="outline" size="sm">
                <Hash className="mr-1 h-3 w-3" />
                Ver versão anterior
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Disclaimer */}
      <p className="text-xs text-muted-foreground text-center">
        {disclaimer ??
          "Este relatório depende de validação por profissional habilitado. Os dados gerados possuem caráter informativo e não substituem parecer técnico."}
      </p>
    </div>
  );
}
