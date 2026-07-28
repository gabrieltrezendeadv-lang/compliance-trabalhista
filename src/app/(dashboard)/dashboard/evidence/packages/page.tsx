import Link from "next/link";
import { ChevronLeft, ChevronRight, Package } from "lucide-react";
import { getEvidencePackages } from "@/lib/evidence/actions";
import { PackageCreateForm } from "@/components/evidence/package-create-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatDate } from "@/lib/utils";

export const metadata = {
  title: "Pacotes de Evidência — Compliance Trabalhista",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Rascunho",
  sealed: "Selado",
  exported: "Finalizado",
};

export default async function EvidencePackagesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const sp = await searchParams;
  const currentPage = Math.max(1, Number(sp.page) || 1);
  const result = await getEvidencePackages(currentPage);

  const packages = result.data ?? [];
  const total = result.total ?? 0;
  const pageSize = result.pageSize ?? 10;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Pacotes de Evidência</h1>
        <p className="text-muted-foreground">
          Agrupe relatórios do mesmo período e sele o conjunto para preservar sua integridade.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Novo pacote</CardTitle>
          <CardDescription>
            O período é obrigatório e deve abranger os relatórios incluídos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PackageCreateForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pacotes existentes</CardTitle>
          <CardDescription>{total} pacote(s) encontrado(s).</CardDescription>
        </CardHeader>
        <CardContent>
          {"error" in result && result.error ? (
            <p className="text-sm text-destructive">{result.error}</p>
          ) : packages.length === 0 ? (
            <div className="flex flex-col items-center py-10 text-center">
              <Package className="h-10 w-10 text-muted-foreground/50" />
              <p className="mt-3 text-sm text-muted-foreground">
                Nenhum pacote criado.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {packages.map((item: Record<string, unknown>) => {
                const countRelation = item.evidence_package_items as
                  | Array<{ count?: number }>
                  | undefined;
                return (
                  <Link
                    key={item.id as string}
                    href={`/dashboard/evidence/packages/${item.id}`}
                    className="flex items-center justify-between rounded-lg border p-4 hover:bg-muted/50"
                  >
                    <div>
                      <p className="font-medium">{item.name as string}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(item.period_start as string)} —{" "}
                        {formatDate(item.period_end as string)} ·{" "}
                        {countRelation?.[0]?.count ?? 0} relatório(s)
                      </p>
                    </div>
                    <Badge variant="outline">
                      {STATUS_LABELS[item.status as string] ?? String(item.status)}
                    </Badge>
                  </Link>
                );
              })}
            </div>
          )}

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Página {currentPage} de {totalPages}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" asChild={currentPage > 1}>
                  {currentPage > 1 ? (
                    <Link href={`?page=${currentPage - 1}`}>
                      <ChevronLeft className="mr-1 h-4 w-4" /> Anterior
                    </Link>
                  ) : (
                    <span>Anterior</span>
                  )}
                </Button>
                <Button variant="outline" size="sm" asChild={currentPage < totalPages}>
                  {currentPage < totalPages ? (
                    <Link href={`?page=${currentPage + 1}`}>
                      Próxima <ChevronRight className="ml-1 h-4 w-4" />
                    </Link>
                  ) : (
                    <span>Próxima</span>
                  )}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
