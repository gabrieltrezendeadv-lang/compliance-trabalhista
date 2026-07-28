import { getCampaignTemplates } from "@/lib/campaigns/actions";
import { CampaignCreateForm } from "@/components/campaigns/campaign-create-form";
import {
  getDepartments,
  getEstablishments,
} from "@/lib/organizations/actions";

export const metadata = {
  title: "Nova Campanha — Compliance Trabalhista",
};

export default async function NewCampaignPage() {
  const [templatesResult, establishmentsResult, departmentsResult] =
    await Promise.all([
      getCampaignTemplates(),
      getEstablishments(),
      getDepartments(),
    ]);

  const templates = (templatesResult.data ?? []).map(
    (t: Record<string, unknown>) => ({
      id: t.id as string,
      name: t.name as string,
      type: t.type as string,
      channel: t.channel as string,
      subject: (t.subject as string) ?? "",
      body_html: null,
      body_text: "",
      legal_basis: (t.legal_basis as string) ?? null,
      requires_acknowledgment: (t.requires_acknowledgment as boolean) ?? false,
    })
  );

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Nova Campanha</h1>
        <p className="text-muted-foreground">
          Crie uma campanha de comunicacao para colaboradores.
        </p>
      </div>

      <CampaignCreateForm
        templates={templates}
        establishments={establishmentsResult.data.map((item) => ({
          id: item.id,
          name: item.name,
        }))}
        departments={departmentsResult.data.map((item) => ({
          id: item.id,
          name: item.name,
        }))}
      />
    </div>
  );
}
