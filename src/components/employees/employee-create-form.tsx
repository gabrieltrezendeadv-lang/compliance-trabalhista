"use client";

import * as React from "react";
import { createEmployee } from "@/lib/employees/actions";
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

interface Option {
  id: string;
  name: string;
  establishment_id?: string | null;
}

export function EmployeeCreateForm({
  establishments,
  departments,
}: {
  establishments: Option[];
  departments: Option[];
}) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);
  const formRef = React.useRef<HTMLFormElement>(null);

  async function submit(formData: FormData) {
    setPending(true);
    setError(null);
    setSuccess(false);
    const result = await createEmployee(formData);
    if (result.error) {
      setError(result.error);
    } else {
      setSuccess(true);
      formRef.current?.reset();
    }
    setPending(false);
  }

  return (
    <form ref={formRef} action={submit} className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="employee-name">Nome completo</Label>
        <Input id="employee-name" name="full_name" required maxLength={200} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="employee-email">E-mail</Label>
        <Input id="employee-email" name="email" type="email" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="employee-phone">Telefone com DDI e DDD</Label>
        <Input
          id="employee-phone"
          name="phone"
          inputMode="tel"
          placeholder="+5531999999999"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="employee-job">Cargo</Label>
        <Input id="employee-job" name="job_title" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="employee-hire-date">Data de admissão</Label>
        <Input id="employee-hire-date" name="hire_date" type="date" />
      </div>
      <div className="space-y-2">
        <Label>Estabelecimento</Label>
        <Select name="establishment_id">
          <SelectTrigger>
            <SelectValue placeholder="Todos / não informado" />
          </SelectTrigger>
          <SelectContent>
            {establishments.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Departamento</Label>
        <Select name="department_id">
          <SelectTrigger>
            <SelectValue placeholder="Todos / não informado" />
          </SelectTrigger>
          <SelectContent>
            {departments.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2 sm:col-span-2">
        <p className="text-xs text-muted-foreground">
          Informe ao menos e-mail ou telefone. Esses dados são usados para criar
          os destinatários das campanhas; membros são os usuários que acessam o painel.
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {success && (
          <p className="text-sm text-green-600">Colaborador cadastrado.</p>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? "Salvando..." : "Cadastrar colaborador"}
        </Button>
      </div>
    </form>
  );
}

