import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { aResponse, get, startMock, urlPathEqualTo, WireMockServer } from "../src/index";

let server: WireMockServer;

beforeEach(async () => {
    server = await startMock({ port: 0 });
});
afterEach(async () => {
    await server.stop();
});

const consume = (url: string): Promise<string> => fetch(url).then((res) => res.text());

describe("response extras", () => {
    it("serves a base64-encoded body", async () => {
        server.stubFor(
            get(urlPathEqualTo("/img")).willReturn(
                aResponse().withStatus(200).withBase64Body(Buffer.from("hello").toString("base64")),
            ),
        );
        const res = await fetch(`${server.baseUrl}/img`);
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("hello");
    });

    it("sets a custom status message", async () => {
        server.stubFor(
            get(urlPathEqualTo("/teapot")).willReturn(
                aResponse().withStatus(418).withStatusMessage("I am a teapot"),
            ),
        );
        const res = await fetch(`${server.baseUrl}/teapot`);
        expect(res.status).toBe(418);
        expect(res.statusText).toBe("I am a teapot");
    });

    it("malformed-chunk yields an unreadable response", async () => {
        server.stubFor(
            get(urlPathEqualTo("/malformed")).willReturn(aResponse().withFault("malformed-chunk")),
        );
        await expect(consume(`${server.baseUrl}/malformed`)).rejects.toThrow();
    });

    it("random-then-close yields a network error", async () => {
        server.stubFor(
            get(urlPathEqualTo("/random")).willReturn(aResponse().withFault("random-then-close")),
        );
        await expect(consume(`${server.baseUrl}/random`)).rejects.toThrow();
    });
});
