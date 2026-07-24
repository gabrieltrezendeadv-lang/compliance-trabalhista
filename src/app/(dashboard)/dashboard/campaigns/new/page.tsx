import { getCampaignTemplates } from "@/lib/campaigns/actions";
import { CampaignCreateForm } from "@/components/campaigns/campaign-create-form";

export const metadata = {
  title: "Nova Campanha — Compliance Trabalhista",
};

export default async function NewCampaignPage() {
  const templatesResult = await getCampaignTemplates();

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

      <CampaignCreateForm templates={templates} />

      <p className="text-xs text-muted-foreground text-center">
        Este relatorio depende de validacao por profissional habilitado.
      </p>
    </div>
  );
}
