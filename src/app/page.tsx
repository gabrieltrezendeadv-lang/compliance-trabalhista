import Link from "next/link"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import {
  Shield,
  ClipboardCheck,
  AlertTriangle,
  FileCheck,
  Send,
  BarChart3,
  Lock,
  Users,
  ArrowRight,
  Check,
} from "lucide-react"

export default async function Home() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    redirect("/dashboard")
  }

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            <span className="text-lg font-bold">Compliance Trabalhista</span>
          </div>
          <nav className="flex items-center gap-4">
            <Link
              href="#funcionalidades"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors hidden sm:inline"
            >
              Funcionalidades
            </Link>
            <Link
              href="#planos"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors hidden sm:inline"
            >
              Planos
            </Link>
            <Link
              href="/login"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Entrar
            </Link>
            <Link
              href="/signup"
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors"
            >
              Criar conta
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="container mx-auto max-w-6xl px-6 py-20 md:py-32">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm text-muted-foreground">
            <Lock className="h-3.5 w-3.5" />
            Dados protegidos com criptografia e RLS
          </div>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
            Compliance trabalhista{" "}
            <span className="text-primary">simplificado</span>
          </h1>
          <p className="mt-6 text-lg text-muted-foreground leading-relaxed">
            Gerencie riscos, avaliações, campanhas e denúncias em uma
            plataforma integrada. Gere relatórios prontos para fiscalização
            com integridade SHA-256 e rastreabilidade completa.
          </p>
          <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:justify-center">
            <Link
              href="/signup"
              className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors gap-2"
            >
              Começar gratuitamente
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="#funcionalidades"
              className="inline-flex h-12 items-center justify-center rounded-md border px-8 text-base font-medium hover:bg-accent transition-colors"
            >
              Conhecer funcionalidades
            </Link>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            14 dias grátis. Sem cartão de crédito.
          </p>
        </div>
      </section>

      {/* Features */}
      <section
        id="funcionalidades"
        className="border-t bg-muted/30 py-20 md:py-28"
      >
        <div className="container mx-auto max-w-6xl px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold tracking-tight">
              Tudo que você precisa para compliance trabalhista
            </h2>
            <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
              Da avaliação de riscos psicossociais (NR-1) ao relatório para
              fiscalização, cada módulo foi projetado para atender às
              exigências legais brasileiras.
            </p>
          </div>
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            <FeatureCard
              icon={AlertTriangle}
              title="Inventário de Riscos"
              description="Mapeie riscos ocupacionais e psicossociais com hierarquia de controles NR-1. Importe automaticamente de avaliações encerradas."
            />
            <FeatureCard
              icon={ClipboardCheck}
              title="Avaliações e Questionários"
              description="Aplique COPSOQ-III e outros instrumentos com anonimização individual. Resultados somente agregados para gestores."
            />
            <FeatureCard
              icon={Shield}
              title="Canal de Denúncias"
              description="Canal anônimo com separação de conteúdo e metadados. Investigadores designados, rastreamento por protocolo."
            />
            <FeatureCard
              icon={Send}
              title="Campanhas de Compliance"
              description="Envie comunicados por e-mail ou WhatsApp com confirmação de leitura e evidência de entrega para fiscalização."
            />
            <FeatureCard
              icon={FileCheck}
              title="Geração de Evidências"
              description="Snapshots imutáveis com hash SHA-256 e pacotes selados para apresentar em auditorias e fiscalizações."
            />
            <FeatureCard
              icon={BarChart3}
              title="Relatório de Compliance"
              description="Relatório consolidado com todos os indicadores, pronto para impressão, com hash de integridade e disclaimer legal."
            />
          </div>
        </div>
      </section>

      {/* Social proof / numbers */}
      <section className="border-t py-16">
        <div className="container mx-auto max-w-6xl px-6">
          <div className="grid gap-8 text-center sm:grid-cols-3">
            <div>
              <p className="text-3xl font-bold text-primary">10+</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Módulos integrados
              </p>
            </div>
            <div>
              <p className="text-3xl font-bold text-primary">40+</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Funções com segurança DEFINER
              </p>
            </div>
            <div>
              <p className="text-3xl font-bold text-primary">100%</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Row Level Security em todas as tabelas
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="planos" className="border-t bg-muted/30 py-20 md:py-28">
        <div className="container mx-auto max-w-6xl px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold tracking-tight">
              Planos para cada fase do seu programa
            </h2>
            <p className="mt-4 text-muted-foreground">
              Comece com 14 dias grátis. Upgrade quando precisar.
            </p>
          </div>
          <div className="grid gap-8 md:grid-cols-3 max-w-4xl mx-auto">
            <PricingCard
              name="Starter"
              price="R$ 199"
              description="Pequenas empresas iniciando compliance"
              features={[
                "3 estabelecimentos",
                "15 membros",
                "5 campanhas/mês",
                "3 avaliações/mês",
                "512 MB armazenamento",
              ]}
            />
            <PricingCard
              name="Professional"
              price="R$ 499"
              description="Empresas em crescimento"
              features={[
                "10 estabelecimentos",
                "50 membros",
                "20 campanhas/mês",
                "10 avaliações/mês",
                "2 GB armazenamento",
                "Acesso à API",
                "Marca personalizada",
              ]}
              highlighted
            />
            <PricingCard
              name="Enterprise"
              price="R$ 1.499"
              description="Grandes organizações"
              features={[
                "Estabelecimentos ilimitados",
                "Membros ilimitados",
                "Campanhas ilimitadas",
                "Avaliações ilimitadas",
                "Armazenamento ilimitado",
                "Acesso à API",
                "Marca personalizada",
                "Suporte prioritário",
              ]}
            />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t py-20">
        <div className="container mx-auto max-w-6xl px-6 text-center">
          <h2 className="text-3xl font-bold tracking-tight">
            Comece a proteger sua empresa hoje
          </h2>
          <p className="mt-4 text-muted-foreground max-w-xl mx-auto">
            Cadastre-se em menos de 2 minutos. Sem cartão de crédito,
            sem compromisso. 14 dias para testar todas as funcionalidades.
          </p>
          <Link
            href="/signup"
            className="mt-8 inline-flex h-12 items-center justify-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors gap-2"
          >
            Criar conta gratuita
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t bg-muted/30 py-12">
        <div className="container mx-auto max-w-6xl px-6">
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-muted-foreground" />
              <span className="text-sm font-semibold text-muted-foreground">
                Compliance Trabalhista
              </span>
            </div>
            <p className="text-xs text-muted-foreground text-center">
              Esta plataforma é uma ferramenta de apoio e não substitui a
              orientação de profissional habilitado (advogado, engenheiro de
              segurança do trabalho ou médico do trabalho).
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}

// ─── Components ─────────────────────────────────────────────────────────────

function FeatureCard({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
}) {
  return (
    <div className="rounded-xl border bg-background p-6 shadow-sm">
      <div className="mb-4 inline-flex rounded-lg bg-primary/10 p-2.5">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
        {description}
      </p>
    </div>
  )
}

function PricingCard({
  name,
  price,
  description,
  features,
  highlighted = false,
}: {
  name: string
  price: string
  description: string
  features: string[]
  highlighted?: boolean
}) {
  return (
    <div
      className={`rounded-xl border p-6 ${
        highlighted
          ? "border-primary ring-1 ring-primary shadow-md"
          : "shadow-sm"
      }`}
    >
      {highlighted && (
        <span className="mb-4 inline-block rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
          Mais popular
        </span>
      )}
      <h3 className="text-lg font-bold">{name}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      <div className="mt-4">
        <span className="text-3xl font-bold">{price}</span>
        <span className="text-sm text-muted-foreground">/mês</span>
      </div>
      <ul className="mt-6 space-y-3">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            {f}
          </li>
        ))}
      </ul>
      <Link
        href="/signup"
        className={`mt-8 flex h-10 w-full items-center justify-center rounded-md text-sm font-medium transition-colors ${
          highlighted
            ? "bg-primary text-primary-foreground hover:bg-primary/90"
            : "border hover:bg-accent"
        }`}
      >
        Começar agora
      </Link>
    </div>
  )
}
