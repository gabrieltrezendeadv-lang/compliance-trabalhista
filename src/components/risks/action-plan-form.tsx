"use client"

import * as React from "react"
import { Plus, ChevronDown } from "lucide-react"
import { createActionPlan } from "@/lib/risks/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

interface Member {
  id: string
  full_name: string
}

interface ActionPlanFormProps {
  riskItemId: string
  members: Member[]
}

const CONTROL_LEVEL_OPTIONS = [
  { value: "elimination", label: "1. Eliminacao - Remover o perigo" },
  { value: "substitution", label: "2. Substituicao - Substituir por menos perigoso" },
  { value: "engineering", label: "3. Engenharia - Controles de engenharia" },
  { value: "administrative", label: "4. Administrativo - Procedimentos e treinamentos" },
  { value: "ppe", label: "5. EPI - Equipamento de protecao individual" },
] as const

const STATUS_OPTIONS = [
  { value: "planned", label: "Planejado" },
  { value: "in_progress", label: "Em andamento" },
  { value: "completed", label: "Concluido" },
  { value: "overdue", label: "Atrasado" },
  { value: "cancelled", label: "Cancelado" },
] as const

export function ActionPlanForm({ riskItemId, members }: ActionPlanFormProps) {
  const [expanded, setExpanded] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const formRef = React.useRef<HTMLFormElement>(null)

  async function handleSubmit(formData: FormData) {
    setPending(true)
    setError(null)

    formData.set("risk_item_id", riskItemId)

    const result = await createActionPlan(formData)

    if (result.error) {
      setError(result.error)
      setPending(false)
      return
    }

    formRef.current?.reset()
    setExpanded(false)
    setPending(false)
  }

  return (
    <div className="rounded-lg border">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium hover:bg-accent"
      >
        <span className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Novo Plano de Acao
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 transition-transform",
            expanded && "rotate-180"
          )}
        />
      </button>

      {expanded && (
        <div className="border-t px-4 py-4">
          <form ref={formRef} action={handleSubmit} className="space-y-4">
            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="ap-title">Titulo</Label>
              <Input
                id="ap-title"
                name="title"
                required
                minLength={5}
                maxLength={300}
                placeholder="Titulo do plano de acao"
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="ap-description">Descricao</Label>
              <Textarea
                id="ap-description"
                name="description"
                required
                minLength={10}
                maxLength={5000}
                rows={3}
                placeholder="Descreva as acoes a serem tomadas"
              />
            </div>

            {/* Control Level and Status */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Nivel de Controle (NR-1)</Label>
                <Select name="control_level">
                  <SelectTrigger>
                    <SelectValue placeholder="Hierarquia de controle" />
                  </SelectTrigger>
                  <SelectContent>
                    {CONTROL_LEVEL_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Status</Label>
                <Select name="status" defaultValue="planned">
                  <SelectTrigger>
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Responsible and Due Date */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Responsavel</Label>
                <Select name="responsible_user_id">
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione (opcional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {members.map((member) => (
                      <SelectItem key={member.id} value={member.id}>
                        {member.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ap-due-date">Data de Vencimento</Label>
                <Input
                  id="ap-due-date"
                  name="due_date"
                  type="datetime-local"
                />
              </div>
            </div>

            {/* Error display */}
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            {/* Submit */}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setExpanded(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Salvando..." : "Criar Plano"}
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
