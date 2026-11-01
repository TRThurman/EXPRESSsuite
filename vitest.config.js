import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.test.ts"],
    // The SMRL v8 corpus tests take minutes and gigabytes: `npm run test:smrlv8`.
    exclude: [...configDefaults.exclude, "src/test/smrlv8-*.test.ts"],
    coverage: {
      include: ["**/language/express-p11*.ts"],
    },
  },
});
