import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { get, okJson, proxiedFrom, startMock, urlPathEqualTo, WireMockServer } from "../src/index";

describe("admin token", () => {
    let server: WireMockServer;
    beforeEach(async () => {
        server = await startMock({ port: 0, adminToken: "s3cret" });
    });
    afterEach(async () => {
        await server.stop();
    });

    const mapping = JSON.stringify({ request: { urlPath: "/x" }, response: { status: 200 } });

    it("rejects admin requests with no token", async () => {
        const res = await fetch(`${server.baseUrl}/__admin/mappings`, {
            method: "POST",
            body: mapping,
        });
        expect(res.status).toBe(401);
    });

    it("rejects a wrong token", async () => {
        const res = await fetch(`${server.baseUrl}/__admin/health`, {
            headers: { "x-admin-token": "nope" },
        });
        expect(res.status).toBe(401);
    });

    it("accepts the token via X-Admin-Token", async () => {
        const res = await fetch(`${server.baseUrl}/__admin/mappings`, {
            method: "POST",
            headers: { "x-admin-token": "s3cret" },
            body: mapping,
        });
        expect(res.status).toBe(201);
    });

    it("accepts the token via Authorization: Bearer", async () => {
        const res = await fetch(`${server.baseUrl}/__admin/health`, {
            headers: { authorization: "Bearer s3cret" },
        });
        expect(res.status).toBe(200);
    });

    it("does not gate normal stub traffic", async () => {
        await fetch(`${server.baseUrl}/__admin/mappings`, {
            method: "POST",
            headers: { "x-admin-token": "s3cret" },
            body: JSON.stringify({
                request: { method: "GET", urlPath: "/open" },
                response: { status: 200, body: "ok" },
            }),
        });
        expect((await fetch(`${server.baseUrl}/open`)).status).toBe(200);
    });
});

describe("proxy allowlist", () => {
    let backend: WireMockServer;
    let front: WireMockServer;
    beforeEach(async () => {
        backend = await startMock({ port: 0 });
        front = await startMock({ port: 0, allowedProxyHosts: ["127.0.0.1"] });
    });
    afterEach(async () => {
        await front.stop();
        await backend.stop();
    });

    it("allows proxying to an allowed host", async () => {
        backend.stubFor(get(urlPathEqualTo("/ok")).willReturn(okJson({ ok: true })));
        front.stubFor(get(urlPathEqualTo("/ok")).willReturn(proxiedFrom(backend.baseUrl)));

        const res = await fetch(`${front.baseUrl}/ok`);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });
    });

    it("refuses proxying to a disallowed host (e.g. metadata) with 502", async () => {
        front.stubFor(
            get(urlPathEqualTo("/evil")).willReturn(proxiedFrom("http://169.254.169.254")),
        );
        expect((await fetch(`${front.baseUrl}/evil`)).status).toBe(502);
    });

    it("refuses recording to a disallowed host", () => {
        expect(() => front.startRecording("http://169.254.169.254")).toThrow(/not allowed/);
    });
});
