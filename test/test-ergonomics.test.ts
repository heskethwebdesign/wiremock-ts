import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
    get,
    getRequestedFor,
    ok,
    post,
    postRequestedFor,
    startMock,
    urlPathEqualTo,
    WireMockServer,
} from "../src/index";

describe("programmatic responses", () => {
    let server: WireMockServer;
    beforeEach(async () => {
        server = await startMock({ port: 0 });
    });
    afterEach(async () => {
        await server.stop();
    });

    it("computes the response from the request", async () => {
        server.stubFor(
            get(urlPathEqualTo("/whoami")).willReturn((req) =>
                ok(`path=${req.urlPath} m=${req.method}`),
            ),
        );
        const res = await fetch(`${server.baseUrl}/whoami`);
        expect(await res.text()).toBe("path=/whoami m=GET");
    });

    it("accepts a plain response definition from the factory", async () => {
        server.stubFor(
            get(urlPathEqualTo("/teapot")).willReturn(() => ({ status: 418, body: "teapot" })),
        );
        const res = await fetch(`${server.baseUrl}/teapot`);
        expect(res.status).toBe(418);
        expect(await res.text()).toBe("teapot");
    });
});

describe("verification builders + assertReceived", () => {
    let server: WireMockServer;
    beforeEach(async () => {
        server = await startMock({ port: 0 });
    });
    afterEach(async () => {
        await server.stop();
    });

    it("verifies via request-pattern builders", async () => {
        server.stubFor(post(urlPathEqualTo("/orders")).willReturn(ok()));
        await fetch(`${server.baseUrl}/orders`, { method: "POST", body: "x" });

        expect(server.verify(postRequestedFor(urlPathEqualTo("/orders")), 1)).toBe(true);
        expect(() =>
            server.assertReceived(postRequestedFor(urlPathEqualTo("/orders")), 1),
        ).not.toThrow();
        expect(() => server.assertReceived(getRequestedFor(urlPathEqualTo("/orders")))).toThrow(
            /received 0/,
        );
    });
});

describe("await using auto-cleanup", () => {
    it("stops the server when the scope exits", async () => {
        let baseUrl: string;
        {
            await using server = await startMock({ port: 0 });
            baseUrl = server.baseUrl;
            server.stubFor(get(urlPathEqualTo("/x")).willReturn(ok("y")));
            expect((await fetch(`${baseUrl}/x`)).status).toBe(200);
        }
        await expect(fetch(`${baseUrl}/x`)).rejects.toThrow();
    });
});
