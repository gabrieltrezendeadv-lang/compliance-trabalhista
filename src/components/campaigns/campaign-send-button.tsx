"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { prepareCampaignSend } from "@/lib/campaigns/actions";
import type { CampaignStatus } from "@/lib/schemas/campaign";

interface CampaignSendButtonProps {
  campaignId: string;
  status: CampaignStatus;
}

export function CampaignSendButton({
  campaignId,
  status,
}: CampaignSendButtonProps) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status !== "draft" && status !== "scheduled") {
    return null;
  }

  const handleSend = async () => {
    if (
      !confirm(
        "Confirma o envio da campanha? Os destinatários serão resolvidos e as entregas iniciadas."
      )
    ) {
      return;
    }

    setSending(true);
    setError(null);

    const result = await prepareCampaignSend(campaignId);

    setSending(false);

    if (result.error) {
      setError(
        typeof result.error === "string"
          ? result.error
          : "Erro ao enviar campanha"
      );
      return;
    }

    router.refresh();
  };

  return (
    <div>
      <Button onClick={handleSend} disabled={sending} size="sm">
        {sending ? "Preparando..." : "Enviar agora"}
      </Button>
      {error && (
        <p className="mt-1 text-xs text-red-600">{error}</p>
      )}
    </div>
  );
}
