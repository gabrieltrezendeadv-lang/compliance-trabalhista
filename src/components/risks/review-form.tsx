"use client"

import * as React from "react"
import { Plus, ChevronDown } from "lucide-react"
import { createReview } from "@/lib/risks/actions"
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

interface ReviewFormProps {
  riskItemId: string
}

const RISK_LEVEL_OPTIONS = [
  { value: "low", label: "Baixo" },
  { value: "moderate", label: "Moderado" },
  { value: "high", label: "Alto" },
  { value: "critical", label: "Critico" },
] as const

const RECOMMENDATION_OPTIONS = [
  { value: "maintain", label: "Manter - Controles atuais adequados" },
  { value: "intensify", label: "Intensificar - Reforcar controles" },
  { value: "close", label: "Encerrar - Risco mitigado" },
  { value: "new_action", label: "Nova acao - Criar plano adicional" },
] as const

export function ReviewForm({ riskItemId }: ReviewFormProps) {
  const [expanded, setExpanded] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const formRef = React.useRef<HTMLFormElement>(null)

  async function handleSubmit(formData: FormData) {
    setPending(true)
    setError(null)

    formData.set("risk_item_id", riskItemId)
    formData.set("review_date", new Date().toISOString().slice(0, 10))

    const result = await createReview(formData)

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
          Nova Revisao de Eficacia
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
            {/* Risk Level and Score */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Novo Nivel de Risco</Label>
                <Select name="new_risk_level" required>
                  <SelectTrigger>
                    <SelectValue placeholder="Nivel apos revisao" />
                  </SelectTrigger>
                  <SelectContent>
                    {RISK_LEVEL_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="rv-score">Nova Pontuacao (0-100)</Label>
                <Input
                  id="rv-score"
                  name="new_score"
                  type="number"
                  min={0}
                  max={100}
                  placeholder="Pontuacao opcional"
                />
              </div>
            </div>

            {/* Assessment Method */}
            <div className="space-y-2">
              <Label htmlFor="rv-method">Metodo de Avaliacao</Label>
              <Input
                id="rv-method"
                name="assessment_method"
                required
                minLength={3}
                maxLength={200}
                placeholder="Ex: Inspecao in loco, Analise documental, Entrevista"
              />
            </div>

            {/* Findings */}
            <div className="space-y-2">
              <Label htmlFor="rv-findings">Constatacoes</Label>
              <Textarea
                id="rv-findings"
                name="findings"
                required
                minLength={10}
                maxLength={5000}
                rows={4}
                placeholder="Descreva as constatacoes da revisao de eficacia"
              />
            </div>

            {/* Recommendation */}
            <div className="space-y-2">
              <Label>Recomendacao</Label>
              <Select name="recommendation" required>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a recomendacao" />
                </SelectTrigger>
                <SelectContent>
                  {RECOMMENDATION_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                {pending ? "Salvando..." : "Registrar Revisao"}
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
