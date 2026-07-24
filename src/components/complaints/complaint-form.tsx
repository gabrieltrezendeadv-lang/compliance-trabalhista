"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitComplaint } from "@/lib/complaints/actions";
import {
  CATEGORY_LABELS,
  COMPLAINT_CATEGORIES,
} from "@/lib/schemas/complaint";
import type { ComplaintCategory } from "@/lib/schemas/complaint";

interface ComplaintFormProps {
  tenantSlug: string;
  tenantName: string;
}

export function ComplaintForm({ tenantSlug, tenantName }: ComplaintFormProps) {
  const [step, setStep] = useState<"form" | "success">("form");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [protocol, setProtocol] = useState<string | null>(null);

  // Form state
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<ComplaintCategory>("other");
  const [isAnonymous, setIsAnonymous] = useState(true);
  const [reporterName, setReporterName] = useState("");
  const [reporterEmail, setReporterEmail] = useState("");
  const [reporterPhone, setReporterPhone] = useState("");
  const [establishmentName, setEstablishmentName] = useState("");
  const [departmentName, setDepartmentName] = useState("");
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (pin !== pinConfirm) {
      setError("Os PINs não coincidem.");
      return;
    }

    setSubmitting(true);

    const result = await submitComplaint({
      tenant_slug: tenantSlug,
      subject,
      description,
      category,
      is_anonymous: isAnonymous,
      reporter_name: isAnonymous ? undefined : reporterName,
      reporter_email: isAnonymous ? undefined : reporterEmail,
      reporter_phone: isAnonymous ? undefined : reporterPhone,
      establishment_name: establishmentName || undefined,
      department_name: departmentName || undefined,
      pin,
    });

    setSubmitting(false);

    if (result.error) {
      setError(
        typeof result.error === "string"
          ? result.error
          : "Erro ao enviar denúncia. Verifique os campos e tente novamente."
      );
      return;
    }

    setProtocol(result.protocol ?? null);
    setStep("success");
  };

  if (step === "success") {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <div className="rounded-full bg-green-100 p-3">
            <svg
              className="h-8 w-8 text-green-600"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4.5 12.75l6 6 9-13.5"
              />
            </svg>
          </div>
          <h3 className="mt-4 text-lg font-semibold">
            Denúncia registrada com sucesso
          </h3>
          <div className="mt-4 rounded-lg bg-blue-50 p-4 text-left max-w-sm w-full">
            <p className="text-sm font-medium text-blue-900">
              Seu protocolo de acompanhamento:
            </p>
            <p className="mt-1 text-2xl font-mono font-bold text-blue-700 tracking-widest text-center">
              {protocol}
            </p>
            <p className="mt-3 text-xs text-blue-800">
              Guarde este protocolo junto com seu PIN. Você precisará de ambos
              para acompanhar sua denúncia e receber respostas.
            </p>
          </div>
          <p className="mt-4 text-sm text-muted-foreground max-w-md">
            Sua denúncia será analisada pela equipe responsável. Acompanhe o
            andamento através da página de acompanhamento usando seu protocolo e
            PIN.
          </p>
          <Button
            className="mt-6"
            variant="outline"
            onClick={() => {
              window.location.href = `/report/track`;
            }}
          >
            Acompanhar denúncia
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Nova Denúncia</CardTitle>
          <CardDescription>
            Canal seguro de denúncias — {tenantName}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Categoria */}
          <div className="space-y-2">
            <Label htmlFor="category">Categoria da denúncia</Label>
            <select
              id="category"
              value={category}
              onChange={(e) => setCategory(e.target.value as ComplaintCategory)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              {COMPLAINT_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {CATEGORY_LABELS[cat]}
                </option>
              ))}
            </select>
          </div>

          {/* Assunto */}
          <div className="space-y-2">
            <Label htmlFor="subject">
              Assunto <span className="text-red-500">*</span>
            </Label>
            <Input
              id="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Breve descrição do ocorrido"
              required
              minLength={5}
            />
          </div>

          {/* Descrição */}
          <div className="space-y-2">
            <Label htmlFor="description">
              Relato detalhado <span className="text-red-500">*</span>
            </Label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descreva o ocorrido com o máximo de detalhes possível: o quê, quando, onde, quem esteve envolvido, se há testemunhas..."
              required
              minLength={10}
              rows={6}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>

          {/* Localização */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="establishment">Estabelecimento (opcional)</Label>
              <Input
                id="establishment"
                value={establishmentName}
                onChange={(e) => setEstablishmentName(e.target.value)}
                placeholder="Ex: Matriz São Paulo"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="department">Departamento (opcional)</Label>
              <Input
                id="department"
                value={departmentName}
                onChange={(e) => setDepartmentName(e.target.value)}
                placeholder="Ex: Recursos Humanos"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Identificação */}
      <Card>
        <CardHeader>
          <CardTitle>Identificação</CardTitle>
          <CardDescription>
            Você pode optar por se identificar ou permanecer anônimo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4">
            <button
              type="button"
              onClick={() => setIsAnonymous(true)}
              className={`flex-1 rounded-lg border p-4 text-sm text-left transition-colors ${
                isAnonymous
                  ? "border-primary bg-primary/5 font-medium"
                  : "border-input hover:border-primary/50"
              }`}
            >
              <span className="font-medium">Anônimo</span>
              <p className="mt-1 text-xs text-muted-foreground">
                Nenhum dado de identificação será registrado.
              </p>
            </button>
            <button
              type="button"
              onClick={() => setIsAnonymous(false)}
              className={`flex-1 rounded-lg border p-4 text-sm text-left transition-colors ${
                !isAnonymous
                  ? "border-primary bg-primary/5 font-medium"
                  : "border-input hover:border-primary/50"
              }`}
            >
              <span className="font-medium">Identificado</span>
              <p className="mt-1 text-xs text-muted-foreground">
                Seus dados serão visíveis apenas para investigadores do caso.
              </p>
            </button>
          </div>

          {!isAnonymous && (
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label htmlFor="reporter_name">Nome</Label>
                <Input
                  id="reporter_name"
                  value={reporterName}
                  onChange={(e) => setReporterName(e.target.value)}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="reporter_email">E-mail</Label>
                  <Input
                    id="reporter_email"
                    type="email"
                    value={reporterEmail}
                    onChange={(e) => setReporterEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reporter_phone">Telefone</Label>
                  <Input
                    id="reporter_phone"
                    value={reporterPhone}
                    onChange={(e) => setReporterPhone(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* PIN de acesso */}
      <Card>
        <CardHeader>
          <CardTitle>PIN de Acesso</CardTitle>
          <CardDescription>
            Crie um PIN numérico (4 a 8 dígitos) para acompanhar sua denúncia e
            receber respostas. Guarde-o com segurança — não é possível
            recuperá-lo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="pin">
                PIN <span className="text-red-500">*</span>
              </Label>
              <Input
                id="pin"
                type="password"
                inputMode="numeric"
                maxLength={8}
                value={pin}
                onChange={(e) =>
                  setPin(e.target.value.replace(/\D/g, "").slice(0, 8))
                }
                placeholder="••••"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pin_confirm">
                Confirmar PIN <span className="text-red-500">*</span>
              </Label>
              <Input
                id="pin_confirm"
                type="password"
                inputMode="numeric"
                maxLength={8}
                value={pinConfirm}
                onChange={(e) =>
                  setPinConfirm(e.target.value.replace(/\D/g, "").slice(0, 8))
                }
                placeholder="••••"
                required
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Erro */}
      {error && (
        <p className="text-sm text-red-600 text-center">{error}</p>
      )}

      {/* Submit */}
      <Button
        type="submit"
        className="w-full"
        size="lg"
        disabled={
          submitting ||
          subject.length < 5 ||
          description.length < 10 ||
          pin.length < 4 ||
          pin !== pinConfirm
        }
      >
        {submitting ? "Enviando..." : "Registrar denúncia"}
      </Button>

      {/* Avisos */}
      <div className="space-y-2 text-center">
        <p className="text-xs text-muted-foreground">
          {isAnonymous
            ? "Sua denúncia é completamente anônima. Nenhum dado de identificação (nome, e-mail, IP, cookies) é registrado pelo sistema."
            : "Seus dados de identificação serão visíveis apenas para os investigadores designados ao caso, nunca para gestores ou administradores."}
        </p>
        <p className="text-xs text-muted-foreground">
          Este canal atende aos requisitos da Lei 14.457/2022 (CIPA) e boas
          práticas de compliance trabalhista.
        </p>
      </div>
    </form>
  );
}
