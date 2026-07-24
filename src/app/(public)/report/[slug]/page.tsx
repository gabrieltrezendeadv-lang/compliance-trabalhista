import { ComplaintForm } from "@/components/complaints/complaint-form";

export const metadata = {
  title: "Canal de Denúncias — Registro",
  description:
    "Registre uma denúncia de forma segura e anônima. Suas informações são protegidas.",
};

export default async function ReportPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // O tenant name será resolvido pela função do Supabase.
  // Aqui usamos o slug como fallback para o nome.
  const tenantName = slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold">Canal de Denúncias</h1>
        <p className="mt-2 text-muted-foreground">
          Canal seguro e confidencial para relato de irregularidades.
        </p>
        <p className="mt-4 rounded-lg bg-blue-50 p-3 text-sm text-blue-800">
          Você pode registrar sua denúncia de forma completamente anônima.
          Nenhum dado que possa identificá-lo(a) é registrado pelo sistema
          (sem cookies, sem IP, sem fingerprint).
        </p>
      </div>

      <ComplaintForm tenantSlug={slug} tenantName={tenantName} />
    </div>
  );
}
