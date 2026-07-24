"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  sendInvestigatorMessage,
  updateComplaintStatus,
} from "@/lib/complaints/actions";
import {
  COMPLAINT_STATUSES,
  COMPLAINT_STATUS_LABELS,
} from "@/lib/schemas/complaint";
import type { ComplaintStatus } from "@/lib/schemas/complaint";

interface ComplaintActionsProps {
  complaintId: string;
  status: ComplaintStatus;
  isInvestigator: boolean;
  isAdmin: boolean;
}

export function ComplaintActions({
  complaintId,
  status,
  isInvestigator,
  isAdmin,
}: ComplaintActionsProps) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isClosed = status === "resolved" || status === "dismissed";

  const handleSendMessage = async () => {
    if (!message.trim()) return;

    setSending(true);
    setError(null);

    const result = await sendInvestigatorMessage(complaintId, message.trim());

    setSending(false);

    if (result.error) {
      setError(
        typeof result.error === "string"
          ? result.error
          : "Erro ao enviar mensagem"
      );
      return;
    }

    setMessage("");
    router.refresh();
  };

  const handleStatusChange = async (newStatus: ComplaintStatus) => {
    setUpdatingStatus(true);
    setError(null);

    const result = await updateComplaintStatus({
      complaint_id: complaintId,
      new_status: newStatus,
    });

    setUpdatingStatus(false);

    if (result.error) {
      setError(
        typeof result.error === "string"
          ? result.error
          : "Erro ao atualizar status"
      );
      return;
    }

    router.refresh();
  };

  return (
    <div className="space-y-4 pt-4 border-t">
      {/* Enviar mensagem (investigador) */}
      {isInvestigator && !isClosed && (
        <div className="space-y-2">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Enviar mensagem ao denunciante..."
            rows={3}
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <div className="flex justify-end">
            <Button
              onClick={handleSendMessage}
              disabled={sending || !message.trim()}
              size="sm"
            >
              {sending ? "Enviando..." : "Enviar mensagem"}
            </Button>
          </div>
        </div>
      )}

      {/* Alterar status (admin) */}
      {isAdmin && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Alterar status</p>
          <div className="flex flex-wrap gap-2">
            {COMPLAINT_STATUSES.filter((s) => s !== status).map((s) => (
              <Button
                key={s}
                variant="outline"
                size="sm"
                onClick={() => handleStatusChange(s)}
                disabled={updatingStatus}
              >
                {COMPLAINT_STATUS_LABELS[s]}
              </Button>
            ))}
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
