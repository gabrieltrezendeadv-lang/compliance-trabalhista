"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus } from "lucide-react";
import { createAssessmentCycle, getQuestionnaireTemplates } from "@/lib/assessments/actions";

interface Template {
  id: string;
  name: string;
  instrument_code: string | null;
}

export function CreateAssessmentCycleDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState("");

  useEffect(() => {
    if (open) {
      getQuestionnaireTemplates().then((result) => {
        if (result.data) {
          setTemplates(result.data as Template[]);
        }
      });
    }
  }, [open]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const formData = new FormData(e.currentTarget);

    const startsAt = formData.get("starts_at") as string;
    const endsAt = formData.get("ends_at") as string;

    const payload = {
      questionnaire_template_id: selectedTemplate,
      name: formData.get("name") as string,
      description: (formData.get("description") as string) || undefined,
      starts_at: startsAt ? new Date(startsAt).toISOString() : "",
      ends_at: endsAt ? new Date(endsAt).toISOString() : "",
      min_respondents_threshold:
        Number(formData.get("min_respondents_threshold")) || 5,
    };

    const result = await createAssessmentCycle(payload);

    if (result.error) {
      setError(
        typeof result.error === "string"
          ? result.error
          : "Verifique os campos e tente novamente."
      );
      setLoading(false);
      return;
    }

    setLoading(false);
    setOpen(false);
    setSelectedTemplate("");
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Novo ciclo
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo ciclo de avaliação</DialogTitle>
          <DialogDescription>
            Crie um ciclo de avaliação psicossocial. Os respondentes receberão
            um link anônimo para preencher o questionário.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Nome do ciclo *</Label>
            <Input
              id="name"
              name="name"
              placeholder="Avaliação Q3 2026"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="template">Questionário *</Label>
            <Select
              value={selectedTemplate}
              onValueChange={setSelectedTemplate}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione um questionário" />
              </SelectTrigger>
              <SelectContent>
                {templates.length === 0 ? (
                  <SelectItem value="__none" disabled>
                    Nenhum questionário disponível
                  </SelectItem>
                ) : (
                  templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                      {t.instrument_code ? ` (${t.instrument_code})` : ""}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Descrição</Label>
            <Textarea
              id="description"
              name="description"
              placeholder="Objetivo desta avaliação..."
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="starts_at">Data de início *</Label>
              <Input
                id="starts_at"
                name="starts_at"
                type="date"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ends_at">Data de término *</Label>
              <Input
                id="ends_at"
                name="ends_at"
                type="date"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="min_respondents_threshold">
              Mínimo de respondentes (limiar de anonimato)
            </Label>
            <Input
              id="min_respondents_threshold"
              name="min_respondents_threshold"
              type="number"
              min={3}
              defaultValue={5}
            />
            <p className="text-xs text-muted-foreground">
              Resultados agregados só serão exibidos quando o grupo atingir este
              número de respostas (mín. 3, conforme NR-1).
            </p>
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={loading}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={loading || !selectedTemplate}>
              {loading ? "Criando..." : "Criar ciclo"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
