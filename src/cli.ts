#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { WireMockServer } from "./core/server";
import { stubMappingSchema } from "./types";

interface CliArgs {
    port: number;
    host: string;
    mappings: string | undefined;
}

const parseArgs = (argv: string[]): CliArgs => {
    const args: CliArgs = { port: 8080, host: "127.0.0.1", mappings: undefined };
    for (let i = 0; i < argv.length; i += 1) {
        const flag = argv[i];
        const value = argv[i + 1];
        if (flag === "--port" && value !== undefined) {
            args.port = Number.parseInt(value, 10);
            i += 1;
        } else if (flag === "--host" && value !== undefined) {
            args.host = value;
            i += 1;
        } else if (flag === "--mappings" && value !== undefined) {
            args.mappings = value;
            i += 1;
        }
    }
    return args;
};

const loadMappings = async (server: WireMockServer, dir: string): Promise<number> => {
    const entries = await readdir(dir);
    let loaded = 0;
    for (const entry of entries) {
        if (!entry.endsWith(".json")) continue;
        const raw = await readFile(join(dir, entry), "utf8");
        const parsed: unknown = JSON.parse(raw);
        const candidates =
            parsed !== null && typeof parsed === "object" && "mappings" in parsed
                ? (parsed as { mappings: unknown[] }).mappings
                : [parsed];
        for (const candidate of candidates) {
            const result = stubMappingSchema.safeParse(candidate);
            if (result.success) {
                server.register(result.data);
                loaded += 1;
            } else {
                process.stderr.write(`skipping invalid mapping in ${entry}\n`);
            }
        }
    }
    return loaded;
};

const main = async (): Promise<void> => {
    const args = parseArgs(process.argv.slice(2));
    const server = new WireMockServer({ port: args.port, host: args.host });

    if (args.mappings !== undefined) {
        const count = await loadMappings(server, args.mappings);
        process.stdout.write(`loaded ${count} mapping(s) from ${args.mappings}\n`);
    }

    await server.start();
    process.stdout.write(
        `wiremock-ts listening on ${server.baseUrl} (admin at ${server.baseUrl}${"/__admin"})\n`,
    );

    const shutdown = (): void => {
        void server.stop().finally(() => process.exit(0));
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
};

void main().catch((err: unknown) => {
    process.stderr.write(`failed to start wiremock-ts: ${String(err)}\n`);
    process.exit(1);
});
