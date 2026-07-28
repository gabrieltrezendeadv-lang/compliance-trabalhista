import { getEmployees } from "@/lib/employees/actions";
import {
  getDepartments,
  getEstablishments,
} from "@/lib/organizations/actions";
import { EmployeeCreateForm } from "@/components/employees/employee-create-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users } from "lucide-react";

export const metadata = {
  title: "Colaboradores — Compliance Trabalhista",
};

export default async function EmployeesPage() {
  const [{ data: employees }, { data: establishments }, { data: departments }] =
    await Promise.all([
      getEmployees(),
      getEstablishments(),
      getDepartments(),
    ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Colaboradores</h1>
        <p className="text-muted-foreground">
          Cadastre os destinatários que poderão receber campanhas por e-mail ou WhatsApp.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Novo colaborador</CardTitle>
          <CardDescription>
            Este cadastro não concede acesso ao painel e não armazena documentos pessoais.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EmployeeCreateForm
            establishments={establishments.map((item) => ({
              id: item.id,
              name: item.name,
            }))}
            departments={departments.map((item) => ({
              id: item.id,
              name: item.name,
              establishment_id: item.establishment_id,
            }))}
          />
        </CardContent>
      </Card>

      {employees.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-center">
            <Users className="h-12 w-12 text-muted-foreground/50" />
            <h2 className="mt-4 font-semibold">Nenhum colaborador cadastrado</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Cadastre os contatos antes de preparar uma campanha.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {employees.map((employee) => {
            const establishment = Array.isArray(employee.establishments)
              ? employee.establishments[0]
              : employee.establishments;
            const department = Array.isArray(employee.departments)
              ? employee.departments[0]
              : employee.departments;
            return (
              <Card key={employee.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle className="text-base">{employee.full_name}</CardTitle>
                    <Badge variant="secondary">
                      {employee.status === "active" ? "Ativo" : "Inativo"}
                    </Badge>
                  </div>
                  <CardDescription>{employee.job_title || "Cargo não informado"}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-1 text-sm text-muted-foreground">
                  {employee.email && <p>{employee.email}</p>}
                  {employee.phone && <p>{employee.phone}</p>}
                  {(establishment || department) && (
                    <p>
                      {[establishment?.name, department?.name]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
