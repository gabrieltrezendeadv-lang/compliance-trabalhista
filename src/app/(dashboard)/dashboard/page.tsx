import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MapPin, FolderTree, Users } from "lucide-react";

export const metadata = {
  title: "Painel — Compliance Trabalhista",
};

export default async function DashboardPage() {
  const supabase = await createClient();

  // Fetch counts for the current org
  const [
    { count: establishmentCount },
    { count: departmentCount },
    { count: memberCount },
  ] = await Promise.all([
    supabase
      .from("establishments")
      .select("*", { count: "exact", head: true })
      .is("deleted_at", null),
    supabase
      .from("departments")
      .select("*", { count: "exact", head: true })
      .is("deleted_at", null),
    supabase
      .from("organization_members")
      .select("*", { count: "exact", head: true })
      .is("deleted_at", null),
  ]);

  const stats = [
    {
      title: "Estabelecimentos",
      value: establishmentCount ?? 0,
      icon: MapPin,
    },
    {
      title: "Departamentos",
      value: departmentCount ?? 0,
      icon: FolderTree,
    },
    {
      title: "Membros",
      value: memberCount ?? 0,
      icon: Users,
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Painel</h1>
        <p className="text-muted-foreground">
          Visão geral da sua organização
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {stats.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.title}
              </CardTitle>
              <stat.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
