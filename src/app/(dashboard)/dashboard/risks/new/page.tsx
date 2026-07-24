import { getEstablishments, getDepartments } from "@/lib/organizations/actions";
import { RiskCreateForm } from "@/components/risks/risk-create-form";

export const metadata = {
  title: "Novo Risco — Compliance Trabalhista",
};

export default async function NewRiskPage() {
  const [establishmentsResult, departmentsResult] = await Promise.all([
    getEstablishments(),
    getDepartments(),
  ]);

  const establishments = (establishmentsResult.data ?? []).map(
    (e: Record<string, unknown>) => ({
      id: e.id as string,
      name: e.name as string,
    })
  );

  const departments = (departmentsResult.data ?? []).map(
    (d: Record<string, unknown>) => ({
      id: d.id as string,
      name: d.name as string,
      establishment_id: d.establishment_id as string,
    })
  );

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Novo Risco</h1>
        <p className="text-muted-foreground">
          Registre um novo item no inventario de riscos.
        </p>
      </div>

      <RiskCreateForm
        establishments={establishments}
        departments={departments}
      />

      <p className="text-xs text-muted-foreground text-center">
        Este relatorio depende de validacao por profissional habilitado.
      </p>
    </div>
  );
}
