import {
  getSubscriptionPlans,
  getCurrentSubscription,
  getInvoices,
} from "@/lib/billing/actions"
import { getSubscriptionWarning } from "@/lib/billing/guard"
import { SubscriptionWarning } from "@/components/billing/subscription-warning"
import { PlanCard } from "@/components/billing/plan-card"
import { CurrentPlanCard } from "@/components/billing/current-plan-card"
import { InvoiceTable } from "@/components/billing/invoice-table"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export default async function BillingPage() {
  const [
    { data: plans },
    { data: subscription },
    { data: invoices },
    warning,
  ] = await Promise.all([
    getSubscriptionPlans(),
    getCurrentSubscription(),
    getInvoices(),
    getSubscriptionWarning(),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Assinatura e Billing
        </h1>
        <p className="text-muted-foreground">
          Gerencie seu plano, método de pagamento e faturas.
        </p>
      </div>

      {warning && (
        <SubscriptionWarning
          level={warning.level}
          title={warning.title}
          message={warning.message}
        />
      )}

      {/* Plano atual */}
      {subscription ? (
        <CurrentPlanCard subscription={subscription} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Nenhuma assinatura ativa</CardTitle>
            <CardDescription>
              Escolha um plano abaixo para começar a usar todas as
              funcionalidades.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {/* Planos disponíveis */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Planos Disponíveis</h2>
        <div className="grid gap-6 md:grid-cols-3">
          {plans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              isCurrentPlan={subscription?.planSlug === plan.slug}
            />
          ))}
        </div>
      </div>

      {/* Faturas */}
      {invoices.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Histórico de Faturas</CardTitle>
            <CardDescription>
              Últimas 20 faturas da sua organização.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <InvoiceTable invoices={invoices} />
          </CardContent>
        </Card>
      )}

      {/* Disclaimer */}
      <Card className="border-muted bg-muted/30">
        <CardContent className="pt-6">
          <p className="text-xs text-muted-foreground">
            Os pagamentos são processados pelo Asaas (instituição de
            pagamento regulada pelo Banco Central do Brasil). Em caso de
            inadimplência, o acesso ao canal de denúncias e a exportação de
            dados permanecerão sempre disponíveis, conforme exigência legal.
            Dados são retidos conforme política de retenção e legislação
            trabalhista vigente.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
