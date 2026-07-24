"use client"

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import type { TenantSubscription } from "@/lib/billing/actions"

interface CurrentPlanCardProps {
  subscription: TenantSubscription
}

const STATUS_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  trialing: { label: "Teste", variant: "secondary" },
  active: { label: "Ativo", variant: "default" },
  past_due: { label: "Pagamento pendente", variant: "destructive" },
  grace_period: { label: "Carência", variant: "destructive" },
  partially_blocked: { label: "Parcialmente bloqueado", variant: "destructive" },
  fully_blocked: { label: "Bloqueado", variant: "destructive" },
  cancelled: { label: "Cancelado", variant: "outline" },
}

const CYCLE_LABELS: Record<string, string> = {
  monthly: "Mensal",
  yearly: "Anual",
}

const PAYMENT_LABELS: Record<string, string> = {
  boleto: "Boleto",
  pix: "PIX",
  credit_card: "Cartão de Crédito",
}

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("pt-BR")
}

export function CurrentPlanCard({ subscription }: CurrentPlanCardProps) {
  const statusInfo = STATUS_LABELS[subscription.status] ?? {
    label: subscription.status,
    variant: "outline" as const,
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Plano Atual: {subscription.planName}</CardTitle>
          <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-sm text-muted-foreground">Ciclo</p>
            <p className="font-medium">
              {CYCLE_LABELS[subscription.billingCycle] ?? subscription.billingCycle}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Pagamento</p>
            <p className="font-medium">
              {subscription.paymentMethod
                ? PAYMENT_LABELS[subscription.paymentMethod] ?? subscription.paymentMethod
                : "Não configurado"}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Período atual</p>
            <p className="font-medium">
              {formatDate(subscription.currentPeriodStart)} —{" "}
              {formatDate(subscription.currentPeriodEnd)}
            </p>
          </div>
          {subscription.trialEndsAt && (
            <div>
              <p className="text-sm text-muted-foreground">Teste até</p>
              <p className="font-medium">
                {formatDate(subscription.trialEndsAt)}
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
