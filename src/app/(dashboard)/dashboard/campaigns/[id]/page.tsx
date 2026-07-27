import { notFound } from "next/navigation";
import {
  getCampaign,
  getCampaignStats,
  getCampaignDeliveries,
} from "@/lib/campaigns/actions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  CAMPAIGN_STATUS_LABELS,
  CAMPAIGN_STATUS_COLORS,
  CAMPAIGN_TYPE_LABELS,
  CHANNEL_LABELS,
  DELIVERY_STATUS_LABELS,
  DELIVERY_STATUS_COLORS,
} from "@/lib/schemas/campaign";
import type {
  CampaignStatus,
  CampaignType,
  DeliveryChannel,
  DeliveryStatus,
} from "@/lib/schemas/campaign";
import {
  Users,
  CheckCircle,
  XCircle,
  Clock,
  Mail,
  Eye,
} from "lucide-react";
import { CampaignSendButton } from "@/components/campaigns/campaign-send-button";
import { areChannelsReady } from "@/lib/integrations/registry";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { data } = await getCampaign(id);
  return {
    title: data
      ? `${data.name} — Compliance Trabalhista`
      : "Campanha — Compliance Trabalhista",
  };
}

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [{ data: campaign }, { data: stats }, { data: deliveries }] =
    await Promise.all([
      getCampaign(id),
      getCampaignStats(id),
      getCampaignDeliveries(id),
    ]);

  if (!campaign) {
    notFound();
  }

  const status = campaign.status as CampaignStatus;
  const type = campaign.type as CampaignType;
  const channel = campaign.channel as DeliveryChannel;

  // SEC-BLOCK1: Check if required channels have real providers configured
  const channelStatus = areChannelsReady(channel);
  const missingLabels = channelStatus.missing.map((ch) =>
    ch === "email" ? "E-mail" : "WhatsApp"
  );

  const deliveredCount = (stats?.by_status?.delivered ?? 0) + (stats?.by_status?.read ?? 0);
  const failedCount =
    (stats?.by_status?.failed ?? 0) +
    (stats?.by_status?.bounced ?? 0) +
    (stats?.by_status?.rejected ?? 0);
  const pendingCount =
    (stats?.by_status?.pending ?? 0) +
    (stats?.by_status?.queued ?? 0) +
    (stats?.by_status?.sent ?? 0);

  const deliveryRate =
    stats && stats.total_recipients > 0
      ? ((deliveredCount / stats.total_recipients) * 100).toFixed(1)
      : "0";

  const acknowledgmentRate =
    stats && stats.total_recipients > 0
      ? ((stats.total_acknowledged / stats.total_recipients) * 100).toFixed(1)
      : "0";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {campaign.name}
          </h1>
          <p className="mt-1 text-muted-foreground">
            {CAMPAIGN_TYPE_LABELS[type]} — {CHANNEL_LABELS[channel]}
            {campaign.legal_basis && ` — ${campaign.legal_basis}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-md px-2.5 py-1 text-xs font-medium ${CAMPAIGN_STATUS_COLORS[status]}`}
          >
            {CAMPAIGN_STATUS_LABELS[status]}
          </span>
          {(status === "draft" || status === "scheduled") && (
            <CampaignSendButton
              campaignId={campaign.id}
              status={status}
              channelReady={channelStatus.ready}
              missingChannels={missingLabels}
            />
          )}
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid gap-4 sm:grid-cols-5">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Destinatários
            </CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats?.total_recipients ?? campaign.total_recipients}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Entregues
            </CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {deliveredCount}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Pendentes
            </CardTitle>
            <Clock className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pendingCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Falhas
            </CardTitle>
            <XCircle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {failedCount}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Ciência
            </CardTitle>
            <Eye className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{acknowledgmentRate}%</div>
          </CardContent>
        </Card>
      </div>

      {/* Taxas */}
      {stats && stats.total_recipients > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Taxa de Entrega</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-muted-foreground">Entregues</span>
                  <span className="font-medium">{deliveryRate}%</span>
                </div>
                <div className="h-2 w-full rounded-full bg-muted">
                  <div
                    className="h-2 rounded-full bg-green-500"
                    style={{ width: `${deliveryRate}%` }}
                  />
                </div>
              </div>
              {campaign.requires_acknowledgment && (
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">
                      Confirmaram ciência
                    </span>
                    <span className="font-medium">{acknowledgmentRate}%</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-muted">
                    <div
                      className="h-2 rounded-full bg-blue-500"
                      style={{ width: `${acknowledgmentRate}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Conteúdo */}
      <Card>
        <CardHeader>
          <CardTitle>Conteúdo da Campanha</CardTitle>
          {campaign.sent_at && (
            <CardDescription>
              Conteúdo congelado no momento do envio (imutável).
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <p className="text-sm font-medium text-muted-foreground">
              Assunto
            </p>
            <p className="mt-1 text-sm">{campaign.subject}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">
              Conteúdo
            </p>
            <p className="mt-1 text-sm whitespace-pre-wrap">
              {campaign.body_text}
            </p>
          </div>
          {campaign.description && (
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Descrição interna
              </p>
              <p className="mt-1 text-sm">{campaign.description}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Lista de entregas */}
      <Card>
        <CardHeader>
          <CardTitle>Entregas</CardTitle>
          <CardDescription>
            Rastreamento individual de cada entrega com evidência auditável.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {deliveries.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              {status === "draft" || status === "scheduled"
                ? "As entregas serão geradas quando a campanha for enviada."
                : "Nenhuma entrega registrada."}
            </p>
          ) : (
            <div className="space-y-2">
              {deliveries.map((delivery) => {
                const dStatus = delivery.status as DeliveryStatus;
                const dChannel = delivery.channel as DeliveryChannel;

                return (
                  <div
                    key={delivery.id}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div className="flex items-center gap-3">
                      <Mail className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">
                          {delivery.recipient_name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {delivery.recipient_email ?? "—"} —{" "}
                          {CHANNEL_LABELS[dChannel]}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {delivery.acknowledged && (
                        <span className="rounded-md bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
                          Ciente
                        </span>
                      )}
                      <span
                        className={`rounded-md px-2 py-0.5 text-xs font-medium ${DELIVERY_STATUS_COLORS[dStatus]}`}
                      >
                        {DELIVERY_STATUS_LABELS[dStatus]}
                      </span>
                      {delivery.delivered_at && (
                        <span className="text-xs text-muted-foreground">
                          {new Date(delivery.delivered_at).toLocaleDateString(
                            "pt-BR",
                            {
                              day: "2-digit",
                              month: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            }
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Disclaimer */}
      <p className="text-xs text-muted-foreground text-center">
        Este relatório depende de validação por profissional habilitado.
        Evidências de entrega são registradas automaticamente e podem ser
        exportadas como pacote de compliance.
      </p>
    </div>
  );
}
