/**
 * PasswordInput — teste de COMPORTAMENTO.
 *
 * `tests/reconciliation-guards.mjs` verifica este componente com três regex
 * sobre o texto-fonte (`/EyeOff/`, `/Mostrar senha/`, `/Ocultar senha/`).
 * Isso confirma que certas strings existem no arquivo — não que a alternância
 * funcione. O guard passaria com o `onClick` removido.
 *
 * Aqui o componente é renderizado e operado como um usuário faria. O guard
 * original permanece intacto (instrução da Etapa 1); este teste o complementa.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { PasswordInput } from "@/components/auth/password-input";

describe("PasswordInput", () => {
  it("começa mascarado", () => {
    render(<PasswordInput />);

    expect(screen.getByLabelText("Mostrar senha")).toBeInTheDocument();
    expect(document.getElementById("password")).toHaveAttribute("type", "password");
  });

  it("revela a senha ao acionar o botão", async () => {
    const user = userEvent.setup();
    render(<PasswordInput />);

    await user.click(screen.getByLabelText("Mostrar senha"));

    expect(document.getElementById("password")).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("Ocultar senha")).toBeInTheDocument();
  });

  it("volta a mascarar ao acionar de novo", async () => {
    const user = userEvent.setup();
    render(<PasswordInput />);

    await user.click(screen.getByLabelText("Mostrar senha"));
    await user.click(screen.getByLabelText("Ocultar senha"));

    expect(document.getElementById("password")).toHaveAttribute("type", "password");
  });

  it("preserva o valor digitado ao alternar a visibilidade", async () => {
    const user = userEvent.setup();
    render(<PasswordInput />);

    const input = document.getElementById("password") as HTMLInputElement;
    await user.type(input, "senha-secreta");
    await user.click(screen.getByLabelText("Mostrar senha"));

    expect(input.value).toBe("senha-secreta");
  });

  it("expõe estado acessível por aria-pressed e aria-controls", async () => {
    const user = userEvent.setup();
    render(<PasswordInput id="nova-senha" />);

    const toggle = screen.getByLabelText("Mostrar senha");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle).toHaveAttribute("aria-controls", "nova-senha");

    await user.click(toggle);

    expect(screen.getByLabelText("Ocultar senha")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("é operável por teclado", async () => {
    const user = userEvent.setup();
    render(<PasswordInput />);

    await user.tab(); // campo
    await user.tab(); // botão
    await user.keyboard("{Enter}");

    expect(document.getElementById("password")).toHaveAttribute("type", "text");
  });

  it("não submete o formulário ao alternar (type=button)", () => {
    render(<PasswordInput />);

    expect(screen.getByLabelText("Mostrar senha")).toHaveAttribute("type", "button");
  });
});
