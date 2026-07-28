"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  ShieldAlert,
  Megaphone,
  FileCheck,
  ClipboardList,
  AlertTriangle,
  Users,
  Building2,
  Network,
  Settings,
  Menu,
  X,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"

interface SidebarProps {
  organizationName: string
}

const navItems = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    label: "Denuncias",
    href: "/dashboard/complaints",
    icon: ShieldAlert,
  },
  {
    label: "Campanhas",
    href: "/dashboard/campaigns",
    icon: Megaphone,
  },
  {
    label: "Evidencias",
    href: "/dashboard/evidence",
    icon: FileCheck,
  },
  {
    label: "Assessments",
    href: "/dashboard/assessments",
    icon: ClipboardList,
  },
  {
    label: "Riscos",
    href: "/dashboard/risks",
    icon: AlertTriangle,
  },
  {
    label: "Colaboradores",
    href: "/dashboard/employees",
    icon: Users,
  },
  {
    label: "Membros",
    href: "/dashboard/members",
    icon: Users,
  },
  {
    label: "Estabelecimentos",
    href: "/dashboard/establishments",
    icon: Building2,
  },
  {
    label: "Departamentos",
    href: "/dashboard/departments",
    icon: Network,
  },
  {
    label: "Configuracoes",
    href: "/dashboard/settings",
    icon: Settings,
  },
] as const

export function Sidebar({ organizationName }: SidebarProps) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = React.useState(false)

  function isActive(href: string) {
    if (href === "/dashboard") {
      return pathname === "/dashboard"
    }
    return pathname.startsWith(href)
  }

  const navContent = (
    <>
      {/* Organization header */}
      <div className="flex h-14 items-center px-4">
        <Building2 className="mr-2 h-5 w-5 text-primary" />
        <span className="truncate text-sm font-semibold">
          {organizationName}
        </span>
      </div>

      <Separator />

      {/* Navigation links */}
      <nav className="flex-1 space-y-1 px-2 py-4">
        {navItems.map((item) => {
          const Icon = item.icon
          const active = isActive(item.href)

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          )
        })}
      </nav>
    </>
  )

  return (
    <>
      {/* Mobile hamburger button */}
      <Button
        variant="ghost"
        size="icon"
        className="fixed left-4 top-3 z-50 md:hidden"
        onClick={() => setMobileOpen(!mobileOpen)}
        aria-label={mobileOpen ? "Fechar menu" : "Abrir menu"}
      >
        {mobileOpen ? (
          <X className="h-5 w-5" />
        ) : (
          <Menu className="h-5 w-5" />
        )}
      </Button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r bg-background transition-transform duration-200 md:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {navContent}
      </aside>

      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-r bg-background md:flex md:flex-col">
        {navContent}
      </aside>
    </>
  )
}
