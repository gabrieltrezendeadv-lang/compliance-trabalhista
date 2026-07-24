import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getEvidencePackageDetail,
  sealEvidencePackage,
} from "@/lib/evidence/actions";
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
  Package,
  ArrowLeft,
  FileText,
  ShieldCheck,
  Lock,
  Calendar,
} from "lucide-react";

const PACKAGE_STATUS_COLORS: Record<string, string> = {
  draft: "bg-yellow-100 text-yellow-800 border-yellow-200",
  sealed: "bg-green-100 text-green-800 border-green-200",
  expired: "bg-gray-100 text-gray-600 border-gray-200",
};

const PACKAGE_STATUS_LABELS: Record<string, string> = {
  draft: "Rascunho",
  sealed: "Selado",
  expired: "Expirado",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { data } = await getEvidencePackageDetail(id);
  return {
    title: data
      ? `${data.name} — Compliance Trabalhista`
      : "Pacote de Evidência — Compliance Trabalhista",
  };
}

export default async function EvidencePackageDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { data, error } = await getEvidencePackageDetail(id);

  if (!data || error) {
    notFound();
  }

  const status = (data.status as string) ?? "draft";

  async function handleSeal() {
    "use server";
    await sealEvidencePackage(id);
  }

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
          <h1 className="text-2xl font-bold tracking-tight">{data.name}</h1>
          {data.description && (
            <p className="text-muted-foreground">{data.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={PACKAGE_STATUS_COLORS[status] ?? ""}
          >
            {PACKAGE_STATUS_LABELS[status] ?? status}
          </Badge>
        </div>
      </div>

      {/* Period and info */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Status
            </CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-sm font-medium">
              {PACKAGE_STATUS_LABELS[status] ?? status}
            </div>
          </CardContent>
        </Card>
        {(data.period_start || data.period_end) && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Período
              </CardTitle>
              <Calendar className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-sm">
                {data.period_start ? formatDate(data.period_start) : "—"} —{" "}
                {data.period_end ? formatDate(data.period_end) : "—"}
              </div>
            </CardContent>
          </Card>
        )}
        {data.sealed_at && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Selado em
              </CardTitle>
              <Lock className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-sm font-medium">
                {formatDateTime(data.sealed_at)}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Package hash */}
      {data.package_hash && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base">Integridade do Pacote</CardTitle>
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">
                Hash do pacote
              </p>
              <code className="text-xs bg-muted px-2 py-1 rounded break-all">
                {data.package_hash}
              </code>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Items / Reports */}
      <Card>
        <CardHeader>
          <CardTitle>Relatórios no Pacote</CardTitle>
          <CardDescription>
            {data.items?.length ?? 0} relatório
            {(data.items?.length ?? 0) !== 1 ? "s" : ""} incluído
            {(data.items?.length ?? 0) !== 1 ? "s" : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!data.items || data.items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <FileText className="h-10 w-10 text-muted-foreground/50" />
              <h3 className="mt-3 text-sm font-semibold">
                Nenhum relatório adicionado
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Adicione relatórios de evidência a este pacote antes de selá-lo.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {data.items.map(
                (item: Record<string, unknown>, index: number) => {
                  const reportId =
                    (item.report_id as string) ?? (item.id as string);
                  const reportTitle =
                    (item.title as string) ??
                    (item.report_title as string) ??
                    `Relatório ${index + 1}`;

                  return (
                    <Link
                      key={reportId}
                      href={`/dashboard/evidence/${reportId}`}
                      className="block"
                    >
                      <div className="flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50">
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="text-sm font-medium">
                            {reportTitle}
                          </span>
                        </div>
                        {item.source_type ? (
                          <span className="text-xs text-muted-foreground">
                            {String(item.source_type)}
                          </span>
                        ) : null}
                      </div>
                    </Link>
                  );
                },
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Seal action */}
      {status === "draft" && (
        <Card>
          <CardContent className="flex items-center justify-between py-4">
            <div className="flex items-center gap-3">
              <Lock className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Selar Pacote</p>
                <p className="text-xs text-muted-foreground">
                  Após selado, o pacote não poderá ser alterado. Um hash de
                  integridade será gerado.
                </p>
              </div>
            </div>
            <form action={handleSeal}>
              <Button type="submit">
                <ShieldCheck className="mr-2 h-4 w-4" />
                Selar Pacote
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Disclaimer */}
      <p className="text-xs text-muted-foreground text-center">
        Este relatório depende de validação por profissional habilitado. Os
        dados gerados possuem caráter informativo e não substituem parecer
        técnico. A selagem do pacote garante integridade criptográfica, mas não
        confere validade jurídica autônoma.
      </p>
    </div>
  );
}
