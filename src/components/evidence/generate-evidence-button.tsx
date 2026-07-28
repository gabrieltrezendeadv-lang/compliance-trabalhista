"use client";

import { useState } from "react";
import { FileCheck2 } from "lucide-react";
import { generateEvidenceReport } from "@/lib/evidence/actions";
import { Button } from "@/components/ui/button";

type GenerateEvidenceButtonProps = {
  sourceId: string;
  sourceType: "campaign" | "assessment_cycle";
  reportType: "campaign_delivery" | "assessment_result";
  title: string;
};

export function GenerateEvidenceButton({
  sourceId,
  sourceType,
  reportType,
  title,
}: GenerateEvidenceButtonProps) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function generate() {
    setPending(true);
    setMessage(null);

    const formData = new FormData();
    formData.set("source_id", sourceId);
    formData.set("source_type", sourceType);
    formData.set("type", reportType);
    formData.set("title", title);

    const result = await generateEvidenceReport(formData);
    const payload = result.data as
      | { success?: boolean; error?: string }
      | null
      | undefined;

    if (result.error || payload?.success === false) {
      setMessage(result.error ?? payload?.error ?? "Não foi possível gerar a evidência.");
    } else {
      setMessage("Relatório de evidência gerado.");
    }
    setPending(false);
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" variant="outline" onClick={generate} disabled={pending}>
        <FileCheck2 className="mr-2 h-4 w-4" />
        {pending ? "Gerando..." : "Gerar evidência"}
      </Button>
      {message && (
        <span className="max-w-xs text-right text-xs text-muted-foreground" aria-live="polite">
          {message}
        </span>
      )}
    </div>
  );
}
