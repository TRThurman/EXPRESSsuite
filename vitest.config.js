import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.test.ts"],
    coverage: {
      include: ["**/language/express-p11*.ts"],
    },
  },
});
