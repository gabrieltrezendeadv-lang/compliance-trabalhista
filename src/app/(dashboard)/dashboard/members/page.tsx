import { getMembers } from "@/lib/organizations/actions";
import { ROLE_LABELS, type AppRole } from "@/lib/schemas/organization";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Plus, Users } from "lucide-react";

export const metadata = {
  title: "Membros — Compliance Trabalhista",
};

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default async function MembersPage() {
  const { data: members } = await getMembers();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Membros</h1>
          <p className="text-muted-foreground">
            Gerencie os usuários e papéis da sua organização
          </p>
        </div>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Convidar membro
        </Button>
      </div>

      {members.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Users className="h-12 w-12 text-muted-foreground/50" />
            <h3 className="mt-4 text-lg font-semibold">Nenhum membro</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Convide membros da sua equipe para começar.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y">
              {members.map((member) => {
                const profile = member.profiles as {
                  full_name: string;
                  email: string;
                  avatar_url: string | null;
                } | null;

                const name = profile?.full_name ?? "";
                const email = profile?.email ?? "";
                const role = member.role as AppRole;

                return (
                  <div
                    key={member.id}
                    className="flex items-center gap-4 px-6 py-4"
                  >
                    <Avatar className="h-9 w-9">
                      <AvatarFallback className="text-xs">
                        {getInitials(name || email)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm font-medium">{name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {email}
                      </p>
                    </div>
                    <span className="rounded-md bg-secondary px-2.5 py-0.5 text-xs font-medium">
                      {ROLE_LABELS[role] ?? role}
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
