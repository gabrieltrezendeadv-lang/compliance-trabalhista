import { getEstablishments } from "@/lib/organizations/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MapPin, Building2 } from "lucide-react";
import { CreateEstablishmentDialog } from "@/components/dashboard/create-establishment-dialog";

export const metadata = {
  title: "Estabelecimentos — Compliance Trabalhista",
};

export default async function EstablishmentsPage() {
  const { data: establishments } = await getEstablishments();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Estabelecimentos</h1>
          <p className="text-muted-foreground">
            Gerencie as unidades (CNPJs) da sua organização
          </p>
        </div>
        <CreateEstablishmentDialog />
      </div>

      {establishments.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Building2 className="h-12 w-12 text-muted-foreground/50" />
            <h3 className="mt-4 text-lg font-semibold">Nenhum estabelecimento</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Comece adicionando a matriz da sua empresa.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {establishments.map((est) => (
            <Card key={est.id}>
              <CardHeader className="flex flex-row items-start justify-between pb-2">
                <div className="space-y-1">
                  <CardTitle className="text-base">{est.name}</CardTitle>
                  {est.document_number && (
                    <p className="text-xs text-muted-foreground">
                      CNPJ: {est.document_number}
                    </p>
                  )}
                </div>
                {est.is_headquarters && (
                  <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                    Matriz
                  </span>
                )}
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  {est.address &&
                    typeof est.address === "object" &&
                    "cidade" in (est.address as Record<string, unknown>) && (
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {(est.address as Record<string, string>).cidade}/
                        {(est.address as Record<string, string>).uf}
                      </span>
                    )}
                  <span>{est.employee_count} colaboradores</span>
                  {est.cnae_code && <span>CNAE: {est.cnae_code}</span>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
