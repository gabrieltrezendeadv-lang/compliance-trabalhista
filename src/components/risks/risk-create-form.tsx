"use client"

import * as React from "react"
import { createRiskItem } from "@/lib/risks/actions"
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

interface Establishment {
  id: string
  name: string
}

interface Department {
  id: string
  name: string
  establishment_id: string
}

interface RiskCreateFormProps {
  establishments: Establishment[]
  departments: Department[]
}

const SOURCE_OPTIONS = [
  { value: "assessment", label: "Avaliacao" },
  { value: "complaint", label: "Denuncia" },
  { value: "inspection", label: "Inspecao" },
  { value: "manual", label: "Manual" },
] as const

const CATEGORY_OPTIONS = [
  { value: "psychosocial", label: "Psicossocial" },
  { value: "ergonomic", label: "Ergonomico" },
  { value: "physical", label: "Fisico" },
  { value: "chemical", label: "Quimico" },
  { value: "biological", label: "Biologico" },
  { value: "accident", label: "Acidente" },
] as const

const RISK_LEVEL_OPTIONS = [
  { value: "low", label: "Baixo" },
  { value: "moderate", label: "Moderado" },
  { value: "high", label: "Alto" },
  { value: "critical", label: "Critico" },
] as const

const PRIORITY_OPTIONS = [
  { value: "1", label: "1 - Muito baixa" },
  { value: "2", label: "2 - Baixa" },
  { value: "3", label: "3 - Media" },
  { value: "4", label: "4 - Alta" },
  { value: "5", label: "5 - Muito alta" },
] as const

export function RiskCreateForm({
  establishments,
  departments,
}: RiskCreateFormProps) {
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [selectedEstablishment, setSelectedEstablishment] = React.useState("")
  const formRef = React.useRef<HTMLFormElement>(null)

  const filteredDepartments = selectedEstablishment
    ? departments.filter((d) => d.establishment_id === selectedEstablishment)
    : departments

  async function handleSubmit(formData: FormData) {
    setPending(true)
    setError(null)

    const result = await createRiskItem(formData)

    if (result.error) {
      setError(result.error)
      setPending(false)
      return
    }

    formRef.current?.reset()
    setSelectedEstablishment("")
    setPending(false)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Novo Risco</CardTitle>
        <CardDescription>
          Registre um novo item de risco no inventario.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={formRef} action={handleSubmit} className="space-y-4">
          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="title">Titulo</Label>
            <Input
              id="title"
              name="title"
              required
              minLength={5}
              maxLength={300}
              placeholder="Titulo do risco identificado"
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Descricao</Label>
            <Textarea
              id="description"
              name="description"
              required
              minLength={10}
              maxLength={5000}
              rows={4}
              placeholder="Descreva o risco em detalhes"
            />
          </div>

          {/* Source and Category */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Fonte</Label>
              <Select name="source" required>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a fonte" />
                </SelectTrigger>
                <SelectContent>
                  {SOURCE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Categoria</Label>
              <Select name="category" required>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a categoria" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Risk Level and Priority */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Nivel de Risco Inicial</Label>
              <Select name="initial_risk_level" required>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o nivel" />
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
              <Label>Prioridade</Label>
              <Select name="priority">
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a prioridade" />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Establishment and Department */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Estabelecimento</Label>
              <Select
                name="establishment_id"
                value={selectedEstablishment}
                onValueChange={setSelectedEstablishment}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione (opcional)" />
                </SelectTrigger>
                <SelectContent>
                  {establishments.map((est) => (
                    <SelectItem key={est.id} value={est.id}>
                      {est.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Departamento</Label>
              <Select name="department_id">
                <SelectTrigger>
                  <SelectValue placeholder="Selecione (opcional)" />
                </SelectTrigger>
                <SelectContent>
                  {filteredDepartments.map((dep) => (
                    <SelectItem key={dep.id} value={dep.id}>
                      {dep.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Affected Group */}
          <div className="space-y-2">
            <Label htmlFor="affected_group">Grupo Afetado</Label>
            <Input
              id="affected_group"
              name="affected_group"
              maxLength={200}
              placeholder="Ex: Operadores de telemarketing, equipe de limpeza"
            />
          </div>

          {/* Error display */}
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          {/* Submit */}
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Salvando..." : "Registrar Risco"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
