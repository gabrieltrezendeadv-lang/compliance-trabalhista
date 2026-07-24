import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SidebarNav } from "@/components/dashboard/sidebar-nav";
import { UserMenu } from "@/components/dashboard/user-menu";
import { OrgSwitcher } from "@/components/dashboard/org-switcher";
import { Separator } from "@/components/ui/separator";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Fetch profile and current org
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", user.id)
    .single();

  const { data: membership } = await supabase
    .from("organization_members")
    .select("tenant_id, role, organizations(name, slug)")
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .limit(1)
    .single();

  const orgName =
    (membership?.organizations as unknown as { name: string } | null)?.name ??
    "Minha Organização";
  const fullName = profile?.full_name ?? "";
  const email = profile?.email ?? user.email ?? "";

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="hidden w-64 flex-col border-r bg-sidebar-background md:flex">
        <div className="p-4">
          <OrgSwitcher orgName={orgName} />
        </div>
        <Separator />
        <div className="flex-1 overflow-y-auto">
          <SidebarNav />
        </div>
        <Separator />
        <div className="p-4">
          <div className="flex items-center gap-3">
            <UserMenu fullName={fullName} email={email} />
            <div className="flex-1 truncate">
              <p className="truncate text-sm font-medium">{fullName}</p>
              <p className="truncate text-xs text-muted-foreground">{email}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <div className="container mx-auto max-w-5xl px-6 py-8">{children}</div>
      </main>
    </div>
  );
}
