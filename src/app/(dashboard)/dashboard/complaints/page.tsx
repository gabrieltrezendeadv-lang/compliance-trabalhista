import Link from "next/link";
import { getComplaints } from "@/lib/complaints/actions";
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
import { MessageSquare, Users, AlertTriangle, Shield } from "lucide-react";

export const metadata = {
  title: "Canal de Denúncias — Compliance Trabalhista",
};

export default async function ComplaintsPage() {
  const { data: complaints, total } = await getComplaints();

  // Contadores por status
  const statusCounts = complaints.reduce(
    (acc, c) => {
      acc[c.status] = (acc[c.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const pendingCount = (statusCounts["pending"] || 0) + (statusCounts["under_review"] || 0);
  const investigatingCount = statusCounts["investigating"] || 0;
  const resolvedCount = (statusCounts["resolved"] || 0) + (statusCounts["dismissed"] || 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Canal de Denúncias
        </h1>
        <p className="text-muted-foreground">
          Gestão de denúncias recebidas. O conteúdo das denúncias é acessível
          apenas aos investigadores designados.
        </p>
      </div>

      {/* Resumo */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total
            </CardTitle>
            <Shield className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Pendentes
            </CardTitle>
            <AlertTriangle className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pendingCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Em investigação
            </CardTitle>
            <Users className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{investigatingCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Resolvidas
            </CardTitle>
            <MessageSquare className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{resolvedCount}</div>
          </CardContent>
        </Card>
      </div>

      {/* Lista */}
      <Card>
        <CardHeader>
          <CardTitle>Denúncias Recebidas</CardTitle>
          <CardDescription>
            Metadados das denúncias. O conteúdo completo é visível apenas para
            investigadores designados ao caso.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {complaints.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Shield className="h-12 w-12 text-muted-foreground/50" />
              <h3 className="mt-4 text-lg font-semibold">
                Nenhuma denúncia recebida
              </h3>
              <p className="mt-2 text-sm text-muted-foreground max-w-sm">
                As denúncias registradas pelo canal anônimo aparecerão aqui.
                Compartilhe o link do canal com seus colaboradores.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {complaints.map((complaint) => {
                const status = complaint.status as ComplaintStatus;
                const category = complaint.category as ComplaintCategory;
                const severity = complaint.severity as ComplaintSeverity;

                return (
                  <Link
                    key={complaint.id}
                    href={`/dashboard/complaints/${complaint.id}`}
                    className="block"
                  >
                    <div className="flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-medium">
                            #{complaint.protocol}
                          </span>
                          <span
                            className={`rounded-md px-2 py-0.5 text-xs font-medium ${COMPLAINT_STATUS_COLORS[status]}`}
                          >
                            {COMPLAINT_STATUS_LABELS[status]}
                          </span>
                          <span
                            className={`rounded-md px-2 py-0.5 text-xs font-medium ${SEVERITY_COLORS[severity]}`}
                          >
                            {SEVERITY_LABELS[severity]}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {CATEGORY_LABELS[category]}
                          {complaint.is_anonymous ? " — Anônima" : " — Identificada"}
                        </p>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        {complaint.investigator_count > 0 && (
                          <span className="flex items-center gap-1">
                            <Users className="h-3.5 w-3.5" />
                            {complaint.investigator_count}
                          </span>
                        )}
                        {complaint.message_count > 0 && (
                          <span className="flex items-center gap-1">
                            <MessageSquare className="h-3.5 w-3.5" />
                            {complaint.message_count}
                          </span>
                        )}
                        <span>
                          {new Date(complaint.created_at).toLocaleDateString(
                            "pt-BR"
                          )}
                        </span>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Aviso de compliance */}
      <p className="text-xs text-muted-foreground text-center">
        Este relatório depende de validação por profissional habilitado. O
        conteúdo das denúncias é acessível apenas por investigadores designados,
        em conformidade com a Lei 14.457/2022 e boas práticas de compliance.
      </p>
    </div>
  );
}
