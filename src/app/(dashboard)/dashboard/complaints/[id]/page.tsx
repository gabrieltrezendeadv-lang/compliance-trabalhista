import { notFound } from "next/navigation";
import { getComplaintDetail } from "@/lib/complaints/actions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  COMPLAINT_STATUS_LABELS,
  COMPLAINT_STATUS_COLORS,
  CATEGORY_LABELS,
  SEVERITY_LABELS,
  SEVERITY_COLORS,
} from "@/lib/schemas/complaint";
import type {
  ComplaintStatus,
  ComplaintCategory,
  ComplaintSeverity,
} from "@/lib/schemas/complaint";
import { Lock, MessageSquare, Users, Shield, Clock } from "lucide-react";
import { ComplaintActions } from "@/components/complaints/complaint-actions";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { data } = await getComplaintDetail(id);
  return {
    title: data
      ? `Denúncia #${data.complaint.protocol} — Compliance Trabalhista`
      : "Denúncia — Compliance Trabalhista",
  };
}

export default async function ComplaintDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { data, error } = await getComplaintDetail(id);

  if (!data || error) {
    notFound();
  }

  const status = data.complaint.status as ComplaintStatus;
  const category = data.complaint.category as ComplaintCategory;
  const severity = data.complaint.severity as ComplaintSeverity;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Denúncia #{data.complaint.protocol}
          </h1>
          <p className="mt-1 text-muted-foreground">
            {CATEGORY_LABELS[category]} —{" "}
            {data.complaint.is_anonymous ? "Anônima" : "Identificada"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-md px-2.5 py-1 text-xs font-medium ${SEVERITY_COLORS[severity]}`}
          >
            {SEVERITY_LABELS[severity]}
          </span>
          <span
            className={`rounded-md px-2.5 py-1 text-xs font-medium ${COMPLAINT_STATUS_COLORS[status]}`}
          >
            {COMPLAINT_STATUS_LABELS[status]}
          </span>
        </div>
      </div>

      {/* Metadata */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Registrada em
            </CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-sm font-medium">
              {new Date(data.complaint.created_at).toLocaleDateString("pt-BR", {
                day: "2-digit",
                month: "long",
                year: "numeric",
              })}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Investigadores
            </CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {data.investigators.filter((i) => !i.removed_at).length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Mensagens
            </CardTitle>
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {data.messages?.length ?? 0}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Conteúdo protegido */}
      {data.is_investigator && data.content ? (
        <Card>
          <CardHeader>
            <CardTitle>Conteúdo da Denúncia</CardTitle>
            <CardDescription>
              Visível apenas para investigadores designados a este caso.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Assunto
              </p>
              <p className="mt-1 text-sm font-medium">{data.content.subject}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Relato
              </p>
              <p className="mt-1 text-sm whitespace-pre-wrap">
                {data.content.description}
              </p>
            </div>

            {(data.content.establishment_name || data.content.department_name) && (
              <div className="grid gap-4 sm:grid-cols-2">
                {data.content.establishment_name && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      Estabelecimento
                    </p>
                    <p className="mt-1 text-sm">
                      {data.content.establishment_name}
                    </p>
                  </div>
                )}
                {data.content.department_name && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      Departamento
                    </p>
                    <p className="mt-1 text-sm">
                      {data.content.department_name}
                    </p>
                  </div>
                )}
              </div>
            )}

            {!data.complaint.is_anonymous &&
              (data.content.reporter_name ||
                data.content.reporter_email ||
                data.content.reporter_phone) && (
                <div className="rounded-lg border border-dashed p-4">
                  <p className="text-sm font-medium mb-2">
                    Dados do denunciante (identificado)
                  </p>
                  <div className="grid gap-2 sm:grid-cols-3 text-sm">
                    {data.content.reporter_name && (
                      <div>
                        <span className="text-muted-foreground">Nome: </span>
                        {data.content.reporter_name}
                      </div>
                    )}
                    {data.content.reporter_email && (
                      <div>
                        <span className="text-muted-foreground">E-mail: </span>
                        {data.content.reporter_email}
                      </div>
                    )}
                    {data.content.reporter_phone && (
                      <div>
                        <span className="text-muted-foreground">
                          Telefone:{" "}
                        </span>
                        {data.content.reporter_phone}
                      </div>
                    )}
                  </div>
                </div>
              )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex items-center gap-3 py-6">
            <Lock className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Conteúdo protegido</p>
              <p className="text-xs text-muted-foreground">
                O conteúdo desta denúncia é visível apenas para investigadores
                designados ao caso. Solicite acesso ao administrador se
                necessário.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Mensagens (apenas para investigadores) */}
      {data.is_investigator && data.messages && (
        <Card>
          <CardHeader>
            <CardTitle>Mensagens</CardTitle>
            <CardDescription>
              Comunicação com o denunciante via caixa segura.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.messages.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                Nenhuma mensagem trocada ainda.
              </p>
            ) : (
              data.messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`rounded-lg p-3 text-sm ${
                    msg.sender_type === "reporter"
                      ? "bg-muted mr-8"
                      : "bg-primary/5 border border-primary/20 ml-8"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-muted-foreground">
                      {msg.sender_type === "reporter"
                        ? "Denunciante"
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
              ))
            )}

            {/* Ação de enviar mensagem como investigador */}
            <ComplaintActions
              complaintId={data.complaint.id}
              status={status}
              isInvestigator={data.is_investigator}
              isAdmin={data.is_admin}
            />
          </CardContent>
        </Card>
      )}

      {/* Investigadores */}
      <Card>
        <CardHeader>
          <CardTitle>Investigadores Designados</CardTitle>
        </CardHeader>
        <CardContent>
          {data.investigators.filter((i) => !i.removed_at).length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Nenhum investigador designado ainda.
            </p>
          ) : (
            <div className="space-y-2">
              {data.investigators
                .filter((i) => !i.removed_at)
                .map((inv) => (
                  <div
                    key={inv.id}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div className="flex items-center gap-2">
                      <Shield className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium">
                        {inv.name ?? "Investigador"}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      Desde{" "}
                      {new Date(inv.assigned_at).toLocaleDateString("pt-BR")}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Disclaimer */}
      <p className="text-xs text-muted-foreground text-center">
        Este relatório depende de validação por profissional habilitado.
        Respostas individuais e dados de identificação do denunciante não são
        acessíveis por administradores do sistema.
      </p>
    </div>
  );
}
