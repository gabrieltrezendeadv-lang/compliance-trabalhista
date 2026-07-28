"use client";

import * as React from "react";
import { Mail, MessageCircle } from "lucide-react";
import { sendAssessmentInvitations } from "@/lib/assessments/actions";
import { Button } from "@/components/ui/button";

export function SendAssessmentInvitations({
  disabled = false,
}: {
  disabled?: boolean;
}) {
  const [pending, setPending] = React.useState<"email" | "whatsapp" | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);

  async function send(channel: "email" | "whatsapp") {
    const cycleId = window.location.pathname.split("/").pop();
    if (!cycleId) return;
    if (
      !window.confirm(
        `Enviar convites por ${channel === "email" ? "e-mail" : "WhatsApp"} para todos os colaboradores ativos ainda não convidados?`
      )
    ) {
      return;
    }

    setPending(channel);
    setMessage(null);
    const result = await sendAssessmentInvitations(cycleId, channel);
    if (result.error) {
      setMessage(result.error);
    } else {
      setMessage(
        `${result.sent ?? 0} enviado(s), ${result.skipped ?? 0} já enviado(s), ${result.failed ?? 0} falha(s).`
      );
    }
    setPending(null);
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button
        type="button"
        variant="outline"
        disabled={disabled || pending !== null}
        onClick={() => send("email")}
      >
        <Mail className="mr-2 h-4 w-4" />
        {pending === "email" ? "Enviando..." : "Convidar por e-mail"}
      </Button>
      <Button
        type="button"
        variant="outline"
        disabled={disabled || pending !== null}
        onClick={() => send("whatsapp")}
      >
        <MessageCircle className="mr-2 h-4 w-4" />
        {pending === "whatsapp" ? "Enviando..." : "Convidar por WhatsApp"}
      </Button>
      {message && (
        <p className="basis-full text-right text-xs text-muted-foreground">
          {message}
        </p>
      )}
    </div>
  );
}
