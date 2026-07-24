"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  accessComplaint,
  sendReporterMessage,
} from "@/lib/complaints/actions";
import {
  COMPLAINT_STATUS_LABELS,
  COMPLAINT_STATUS_COLORS,
  CATEGORY_LABELS,
  SEVERITY_LABELS,
} from "@/lib/schemas/complaint";
import type {
  ComplaintStatus,
  ComplaintCategory,
  ComplaintSeverity,
} from "@/lib/schemas/complaint";

export function ComplaintTracker() {
  const [step, setStep] = useState<"auth" | "detail">("auth");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auth form
  const [protocol, setProtocol] = useState("");
  const [pin, setPin] = useState("");

  // Complaint data
  const [complaint, setComplaint] = useState<{
    status: string;
    category: string;
    severity: string;
    is_anonymous: boolean;
    created_at: string;
    updated_at: string;
  } | null>(null);
  const [messages, setMessages] = useState<
    Array<{
      id: string;
      sender_type: string;
      body: string;
      created_at: string;
    }>
  >([]);

  // New message
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);

  const handleAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const result = await accessComplaint({ protocol, pin });

    setLoading(false);

    if (result.error) {
      setError(
        typeof result.error === "string"
          ? result.error
          : "Protocolo ou PIN inválido"
      );
      return;
    }

    setComplaint(result.complaint ?? null);
    setMessages(result.messages ?? []);
    setStep("detail");
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim()) return;

    setSending(true);
    setError(null);

    const result = await sendReporterMessage({
      protocol,
      pin,
      body: newMessage.trim(),
    });

    setSending(false);

    if (result.error) {
      setError(
        typeof result.error === "string"
          ? result.error
          : "Erro ao enviar mensagem"
      );
      return;
    }

    // Re-fetch para atualizar mensagens
    const refreshResult = await accessComplaint({ protocol, pin });
    if (refreshResult.complaint) {
      setComplaint(refreshResult.complaint);
      setMessages(refreshResult.messages ?? []);
    }

    setNewMessage("");
  };

  if (step === "auth") {
    return (
      <form onSubmit={handleAccess} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Acompanhar Denúncia</CardTitle>
            <CardDescription>
              Insira o protocolo e PIN recebidos no momento do registro para
              acessar sua denúncia.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="protocol">Protocolo</Label>
              <Input
                id="protocol"
                value={protocol}
                onChange={(e) =>
                  setProtocol(
                    e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "")
                  )
                }
                placeholder="Ex: A1B2C3D4"
                required
                className="font-mono tracking-widest text-center text-lg"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pin">PIN</Label>
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

            {error && (
              <p className="text-sm text-red-600 text-center">{error}</p>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={loading || protocol.length < 4 || pin.length < 4}
            >
              {loading ? "Verificando..." : "Acessar"}
            </Button>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground text-center">
          Por segurança, não é possível recuperar o PIN. Se você perdeu o
          acesso, registre uma nova denúncia.
        </p>
      </form>
    );
  }

  // Detail view
  const status = (complaint?.status ?? "pending") as ComplaintStatus;
  const category = (complaint?.category ?? "other") as ComplaintCategory;
  const severity = (complaint?.severity ?? "medium") as ComplaintSeverity;
  const isClosed = status === "resolved" || status === "dismissed";

  return (
    <div className="space-y-6">
      {/* Status card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Denúncia #{protocol}</CardTitle>
            <span
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${COMPLAINT_STATUS_COLORS[status]}`}
            >
              {COMPLAINT_STATUS_LABELS[status]}
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3 text-sm">
            <div>
              <p className="text-muted-foreground">Categoria</p>
              <p className="font-medium">{CATEGORY_LABELS[category]}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Gravidade</p>
              <p className="font-medium">{SEVERITY_LABELS[severity]}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Registrada em</p>
              <p className="font-medium">
                {complaint?.created_at
                  ? new Date(complaint.created_at).toLocaleDateString("pt-BR")
                  : "—"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Messages */}
      <Card>
        <CardHeader>
          <CardTitle>Caixa Segura de Mensagens</CardTitle>
          <CardDescription>
            Comunicação bidirecional entre você e os investigadores. Sua
            identidade permanece protegida.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {messages.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Nenhuma mensagem ainda. Os investigadores poderão enviar
              atualizações aqui.
            </p>
          ) : (
            <div className="space-y-3">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`rounded-lg p-3 text-sm ${
                    msg.sender_type === "reporter"
                      ? "bg-primary/5 border border-primary/20 ml-8"
                      : "bg-muted mr-8"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-muted-foreground">
                      {msg.sender_type === "reporter"
                        ? "Você"
                        : "Investigador"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(msg.created_at).toLocaleDateString("pt-BR", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap">{msg.body}</p>
                </div>
              ))}
            </div>
          )}

          {/* Send message */}
          {!isClosed ? (
            <div className="space-y-2 pt-2 border-t">
              <textarea
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="Escreva uma mensagem para os investigadores..."
                rows={3}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
              {error && (
                <p className="text-sm text-red-600">{error}</p>
              )}
              <div className="flex justify-end">
                <Button
                  onClick={handleSendMessage}
                  disabled={sending || !newMessage.trim()}
                  size="sm"
                >
                  {sending ? "Enviando..." : "Enviar mensagem"}
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center pt-2 border-t">
              Esta denúncia foi encerrada. Não é possível enviar novas
              mensagens.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Back button */}
      <div className="flex justify-center">
        <Button
          variant="outline"
          onClick={() => {
            setStep("auth");
            setComplaint(null);
            setMessages([]);
            setError(null);
          }}
        >
          Sair da caixa segura
        </Button>
      </div>

      <p className="text-xs text-muted-foreground text-center">
        Sua sessão não armazena cookies. Ao sair, você precisará informar
        protocolo e PIN novamente.
      </p>
    </div>
  );
}
