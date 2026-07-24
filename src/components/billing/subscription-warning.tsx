"use client"

import { AlertTriangle, XCircle, Info } from "lucide-react"
import { cn } from "@/lib/utils"

interface SubscriptionWarningProps {
  level: "info" | "warning" | "critical"
  title: string
  message: string
}

const STYLES = {
  info: {
    container: "border-blue-200 bg-blue-50 text-blue-900",
    icon: Info,
  },
  warning: {
    container: "border-yellow-200 bg-yellow-50 text-yellow-900",
    icon: AlertTriangle,
  },
  critical: {
    container: "border-red-200 bg-red-50 text-red-900",
    icon: XCircle,
  },
} as const

export function SubscriptionWarning({
  level,
  title,
  message,
}: SubscriptionWarningProps) {
  const style = STYLES[level]
  const Icon = style.icon

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border p-4",
        style.container
      )}
    >
      <Icon className="mt-0.5 h-5 w-5 shrink-0" />
      <div>
        <p className="font-semibold text-sm">{title}</p>
        <p className="text-sm mt-0.5 opacity-90">{message}</p>
      </div>
    </div>
  )
}
