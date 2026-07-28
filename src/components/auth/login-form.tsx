"use client";

import { useActionState } from "react";
import Link from "next/link";
import { login } from "@/lib/auth-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/auth/password-input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type LoginState = { error: string } | null;

async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const result = await login(formData);
  if (result?.error) {
    return { error: result.error };
  }
  return null;
}

export function LoginForm() {
  const [state, formAction, isPending] = useActionState(loginAction, null);

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">Entrar</CardTitle>
        <CardDescription>
          Acesse sua conta de compliance trabalhista
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          {state?.error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {state.error}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="seu@email.com"
              required
              autoComplete="email"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Senha</Label>
            <PasswordInput
              id="password"
              name="password"
              required
              autoComplete="current-password"
            />
          </div>
          <Button type="submit" className="w-full" disabled={isPending}>
            {isPending ? "Entrando..." : "Entrar"}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="justify-center">
        <p className="text-sm text-muted-foreground">
          Ainda não tem conta?{" "}
          <Link href="/signup" className="text-primary underline-offset-4 hover:underline">
            Criar conta
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
