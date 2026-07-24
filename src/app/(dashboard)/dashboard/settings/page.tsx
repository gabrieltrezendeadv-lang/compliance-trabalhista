import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { IntegrationStatus } from "@/components/settings/integration-status";
import { getIntegrationStatus } from "@/lib/integrations/send-campaign";

export const metadata = {
  title: "Configurações — Compliance Trabalhista",
};

export default async function SettingsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("tenant_id, role, organizations(name, slug, legal_name, document_number, email, plan)")
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .limit(1)
    .single();

  const org = membership?.organizations as unknown as {
    name: string;
    slug: string;
    legal_name: string | null;
    document_number: string | null;
    email: string | null;
    plan: string;
  } | null;

  const integrations = getIntegrationStatus();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Configurações</h1>
        <p className="text-muted-foreground">
          Dados e configurações da sua organização
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Dados da organização</CardTitle>
          <CardDescription>
            Informações básicas do seu cadastro
          </CardDescription>
        </CardHeader>
        <CardContent>
          {org ? (
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-sm font-medium text-muted-foreground">Nome</dt>
                <dd className="mt-1 text-sm">{org.name}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">Slug</dt>
                <dd className="mt-1 text-sm font-mono">{org.slug}</dd>
              </div>
              {org.legal_name && (
                <div>
                  <dt className="text-sm font-medium text-muted-foreground">Razão social</dt>
                  <dd className="mt-1 text-sm">{org.legal_name}</dd>
                </div>
              )}
              {org.document_number && (
                <div>
                  <dt className="text-sm font-medium text-muted-foreground">CNPJ</dt>
                  <dd className="mt-1 text-sm">{org.document_number}</dd>
                </div>
              )}
              {org.email && (
                <div>
                  <dt className="text-sm font-medium text-muted-foreground">E-mail</dt>
                  <dd className="mt-1 text-sm">{org.email}</dd>
                </div>
              )}
              <div>
                <dt className="text-sm font-medium text-muted-foreground">Plano</dt>
                <dd className="mt-1 text-sm capitalize">{org.plan}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">Seu papel</dt>
                <dd className="mt-1 text-sm capitalize">{membership?.role}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nenhuma organização vinculada.
            </p>
          )}
        </CardContent>
      </Card>

      <IntegrationStatus
        email={integrations.email}
        whatsapp={integrations.whatsapp}
      />

      <Card>
        <CardHeader>
          <CardTitle>Variáveis de ambiente necessárias</CardTitle>
          <CardDescription>
            Para ativar provedores reais, configure estas variáveis no servidor
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-sm">
            <div>
              <p className="font-medium text-muted-foreground">E-mail (Resend)</p>
              <code className="mt-1 block rounded bg-muted px-2 py-1 text-xs font-mono">
                RESEND_API_KEY, RESEND_FROM_ADDRESS, RESEND_WEBHOOK_SECRET
              </code>
            </div>
            <div>
              <p className="font-medium text-muted-foreground">WhatsApp (Meta Cloud API)</p>
              <code className="mt-1 block rounded bg-muted px-2 py-1 text-xs font-mono">
                WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN
              </code>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
