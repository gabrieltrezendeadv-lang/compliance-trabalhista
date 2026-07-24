"use client";

import { useState } from "react";
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
import { Switch } from "@/components/ui/switch";
import { Plus } from "lucide-react";
import { createEstablishment } from "@/lib/organizations/actions";

export function CreateEstablishmentDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const formData = new FormData(e.currentTarget);

    const payload = {
      name: formData.get("name") as string,
      document_number: (formData.get("document_number") as string) || null,
      is_headquarters: formData.get("is_headquarters") === "on",
      employee_count: Number(formData.get("employee_count")) || 0,
      cnae_code: (formData.get("cnae_code") as string) || null,
      risk_grade: Number(formData.get("risk_grade")) || null,
      email: (formData.get("email") as string) || null,
      phone: (formData.get("phone") as string) || null,
      address: {
        cep: (formData.get("cep") as string) || undefined,
        cidade: (formData.get("cidade") as string) || undefined,
        uf: (formData.get("uf") as string) || undefined,
      },
    };

    const result = await createEstablishment(payload);

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
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Novo estabelecimento
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo estabelecimento</DialogTitle>
          <DialogDescription>
            Adicione uma unidade (CNPJ) da sua organização.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Nome *</Label>
            <Input
              id="name"
              name="name"
              placeholder="Matriz São Paulo"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="document_number">CNPJ</Label>
              <Input
                id="document_number"
                name="document_number"
                placeholder="00.000.000/0001-00"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cnae_code">CNAE</Label>
              <Input
                id="cnae_code"
                name="cnae_code"
                placeholder="6201-5/00"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="employee_count">Nº colaboradores</Label>
              <Input
                id="employee_count"
                name="employee_count"
                type="number"
                min={0}
                defaultValue={0}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="risk_grade">Grau de risco (1-4)</Label>
              <Input
                id="risk_grade"
                name="risk_grade"
                type="number"
                min={1}
                max={4}
                placeholder="1"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Switch id="is_headquarters" name="is_headquarters" />
            <Label htmlFor="is_headquarters">É a matriz</Label>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="contato@empresa.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Telefone</Label>
              <Input
                id="phone"
                name="phone"
                placeholder="(11) 99999-0000"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="cep">CEP</Label>
              <Input id="cep" name="cep" placeholder="00000-000" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cidade">Cidade</Label>
              <Input id="cidade" name="cidade" placeholder="São Paulo" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="uf">UF</Label>
              <Input id="uf" name="uf" placeholder="SP" maxLength={2} />
            </div>
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
            <Button type="submit" disabled={loading}>
              {loading ? "Salvando..." : "Criar estabelecimento"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
