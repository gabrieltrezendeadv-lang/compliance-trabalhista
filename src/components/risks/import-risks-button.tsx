"use client"

import * as React from "react"
import { Download } from "lucide-react"
import {
  getAvailableCyclesForImport,
  importRisksFromCycle,
} from "@/lib/risks/actions"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { formatDate } from "@/lib/utils"

interface Cycle {
  id: string
  name: string
  created_at: string
  closed_at?: string | null
  ends_at?: string | null
}

export function ImportRisksButton() {
  const [open, setOpen] = React.useState(false)
  const [cycles, setCycles] = React.useState<Cycle[]>([])
  const [selectedCycleId, setSelectedCycleId] = React.useState("")
  const [loading, setLoading] = React.useState(false)
  const [importing, setImporting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [result, setResult] = React.useState<string | null>(null)

  async function fetchCycles() {
    setLoading(true)
    setError(null)
    setResult(null)
    setSelectedCycleId("")

    const response = await getAvailableCyclesForImport()

    if (response.error) {
      setError(response.error)
      setLoading(false)
      return
    }

    setCycles((response.data as unknown as Cycle[]) ?? [])
    setLoading(false)
  }

  async function handleImport() {
    if (!selectedCycleId) return

    setImporting(true)
    setError(null)

    const response = await importRisksFromCycle(selectedCycleId)

    if (response.error) {
      setError(response.error)
      setImporting(false)
      return
    }

    const data = response.data as { imported_count?: number } | null
    const count = data?.imported_count ?? 0
    setResult(
      `${count} risco(s) importado(s) com sucesso do ciclo selecionado.`
    )
    setImporting(false)
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (nextOpen) {
      fetchCycles()
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Download className="mr-2 h-4 w-4" />
          Importar de Assessment
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Importar Riscos de Assessment</DialogTitle>
          <DialogDescription>
            Selecione um ciclo de avaliacao encerrado para importar os riscos
            identificados automaticamente para o inventario.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Carregando ciclos disponiveis...
          </p>
        )}

        {!loading && cycles.length === 0 && !error && (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Nenhum ciclo encerrado disponivel para importacao.
          </p>
        )}

        {!loading && cycles.length > 0 && (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Ciclo de Avaliacao</Label>
              <Select
                value={selectedCycleId}
                onValueChange={setSelectedCycleId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um ciclo" />
                </SelectTrigger>
                <SelectContent>
                  {cycles.map((cycle) => (
                    <SelectItem key={cycle.id} value={cycle.id}>
                      {cycle.name}
                      {cycle.closed_at ?? cycle.ends_at
                        ? ` (encerrado em ${formatDate((cycle.closed_at ?? cycle.ends_at)!)})`
                        : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        {result && (
          <p className="text-sm text-green-600 dark:text-green-400">
            {result}
          </p>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
          >
            {result ? "Fechar" : "Cancelar"}
          </Button>
          {!result && (
            <Button
              onClick={handleImport}
              disabled={!selectedCycleId || importing || loading}
            >
              {importing ? "Importando..." : "Importar Riscos"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
