"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { submitAssessment } from "@/lib/assessments/actions";

interface QuestionnaireItem {
  id: string;
  text: string;
  help_text: string | null;
  required: boolean;
}

interface QuestionnaireSection {
  id: string;
  name: string;
  description: string;
  dimension_code: string;
  items: QuestionnaireItem[];
}

interface ResponseScale {
  type: string;
  points: number;
  min_value: number;
  max_value: number;
  labels: Record<string, string>;
}

interface AssessmentFormProps {
  token: string;
  sections: QuestionnaireSection[];
  scale: ResponseScale;
}

export function AssessmentForm({ token, sections, scale }: AssessmentFormProps) {
  const [currentSection, setCurrentSection] = useState(0);
  const [responses, setResponses] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const section = sections[currentSection];
  const totalSections = sections.length;
  const isLastSection = currentSection === totalSections - 1;

  // Verificar se todas as perguntas obrigatórias da seção foram respondidas
  const sectionComplete = section.items
    .filter((item) => item.required)
    .every((item) => responses[item.id] !== undefined);

  const scaleOptions = Array.from(
    { length: scale.max_value - scale.min_value + 1 },
    (_, i) => scale.min_value + i
  );

  const handleResponse = useCallback((itemId: string, value: number) => {
    setResponses((prev) => ({ ...prev, [itemId]: value }));
  }, []);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);

    const formattedResponses = Object.entries(responses).map(
      ([item_id, value]) => ({
        item_id,
        value,
      })
    );

    const result = await submitAssessment({
      token,
      responses: formattedResponses,
    });

    if (result.error) {
      setError(
        typeof result.error === "string"
          ? result.error
          : "Erro ao enviar avaliação. Tente novamente."
      );
      setSubmitting(false);
      return;
    }

    setSubmitted(true);
    setSubmitting(false);
  };

  if (submitted) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <div className="rounded-full bg-green-100 p-3">
            <svg
              className="h-8 w-8 text-green-600"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4.5 12.75l6 6 9-13.5"
              />
            </svg>
          </div>
          <h3 className="mt-4 text-lg font-semibold">
            Avaliação enviada com sucesso
          </h3>
          <p className="mt-2 text-sm text-muted-foreground max-w-md">
            Suas respostas foram registradas de forma anônima. Você pode fechar
            esta página. Obrigado pela participação.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Progresso */}
      <div className="space-y-2">
        <div className="flex justify-between text-sm text-muted-foreground">
          <span>
            Seção {currentSection + 1} de {totalSections}
          </span>
          <span>
            {Object.keys(responses).length} de{" "}
            {sections.flatMap((s) => s.items).length} perguntas respondidas
          </span>
        </div>
        <div className="h-2 w-full rounded-full bg-muted">
          <div
            className="h-2 rounded-full bg-primary transition-all"
            style={{
              width: `${((currentSection + 1) / totalSections) * 100}%`,
            }}
          />
        </div>
      </div>

      {/* Seção atual */}
      <Card>
        <CardHeader>
          <CardTitle>{section.name}</CardTitle>
          {section.description && (
            <CardDescription>{section.description}</CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-6">
          {section.items.map((item, itemIdx) => (
            <div key={item.id} className="space-y-3">
              <p className="text-sm font-medium">
                {itemIdx + 1}. {item.text}
                {item.required && (
                  <span className="ml-1 text-red-500">*</span>
                )}
              </p>
              {item.help_text && (
                <p className="text-xs text-muted-foreground">
                  {item.help_text}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {scaleOptions.map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => handleResponse(item.id, value)}
                    className={`flex flex-col items-center rounded-lg border px-3 py-2 text-sm transition-colors hover:border-primary ${
                      responses[item.id] === value
                        ? "border-primary bg-primary/10 font-medium text-primary"
                        : "border-input"
                    }`}
                  >
                    <span className="text-lg font-bold">{value}</span>
                    <span className="text-xs text-muted-foreground max-w-[80px] text-center">
                      {scale.labels[String(value)]}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Erro */}
      {error && (
        <p className="text-sm text-red-600 text-center">{error}</p>
      )}

      {/* Navegação */}
      <div className="flex justify-between">
        <Button
          variant="outline"
          onClick={() => setCurrentSection((s) => s - 1)}
          disabled={currentSection === 0}
        >
          Anterior
        </Button>

        {isLastSection ? (
          <Button
            onClick={handleSubmit}
            disabled={!sectionComplete || submitting}
          >
            {submitting ? "Enviando..." : "Enviar avaliação"}
          </Button>
        ) : (
          <Button
            onClick={() => setCurrentSection((s) => s + 1)}
            disabled={!sectionComplete}
          >
            Próxima seção
          </Button>
        )}
      </div>

      {/* Aviso de anonimato */}
      <p className="text-xs text-muted-foreground text-center">
        Suas respostas são anônimas. Nenhum dado de identificação (nome, e-mail,
        IP, cookies) é registrado junto às respostas.
      </p>
    </div>
  );
}
