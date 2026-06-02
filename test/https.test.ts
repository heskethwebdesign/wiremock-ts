import { request } from "node:https";

import { generate } from "selfsigned";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { get, okJson, startMock, urlPathEqualTo, WireMockServer } from "../src/index";

// drives an https endpoint without verifying the self-signed cert, so the
// test exercises the tls path without trusting a throwaway certificate.
function httpsGet(url: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const req = request(url, { rejectUnauthorized: false }, (res) => {
            let body = "";
            res.setEncoding("utf8");
            res.on("data", (chunk: string) => (body += chunk));
            res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
        });
        req.on("error", reject);
        req.end();
    });
}

describe("https", () => {
    let server: WireMockServer;

    beforeEach(async () => {
        const pems = await generate([{ name: "commonName", value: "localhost" }], {
            keySize: 2048,
        });
        server = await startMock({ port: 0, https: { key: pems.private, cert: pems.cert } });
    });
    afterEach(async () => {
        await server.stop();
    });

    it("reports an https base url", () => {
        expect(server.baseUrl.startsWith("https://")).toBe(true);
    });

    it("serves a stub over tls", async () => {
        server.stubFor(get(urlPathEqualTo("/secure")).willReturn(okJson({ ok: true })));
        const res = await httpsGet(`${server.baseUrl}/secure`);
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ ok: true });
    });

    it("serves the admin api over tls", async () => {
        const res = await httpsGet(`${server.baseUrl}/__admin/health`);
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toMatchObject({ status: "ok" });
    });
});
