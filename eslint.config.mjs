import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Aplikasi Expo terpisah dengan konfigurasi lint sendiri.
    "mobile/**",
  ]),
  {
    // Nama berawalan "_" dan field yang sengaja dibuang lewat rest (`{ a: _, ...rest }`) bukan sisa kode.
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
    },
  },
  {
    // Skrip Node CommonJS (migrasi, seeder, worker, layanan WA): require() memang benar di sini.
    files: ["database/**/*.{js,cjs}", "scripts/**/*.{js,cjs}", "services/**/*.{js,cjs}", "tools/**/*.{js,cjs}"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    // Deklarasi ambient memperluas tipe modul lewat interface kosong (`interface X extends Y {}`).
    files: ["**/*.d.ts"],
    rules: { "@typescript-eslint/no-empty-object-type": "off" },
  },
]);

export default eslintConfig;
