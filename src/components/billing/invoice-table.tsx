"use client"

import { Badge } from "@/components/ui/badge"
import { ExternalLink } from "lucide-react"

interface Invoice {
  id: string
  status: string
  amount: number
  dueDate: string
  paidAt: string | null
  externalPaymentLink: string | null
  description: string | null
}

interface InvoiceTableProps {
  invoices: Invoice[]
}

const STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "Pendente", variant: "secondary" },
  paid: { label: "Pago", variant: "default" },
  overdue: { label: "Vencida", variant: "destructive" },
  cancelled: { label: "Cancelada", variant: "outline" },
  refunded: { label: "Estornada", variant: "outline" },
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100)
}

function formatDate(str: string): string {
  return new Date(str + "T00:00:00").toLocaleDateString("pt-BR")
}

export function InvoiceTable({ invoices }: InvoiceTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="pb-2 font-medium">Vencimento</th>
            <th className="pb-2 font-medium">Descrição</th>
            <th className="pb-2 font-medium text-right">Valor</th>
            <th className="pb-2 font-medium text-center">Status</th>
            <th className="pb-2 font-medium text-center">Pago em</th>
            <th className="pb-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => {
            const statusInfo = STATUS_MAP[inv.status] ?? {
              label: inv.status,
              variant: "outline" as const,
            }
            return (
              <tr key={inv.id} className="border-b last:border-0">
                <td className="py-3">{formatDate(inv.dueDate)}</td>
                <td className="py-3 text-muted-foreground">
                  {inv.description ?? "Assinatura"}
                </td>
                <td className="py-3 text-right font-medium">
                  {formatCurrency(inv.amount)}
                </td>
                <td className="py-3 text-center">
                  <Badge variant={statusInfo.variant}>
                    {statusInfo.label}
                  </Badge>
                </td>
                <td className="py-3 text-center text-muted-foreground">
                  {inv.paidAt
                    ? new Date(inv.paidAt).toLocaleDateString("pt-BR")
                    : "—"}
                </td>
                <td className="py-3 text-center">
                  {inv.externalPaymentLink && inv.status === "pending" && (
                    <a
                      href={inv.externalPaymentLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline text-xs"
                    >
                      Pagar <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
