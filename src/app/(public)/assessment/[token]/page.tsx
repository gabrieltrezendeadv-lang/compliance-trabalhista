import { getQuestionnaireByToken } from "@/lib/assessments/actions";
import { AssessmentForm } from "@/components/assessment/assessment-form";

export const metadata = {
  title: "Avaliação Psicossocial — Questionário",
  description:
    "Responda ao questionário de avaliação de riscos psicossociais. Suas respostas são anônimas.",
};

export default async function AssessmentPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const { data } = await getQuestionnaireByToken(token);

  if (!data || !data.valid || !data.template || !data.sections) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <h1 className="text-2xl font-bold">Link inválido ou expirado</h1>
        <p className="mt-2 text-muted-foreground">
          Este link de avaliação não é válido, já foi utilizado ou expirou.
          Entre em contato com o responsável pela avaliação.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold">{data.template.name}</h1>
        {data.template.description && (
          <p className="mt-2 text-muted-foreground">
            {data.template.description}
          </p>
        )}
        <p className="mt-4 rounded-lg bg-blue-50 p-3 text-sm text-blue-800">
          Suas respostas são completamente anônimas. Nenhum dado que possa
          identificá-lo(a) é registrado pelo sistema.
        </p>
      </div>

      <AssessmentForm
        token={token}
        sections={data.sections}
        scale={data.template.response_scale}
      />
    </div>
  );
}
