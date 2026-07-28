"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const ERROR_MESSAGES: Record<string, string> = {
  ALREADY_HAS_ORGANIZATION: "Você já possui uma organização.",
  INVALID_NAME: "Nome deve ter entre 2 e 200 caracteres.",
  INVALID_SLUG:
    "Identificador deve ter 3–63 caracteres (letras minúsculas, números e hífens).",
  SLUG_TAKEN: "Este identificador já está em uso. Escolha outro.",
  INVALID_CNPJ: "CNPJ deve conter exatamente 14 dígitos.",
  NOT_AUTHENTICATED: "Sessão expirada. Faça login novamente.",
};

function normalizeSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-/, "");
}

export function OnboardingForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const supabase = createClient();

      const { data, error: rpcError } = await supabase.rpc(
        "fn_create_organization_with_owner",
        {
          org_name: name.trim(),
          org_slug: slug.trim(),
          org_cnpj: cnpj.trim() || null,
        },
      );

      if (rpcError) {
        setError("Erro ao criar organização. Tente novamente.");
        return;
      }

      if (data && typeof data === "object" && "success" in data) {
        const result = data as { success: boolean; error?: string };
        if (!result.success) {
          setError(
            ERROR_MESSAGES[result.error ?? ""] ??
              `Erro: ${result.error}`,
          );
          return;
        }
      }

      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Erro inesperado. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white rounded-lg shadow p-8">
      <h1 className="text-2xl font-semibold text-gray-900 mb-2">
        Criar organização
      </h1>
      <p className="text-sm text-gray-500 mb-6">
        Para acessar o painel, cadastre sua empresa.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="org-name"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Razão social ou nome fantasia
          </label>
          <input
            id="org-name"
            type="text"
            required
            minLength={2}
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Empresa Exemplo Ltda."
          />
        </div>

        <div>
          <label
            htmlFor="org-slug"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Identificador (URL)
          </label>
          <div className="flex items-center border border-gray-300 rounded overflow-hidden">
            <span className="bg-gray-100 px-3 py-2 text-sm text-gray-500 select-none">
              app/
            </span>
            <input
              id="org-slug"
              type="text"
              required
              minLength={3}
              maxLength={63}
              value={slug}
              onChange={(e) => setSlug(normalizeSlug(e.target.value))}
              className="flex-1 px-3 py-2 text-sm focus:outline-none"
              placeholder="minha-empresa"
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="org-cnpj"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            CNPJ <span className="text-gray-400">(opcional)</span>
          </label>
          <input
            id="org-cnpj"
            type="text"
            maxLength={18}
            value={cnpj}
            onChange={(e) => setCnpj(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="00.000.000/0001-00"
          />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 text-white rounded py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Criando..." : "Criar e acessar painel"}
        </button>
      </form>
    </div>
  );
}
