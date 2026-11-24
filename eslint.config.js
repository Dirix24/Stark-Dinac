import tseslint from "typescript-eslint";
export default [
  { ignores: ["dist/**", "dist-desktop/**"] },
  ...tseslint.configs.recommended,
];
