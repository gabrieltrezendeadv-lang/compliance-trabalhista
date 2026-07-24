import { ComplaintTracker } from "@/components/complaints/complaint-tracker";

export const metadata = {
  title: "Canal de Denúncias — Acompanhamento",
  description:
    "Acompanhe sua denúncia de forma segura usando protocolo e PIN.",
};

export default function TrackPage() {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold">Acompanhamento de Denúncia</h1>
        <p className="mt-2 text-muted-foreground">
          Acesse a caixa segura de mensagens para acompanhar o andamento da
          sua denúncia e se comunicar com os investigadores.
        </p>
      </div>

      <ComplaintTracker />
    </div>
  );
}
