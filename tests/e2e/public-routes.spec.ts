/**
 * E2E — rotas públicas, sem banco e sem credenciais.
 *
 * Cobre o que o Vitest não alcança: Server Components `async`, que a
 * documentação do Next.js recomenda testar por E2E justamente porque o Vitest
 * não os suporta (node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md).
 *
 * Nenhuma credencial real. Nenhum dado semeado. O Supabase está apontado para
 * um host placeholder — as rotas exercitadas aqui não dependem dele.
 */

import { expect, test } from "@playwright/test";

test.describe("landing page", () => {
  test("renderiza com título e chamada principal", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("h1")).toBeVisible();
    await expect(page.getByRole("link", { name: "Entrar" }).first()).toBeVisible();
  });

  test("leva ao login pela navegação", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Entrar" }).first().click();

    await expect(page).toHaveURL(/\/login/);
  });

  test("não emite erro de console ao carregar", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    expect(errors).toEqual([]);
  });
});

test.describe("rotas de autenticação", () => {
  test("página de login renderiza o formulário", async ({ page }) => {
    await page.goto("/login");

    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();
  });

  test("alternância de visibilidade da senha funciona no navegador real", async ({
    page,
  }) => {
    await page.goto("/login");

    const password = page.locator("#password");
    await expect(password).toHaveAttribute("type", "password");

    await page.getByLabel("Mostrar senha").click();
    await expect(password).toHaveAttribute("type", "text");

    await page.getByLabel("Ocultar senha").click();
    await expect(password).toHaveAttribute("type", "password");
  });

  test("página de cadastro renderiza", async ({ page }) => {
    await page.goto("/signup");

    await expect(page.locator("#password")).toBeVisible();
  });
});

test.describe("canal público de denúncias", () => {
  test("acompanhamento renderiza sem exigir sessão", async ({ page }) => {
    await page.goto("/report/track");

    await expect(
      page.getByRole("heading", { name: "Acompanhamento de Denúncia" })
    ).toBeVisible();
  });

  test("slug inexistente produz erro controlado, nunca página branca", async ({
    page,
  }) => {
    const response = await page.goto("/report/organizacao-que-nao-existe");

    // O requisito é ausência de 500 genérico e de tela em branco.
    expect(response?.status()).toBeLessThan(500);
    await expect(page.locator("body")).not.toBeEmpty();
  });
});

test.describe("sessão ausente", () => {
  const protectedRoutes = [
    "/dashboard",
    "/dashboard/employees",
    "/dashboard/campaigns",
    "/dashboard/complaints",
  ];

  for (const route of protectedRoutes) {
    test(`${route} redireciona para /login sem sessão`, async ({ page }) => {
      await page.goto(route);

      await expect(page).toHaveURL(/\/login/);
    });
  }
});

test.describe("cabeçalhos de segurança", () => {
  test("resposta traz os cabeçalhos configurados", async ({ page }) => {
    const response = await page.goto("/");
    const headers = response?.headers() ?? {};

    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });

  test("não expõe o cabeçalho x-powered-by", async ({ page }) => {
    const response = await page.goto("/");

    expect(response?.headers()["x-powered-by"]).toBeUndefined();
  });
});

test.describe("acessibilidade básica", () => {
  test("landing tem exatamente um h1", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("h1")).toHaveCount(1);
  });

  test("campos do login têm rótulo associado", async ({ page }) => {
    await page.goto("/login");

    const password = page.locator("#password");
    const id = await password.getAttribute("id");
    await expect(page.locator(`label[for="${id}"]`)).toHaveCount(1);
  });

  test("login é navegável por teclado", async ({ page }) => {
    await page.goto("/login");

    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => document.activeElement?.tagName);

    expect(focused).toBeTruthy();
    expect(focused).not.toBe("BODY");
  });

  test("documento declara o idioma", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("html")).toHaveAttribute("lang", /.+/);
  });
});
