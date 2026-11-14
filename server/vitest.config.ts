import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // os testes usam um banco Postgres real (schema descartável por arquivo)
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
