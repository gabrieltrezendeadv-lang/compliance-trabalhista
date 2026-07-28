"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Users,
  Settings,
  LayoutDashboard,
  MapPin,
  FolderTree,
  ClipboardCheck,
  Shield,
  Send,
  FileText,
  AlertTriangle,
  FileCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Painel", icon: LayoutDashboard },
  { href: "/dashboard/establishments", label: "Estabelecimentos", icon: MapPin },
  { href: "/dashboard/departments", label: "Departamentos", icon: FolderTree },
  { href: "/dashboard/employees", label: "Colaboradores", icon: Users },
  { href: "/dashboard/assessments", label: "Avaliações", icon: ClipboardCheck },
  { href: "/dashboard/risks", label: "Riscos", icon: AlertTriangle },
  { href: "/dashboard/complaints", label: "Denúncias", icon: Shield },
  { href: "/dashboard/campaigns", label: "Campanhas", icon: Send },
  { href: "/dashboard/evidence", label: "Evidências", icon: FileText },
  { href: "/dashboard/reports", label: "Relatório", icon: FileCheck },
  { href: "/dashboard/members", label: "Membros", icon: Users },
  { href: "/dashboard/settings", label: "Configurações", icon: Settings },
] as const;

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1 px-2 py-4">
      {NAV_ITEMS.map((item) => {
        const isActive =
          item.href === "/dashboard"
            ? pathname === "/dashboard"
            : pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
