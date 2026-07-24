import { getDepartments } from "@/lib/organizations/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FolderTree, Plus, Users } from "lucide-react";

export const metadata = {
  title: "Departamentos — Compliance Trabalhista",
};

export default async function DepartmentsPage() {
  const { data: departments } = await getDepartments();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Departamentos</h1>
          <p className="text-muted-foreground">
            Gerencie os departamentos e setores dos seus estabelecimentos
          </p>
        </div>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Novo departamento
        </Button>
      </div>

      {departments.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <FolderTree className="h-12 w-12 text-muted-foreground/50" />
            <h3 className="mt-4 text-lg font-semibold">Nenhum departamento</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Adicione departamentos aos seus estabelecimentos para organizar a avaliação.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {departments.map((dept) => {
            const establishmentName =
              dept.establishments &&
              typeof dept.establishments === "object" &&
              "name" in (dept.establishments as Record<string, unknown>)
                ? (dept.establishments as { name: string }).name
                : "";

            return (
              <Card key={dept.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{dept.name}</CardTitle>
                  {dept.code && (
                    <p className="text-xs text-muted-foreground">
                      Código: {dept.code}
                    </p>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="space-y-1 text-sm text-muted-foreground">
                    {establishmentName && <p>{establishmentName}</p>}
                    <p className="flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      {dept.employee_count} colaboradores
                    </p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
