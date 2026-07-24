import Link from "next/link";
import { getCampaigns } from "@/lib/campaigns/actions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  CAMPAIGN_STATUS_LABELS,
  CAMPAIGN_STATUS_COLORS,
  CAMPAIGN_TYPE_LABELS,
  CHANNEL_LABELS,
} from "@/lib/schemas/campaign";
import type {
  CampaignStatus,
  CampaignType,
  DeliveryChannel,
} from "@/lib/schemas/campaign";
import { Send, Clock, FileText, CheckCircle } from "lucide-react";

export const metadata = {
  title: "Campanhas — Compliance Trabalhista",
};

export default async function CampaignsPage() {
  const { data: campaigns } = await getCampaigns();

  const statusCounts = campaigns.reduce(
    (acc, c) => {
      acc[c.status] = (acc[c.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Campanhas de Compliance
        </h1>
        <p className="text-muted-foreground">
          Comunicações obrigatórias e informativas para colaboradores. Rastreamento
          completo de entregas com evidência auditável.
        </p>
      </div>

      {/* Resumo */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total
            </CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{campaigns.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Rascunhos
            </CardTitle>
            <FileText className="h-4 w-4 text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {statusCounts["draft"] || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Agendadas
            </CardTitle>
            <Clock className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {statusCounts["scheduled"] || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Enviadas
            </CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {(statusCounts["sent"] || 0) + (statusCounts["sending"] || 0)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Lista */}
      <Card>
        <CardHeader>
          <CardTitle>Campanhas</CardTitle>
          <CardDescription>
            Todas as campanhas de comunicação com rastreamento de entregas.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {campaigns.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Send className="h-12 w-12 text-muted-foreground/50" />
              <h3 className="mt-4 text-lg font-semibold">
                Nenhuma campanha criada
              </h3>
              <p className="mt-2 text-sm text-muted-foreground max-w-sm">
                Crie campanhas para comunicar resultados de avaliações,
                divulgar o canal de denúncias e cumprir obrigações legais.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {campaigns.map((campaign) => {
                const status = campaign.status as CampaignStatus;
                const type = campaign.type as CampaignType;
                const channel = campaign.channel as DeliveryChannel;

                return (
                  <Link
                    key={campaign.id}
                    href={`/dashboard/campaigns/${campaign.id}`}
                    className="block"
                  >
                    <div className="flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">
                            {campaign.name}
                          </span>
                          <span
                            className={`rounded-md px-2 py-0.5 text-xs font-medium ${CAMPAIGN_STATUS_COLORS[status]}`}
                          >
                            {CAMPAIGN_STATUS_LABELS[status]}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {CAMPAIGN_TYPE_LABELS[type]} — {CHANNEL_LABELS[channel]}
                          {campaign.legal_basis && (
                            <span className="ml-2 text-xs">
                              ({campaign.legal_basis})
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        {campaign.total_recipients > 0 && (
                          <span>{campaign.total_recipients} destinatários</span>
                        )}
                        <span>
                          {campaign.sent_at
                            ? `Enviada ${new Date(campaign.sent_at).toLocaleDateString("pt-BR")}`
                            : campaign.scheduled_at
                              ? `Agendada ${new Date(campaign.scheduled_at).toLocaleDateString("pt-BR")}`
                              : new Date(campaign.created_at).toLocaleDateString("pt-BR")}
                        </span>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground text-center">
        Este relatório depende de validação por profissional habilitado.
        Evidências de entrega são registradas automaticamente para fins de
        compliance.
      </p>
    </div>
  );
}
