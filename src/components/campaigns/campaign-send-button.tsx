"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { executeCampaignSend } from "@/lib/campaigns/actions";
import type { CampaignStatus } from "@/lib/schemas/campaign";
import { Send, Loader2 } from "lucide-react";

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
  const [result, setResult] = useState<{
    totalSent: number;
    totalFailed: number;
  } | null>(null);

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
    setResult(null);

    const res = await executeCampaignSend(campaignId);

    setSending(false);

    if (res.error) {
      setError(
        typeof res.error === "string"
          ? res.error
          : "Erro ao enviar campanha"
      );
      return;
    }

    setResult({
      totalSent: res.totalSent ?? 0,
      totalFailed: res.totalFailed ?? 0,
    });

    router.refresh();
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        onClick={handleSend}
        disabled={sending}
        size="sm"
        className="gap-2"
      >
        {sending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Enviando...
          </>
        ) : (
          <>
            <Send className="h-4 w-4" />
            Enviar agora
          </>
        )}
      </Button>
      {error && (
        <p className="text-xs text-red-600 max-w-[200px] text-right">
          {error}
        </p>
      )}
      {result && (
        <p className="text-xs text-muted-foreground">
          {result.totalSent} enviado(s)
          {result.totalFailed > 0 && `, ${result.totalFailed} falha(s)`}
        </p>
      )}
    </div>
  );
}
