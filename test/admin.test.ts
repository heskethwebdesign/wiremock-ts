import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { startMock, WireMockServer } from "../src/index";

let server: WireMockServer;

beforeEach(async () => {
    server = await startMock({ port: 0 });
});
afterEach(async () => {
    await server.stop();
});

const admin = (path: string, init?: RequestInit): Promise<Response> =>
    fetch(`${server.baseUrl}/__admin${path}`, init);

describe("admin api", () => {
    it("answers health and root probes", async () => {
        expect((await admin("/health")).status).toBe(200);
        expect((await admin("")).status).toBe(200);
    });

    it("creates, fetches, lists and deletes a mapping", async () => {
        const created = await admin("/mappings", {
            method: "POST",
            body: JSON.stringify({
                request: { method: "GET", urlPath: "/x" },
                response: { status: 200, body: "hi" },
            }),
        });
        expect(created.status).toBe(201);
        const { id } = (await created.json()) as { id: string };

        const list = (await (await admin("/mappings")).json()) as { mappings: unknown[] };
        expect(list.mappings).toHaveLength(1);

        expect((await admin(`/mappings/${id}`)).status).toBe(200);
        expect((await admin(`/mappings/${id}`, { method: "DELETE" })).status).toBe(200);
        expect((await admin(`/mappings/${id}`)).status).toBe(404);
    });

    it("rejects invalid json and schema-invalid mappings", async () => {
        expect((await admin("/mappings", { method: "POST", body: "{not json" })).status).toBe(400);
        expect(
            (
                await admin("/mappings", {
                    method: "POST",
                    body: JSON.stringify({ request: { method: 123 } }),
                })
            ).status,
        ).toBe(400);
    });

    it("records, counts, finds and clears the request journal", async () => {
        await fetch(`${server.baseUrl}/recorded?q=1`);

        const all = (await (await admin("/requests")).json()) as { requests: unknown[] };
        expect(all.requests.length).toBeGreaterThan(0);

        const count = (await (
            await admin("/requests/count", {
                method: "POST",
                body: JSON.stringify({ urlPath: "/recorded" }),
            })
        ).json()) as { count: number };
        expect(count.count).toBe(1);

        const found = (await (
            await admin("/requests/find", {
                method: "POST",
                body: JSON.stringify({ urlPath: "/recorded" }),
            })
        ).json()) as { requests: unknown[] };
        expect(found.requests).toHaveLength(1);

        await admin("/requests", { method: "DELETE" });
        const cleared = (await (await admin("/requests")).json()) as { requests: unknown[] };
        expect(cleared.requests).toHaveLength(0);
    });

    it("resets mappings and journal together", async () => {
        await admin("/mappings", {
            method: "POST",
            body: JSON.stringify({ request: { urlPath: "/y" }, response: { status: 200 } }),
        });
        expect((await admin("/reset", { method: "POST" })).status).toBe(200);
        expect(server.listMappings()).toHaveLength(0);
    });

    it("404s an unknown admin route", async () => {
        expect((await admin("/nope")).status).toBe(404);
    });
});
