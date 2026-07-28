"use client";

import { useRef, useState } from "react";
import { createEvidencePackage } from "@/lib/evidence/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function PackageCreateForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(formData: FormData) {
    setPending(true);
    setMessage(null);

    const start = formData.get("period_start");
    const end = formData.get("period_end");
    if (typeof start === "string") {
      formData.set("period_start", new Date(`${start}T00:00:00`).toISOString());
    }
    if (typeof end === "string") {
      formData.set("period_end", new Date(`${end}T23:59:59`).toISOString());
    }

    const result = await createEvidencePackage(formData);
    if (result.error) {
      setMessage(result.error);
    } else {
      setMessage("Pacote criado. Agora adicione os relatórios e sele o pacote.");
      formRef.current?.reset();
    }
    setPending(false);
  }

  return (
    <form ref={formRef} action={submit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="package-name">Nome</Label>
        <Input
          id="package-name"
          name="name"
          minLength={3}
          maxLength={300}
          required
          placeholder="Ex.: Evidências do ciclo semestral"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="package-description">Descrição</Label>
        <Textarea
          id="package-description"
          name="description"
          maxLength={2000}
          placeholder="Explique quais evidências compõem este pacote."
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="period-start">Início do período</Label>
          <Input id="period-start" name="period_start" type="date" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="period-end">Fim do período</Label>
          <Input id="period-end" name="period_end" type="date" required />
        </div>
      </div>
      {message && (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {message}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Criando..." : "Criar pacote"}
      </Button>
    </form>
  );
}
