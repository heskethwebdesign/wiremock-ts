import { afterEach, describe, expect, it } from "vitest";

import { get, getRequestedFor, okJson, urlPathEqualTo, WireMockServer } from "../src/index";

let active: WireMockServer | undefined;

afterEach(() => {
    active?.restoreFetch();
    active = undefined;
});

describe("fetch interception", () => {
    it("serves stubs in-process without opening a socket", async () => {
        const wm = new WireMockServer(); // note: never started
        active = wm;
        wm.stubFor(get(urlPathEqualTo("/api/ping")).willReturn(okJson({ pong: true })));
        wm.interceptFetch();

        const res = await fetch("https://example.test/api/ping");
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ pong: true });
        expect(wm.verify(getRequestedFor(urlPathEqualTo("/api/ping")), 1)).toBeTruthy();
    });

    it("passes unmatched requests through to the real fetch by default", async () => {
        const wm = new WireMockServer();
        active = wm;
        wm.stubFor(get(urlPathEqualTo("/known")).willReturn(okJson({ ok: true })));
        wm.interceptFetch();

        expect((await fetch("http://localhost/known")).status).toBe(200);
        // unmatched -> real fetch to a refused port -> rejects
        await expect(fetch("http://127.0.0.1:1/nope")).rejects.toThrow();
    });

    it("returns 404 for unmatched requests when passthrough is disabled", async () => {
        const wm = new WireMockServer();
        active = wm;
        wm.interceptFetch({ passthrough: false });

        const res = await fetch("http://anything.test/whatever");
        expect(res.status).toBe(404);
    });
});
