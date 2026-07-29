/**
 * Setup do ambiente jsdom (projeto "component").
 *
 * Carrega os matchers de DOM do @testing-library/jest-dom e garante limpeza
 * do DOM entre testes, evitando vazamento de estado de um teste para o outro.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
