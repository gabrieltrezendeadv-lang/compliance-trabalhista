"use client"

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Check } from "lucide-react"
import type { SubscriptionPlan } from "@/lib/billing/actions"

interface PlanCardProps {
  plan: SubscriptionPlan
  isCurrentPlan: boolean
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100)
}

function formatLimit(value: number | null): string {
  return value === null ? "Ilimitado" : String(value)
}

export function PlanCard({ plan, isCurrentPlan }: PlanCardProps) {
  const features = [
    `${formatLimit(plan.limits.maxEstablishments)} estabelecimentos`,
    `${formatLimit(plan.limits.maxDepartments)} departamentos`,
    `${formatLimit(plan.limits.maxMembers)} membros`,
    `${formatLimit(plan.limits.maxCampaignsPerMonth)} campanhas/mês`,
    `${formatLimit(plan.limits.maxAssessmentsPerMonth)} avaliações/mês`,
    plan.limits.evidenceStorageMb
      ? `${plan.limits.evidenceStorageMb} MB armazenamento`
      : "Armazenamento ilimitado",
  ]

  const extras = [
    plan.limits.hasApiAccess && "Acesso à API",
    plan.limits.hasCustomBranding && "Marca personalizada",
    plan.limits.hasPrioritySupport && "Suporte prioritário",
  ].filter(Boolean) as string[]

  return (
    <Card
      className={
        isCurrentPlan
          ? "border-primary ring-1 ring-primary"
          : plan.slug === "professional"
            ? "border-primary/50"
            : ""
      }
    >
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{plan.name}</CardTitle>
          {isCurrentPlan && <Badge>Atual</Badge>}
          {!isCurrentPlan && plan.slug === "professional" && (
            <Badge variant="secondary">Popular</Badge>
          )}
        </div>
        <CardDescription>{plan.description}</CardDescription>
        <div className="pt-2">
          <span className="text-3xl font-bold">
            {formatCurrency(plan.priceMonthly)}
          </span>
          <span className="text-muted-foreground text-sm">/mês</span>
          {plan.priceYearly && (
            <p className="text-xs text-muted-foreground mt-1">
              ou {formatCurrency(plan.priceYearly)}/ano (~17% de desconto)
            </p>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <ul className="space-y-2">
          {features.map((feature) => (
            <li key={feature} className="flex items-center gap-2 text-sm">
              <Check className="h-4 w-4 text-primary shrink-0" />
              {feature}
            </li>
          ))}
          {extras.map((extra) => (
            <li key={extra} className="flex items-center gap-2 text-sm font-medium">
              <Check className="h-4 w-4 text-primary shrink-0" />
              {extra}
            </li>
          ))}
        </ul>
      </CardContent>

      <CardFooter>
        {isCurrentPlan ? (
          <Button variant="outline" className="w-full" disabled>
            Plano Atual
          </Button>
        ) : (
          <Button
            className="w-full"
            variant={plan.slug === "professional" ? "default" : "outline"}
          >
            {plan.slug === "enterprise" ? "Falar com Vendas" : "Assinar"}
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}
