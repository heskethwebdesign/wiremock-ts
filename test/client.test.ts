import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
    connectMock,
    get,
    getRequestedFor,
    okJson,
    startMock,
    urlPathEqualTo,
    WireMockClient,
    WireMockServer,
} from "../src/index";

describe("remote client", () => {
    let server: WireMockServer;
    let client: WireMockClient;

    beforeEach(async () => {
        server = await startMock({ port: 0 });
        client = connectMock(server.baseUrl);
    });
    afterEach(async () => {
        await server.stop();
    });

    it("registers a stub over the admin api", async () => {
        await client.stubFor(get(urlPathEqualTo("/ping")).willReturn(okJson({ pong: true })));
        const res = await fetch(`${server.baseUrl}/ping`);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ pong: true });
    });

    it("lists mappings", async () => {
        await client.stubFor(get(urlPathEqualTo("/a")).willReturn(okJson({})));
        expect(await client.listMappings()).toHaveLength(1);
    });

    it("counts and finds recorded requests", async () => {
        await client.stubFor(get(urlPathEqualTo("/hit")).willReturn(okJson({})));
        await fetch(`${server.baseUrl}/hit`);
        await fetch(`${server.baseUrl}/hit`);
        expect(await client.countRequests(getRequestedFor(urlPathEqualTo("/hit")))).toBe(2);
        expect(await client.findRequests(getRequestedFor(urlPathEqualTo("/hit")))).toHaveLength(2);
        expect(await client.verify(getRequestedFor(urlPathEqualTo("/hit")), 2)).toBe(true);
    });

    it("resets requests and mappings", async () => {
        await client.stubFor(get(urlPathEqualTo("/x")).willReturn(okJson({})));
        await fetch(`${server.baseUrl}/x`);
        await client.resetRequests();
        expect(await client.countRequests(getRequestedFor(urlPathEqualTo("/x")))).toBe(0);
        await client.resetMappings();
        expect(await client.listMappings()).toHaveLength(0);
    });

    it("refuses to register a programmatic response provider", async () => {
        const stub = get(urlPathEqualTo("/dyn")).willReturn(() => okJson({ dynamic: true }));
        await expect(client.register(stub)).rejects.toThrow(/programmatic/);
    });

    it("exposes a trailing-slash-trimmed base url", () => {
        expect(connectMock(`${server.baseUrl}/`).baseUrl).toBe(server.baseUrl);
    });

    it("asserts a request was received", async () => {
        await client.stubFor(get(urlPathEqualTo("/seen")).willReturn(okJson({})));
        await fetch(`${server.baseUrl}/seen`);
        await expect(
            client.assertReceived(getRequestedFor(urlPathEqualTo("/seen"))),
        ).resolves.toBeUndefined();
        await expect(
            client.assertReceived(getRequestedFor(urlPathEqualTo("/seen")), 5),
        ).rejects.toThrow(/expected/);
    });

    it("resets everything at once", async () => {
        await client.stubFor(get(urlPathEqualTo("/all")).willReturn(okJson({})));
        await fetch(`${server.baseUrl}/all`);
        await client.resetAll();
        expect(await client.listMappings()).toHaveLength(0);
        expect(await client.countRequests(getRequestedFor(urlPathEqualTo("/all")))).toBe(0);
    });
});

describe("remote client with admin token", () => {
    let server: WireMockServer;

    beforeEach(async () => {
        server = await startMock({ port: 0, adminToken: "s3cret" });
    });
    afterEach(async () => {
        await server.stop();
    });

    it("authenticates when given the token", async () => {
        const client = connectMock(server.baseUrl, { adminToken: "s3cret" });
        await client.stubFor(get(urlPathEqualTo("/auth")).willReturn(okJson({ ok: true })));
        expect((await fetch(`${server.baseUrl}/auth`)).status).toBe(200);
    });

    it("fails without the token", async () => {
        const client = connectMock(server.baseUrl);
        await expect(
            client.stubFor(get(urlPathEqualTo("/auth")).willReturn(okJson({ ok: true }))),
        ).rejects.toThrow(/401/);
    });
});
