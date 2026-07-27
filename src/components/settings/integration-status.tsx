"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Mail, MessageCircle, CheckCircle, XCircle } from "lucide-react";

interface ProviderStatus {
  provider: string;
  configured: boolean;
}

interface IntegrationStatusProps {
  email: ProviderStatus;
  whatsapp: ProviderStatus;
}

const PROVIDER_DISPLAY: Record<
  string,
  { label: string; description: string }
> = {
  resend: {
    label: "Resend",
    description: "Envio de e-mails transacionais via API Resend",
  },
  "whatsapp-cloud": {
    label: "WhatsApp Cloud API",
    description: "Envio via API oficial do WhatsApp (Meta)",
  },
  "not-configured": {
    label: "Canal não configurado",
    description:
      "Configure as variáveis de ambiente do provedor para ativar este canal",
  },
};

export function IntegrationStatus({
  email,
  whatsapp,
}: IntegrationStatusProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Integrações de envio</CardTitle>
        <CardDescription>
          Provedores configurados para envio de campanhas. Configure as
          variáveis de ambiente para ativar os provedores reais.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ProviderRow
          icon={<Mail className="h-5 w-5" />}
          channel="E-mail"
          provider={email}
        />
        <ProviderRow
          icon={<MessageCircle className="h-5 w-5" />}
          channel="WhatsApp"
          provider={whatsapp}
        />
      </CardContent>
    </Card>
  );
}

function ProviderRow({
  icon,
  channel,
  provider,
}: {
  icon: React.ReactNode;
  channel: string;
  provider: ProviderStatus;
}) {
  const display = PROVIDER_DISPLAY[provider.provider] ?? {
    label: provider.provider,
    description: "",
  };

  const isNotConfigured = provider.provider === "not-configured";

  return (
    <div className="flex items-center justify-between rounded-lg border p-4">
      <div className="flex items-center gap-3">
        <div className="text-muted-foreground">{icon}</div>
        <div>
          <p className="text-sm font-medium">
            {channel}:{" "}
            <span
              className={
                isNotConfigured ? "text-destructive" : "text-foreground"
              }
            >
              {display.label}
            </span>
          </p>
          <p className="text-xs text-muted-foreground">
            {display.description}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {provider.configured ? (
          <>
            <CheckCircle className="h-4 w-4 text-green-500" />
            <span className="text-xs font-medium text-green-700">
              Ativo
            </span>
          </>
        ) : (
          <>
            <XCircle className="h-4 w-4 text-destructive" />
            <span className="text-xs font-medium text-destructive">
              Não configurado
            </span>
          </>
        )}
      </div>
    </div>
  );
}
