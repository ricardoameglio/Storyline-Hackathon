import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["node_modules/**", "data/**", "output/**", "tmp/**"] },
  { files: ["public/interview.js"], languageOptions: { globals: globals.browser }, rules: {
    ...js.configs.recommended.rules,
    "no-empty": ["error", { allowEmptyCatch: true }],
    "no-unused-vars": ["error", { caughtErrors: "none" }],
  } },
];
