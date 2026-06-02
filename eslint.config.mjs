import js from "@eslint/js";
import prettier from "eslint-config-prettier/flat";
import tseslint from "typescript-eslint";

export default tseslint.config(
    {
        ignores: ["dist/**", "node_modules/**", "coverage/**"],
    },
    js.configs.recommended,
    {
        files: ["**/*.ts"],
        extends: [tseslint.configs.recommended],
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            "@typescript-eslint/no-unused-vars": [
                "error",
                {
                    argsIgnorePattern: "^_",
                    varsIgnorePattern: "^_",
                    caughtErrorsIgnorePattern: "^_",
                },
            ],
        },
    },
    // must be last: turns off eslint rules that conflict with prettier.
    prettier,
);
