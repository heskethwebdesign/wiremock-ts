import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { equalToJson, get, ok, okJson, post, urlPathEqualTo, WireMockServer } from "../src/index";

let server: WireMockServer;

beforeEach(async () => {
    // port 0 lets the os pick a free ephemeral port for parallel-safe tests.
    server = await new WireMockServer({ port: 0 }).start();
});

afterEach(async () => {
    await server.stop();
});

describe("WireMockServer", () => {
    it("serves a stub registered via the fluent dsl", async () => {
        server.stubFor(get(urlPathEqualTo("/hello")).willReturn(ok("world")));

        const res = await fetch(`${server.baseUrl}/hello`);
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("world");
    });

    it("serves json bodies with a json content type", async () => {
        server.stubFor(get(urlPathEqualTo("/api/user")).willReturn(okJson({ id: 1, name: "ada" })));

        const res = await fetch(`${server.baseUrl}/api/user`);
        expect(res.headers.get("content-type")).toContain("application/json");
        expect(await res.json()).toEqual({ id: 1, name: "ada" });
    });

    it("matches on request body and records the request for verification", async () => {
        server.stubFor(
            post(urlPathEqualTo("/orders"))
                .withRequestBody(equalToJson({ sku: "abc" }))
                .willReturn(okJson({ accepted: true })),
        );

        const res = await fetch(`${server.baseUrl}/orders`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sku: "abc" }),
        });

        expect(res.status).toBe(200);
        expect(server.verify({ method: "POST", urlPath: "/orders" })).toBe(true);
        expect(server.verify({ method: "POST", urlPath: "/orders" }, 1)).toBe(true);
        expect(server.countRequests({ method: "POST", urlPath: "/nope" })).toBe(0);
    });

    it("returns 404 with diagnostics when nothing matches", async () => {
        const res = await fetch(`${server.baseUrl}/unmapped`);
        expect(res.status).toBe(404);
        const body = (await res.json()) as { error: string };
        expect(body.error).toContain("No stub mapping matched");
    });

    it("registers and resets mappings over the admin api", async () => {
        const create = await fetch(`${server.baseUrl}/__admin/mappings`, {
            method: "POST",
            body: JSON.stringify({
                request: { method: "GET", urlPath: "/admin-made" },
                response: { status: 201, body: "created-via-admin" },
            }),
        });
        expect(create.status).toBe(201);

        const hit = await fetch(`${server.baseUrl}/admin-made`);
        expect(hit.status).toBe(201);
        expect(await hit.text()).toBe("created-via-admin");

        const reset = await fetch(`${server.baseUrl}/__admin/mappings/reset`, { method: "POST" });
        expect(reset.status).toBe(200);
        expect(server.listMappings()).toHaveLength(0);

        const afterReset = await fetch(`${server.baseUrl}/admin-made`);
        expect(afterReset.status).toBe(404);
    });

    it("honours stub priority", async () => {
        server.stubFor(get(urlPathEqualTo("/p")).atPriority(10).willReturn(ok("low")));
        server.stubFor(get(urlPathEqualTo("/p")).atPriority(1).willReturn(ok("high")));

        const res = await fetch(`${server.baseUrl}/p`);
        expect(await res.text()).toBe("high");
    });
});
