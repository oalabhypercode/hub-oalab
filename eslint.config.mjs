import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // .claude holds agent worktrees with their own builds; they are not part of this project.
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", ".claude/**"]),
]);

export default eslintConfig;
