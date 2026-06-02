import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        coverage: {
            provider: "v8",
            include: ["src/**/*.ts"],
            // index.ts only re-exports; cli.ts is the entrypoint, covered by an
            // end-to-end run rather than unit tests.
            exclude: ["src/index.ts", "src/cli.ts"],
            reporter: ["text-summary", "text"],
        },
    },
});
