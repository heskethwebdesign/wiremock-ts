import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { get, okJson, proxiedFrom, startMock, urlPathEqualTo, WireMockServer } from "../src/index";

describe("reverse proxy", () => {
    let backend: WireMockServer;
    let front: WireMockServer;
    beforeEach(async () => {
        backend = await startMock({ port: 0 });
        front = await startMock({ port: 0 });
    });
    afterEach(async () => {
        await front.stop();
        await backend.stop();
    });

    it("forwards a matched request upstream and returns its response", async () => {
        backend.stubFor(get(urlPathEqualTo("/widgets")).willReturn(okJson({ items: [1, 2] })));
        front.stubFor(get(urlPathEqualTo("/widgets")).willReturn(proxiedFrom(backend.baseUrl)));

        const res = await fetch(`${front.baseUrl}/widgets`);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ items: [1, 2] });
    });
});

describe("record / playback", () => {
    let backend: WireMockServer;
    let recorder: WireMockServer;
    beforeEach(async () => {
        backend = await startMock({ port: 0 });
        recorder = await startMock({ port: 0 });
    });
    afterEach(async () => {
        await recorder.stop();
        await backend.stop();
    });

    it("captures upstream traffic and plays it back offline", async () => {
        backend.stubFor(get(urlPathEqualTo("/profile")).willReturn(okJson({ name: "ada" })));

        recorder.startRecording(backend.baseUrl);
        const live = await fetch(`${recorder.baseUrl}/profile`);
        expect(await live.json()).toEqual({ name: "ada" });

        const mappings = recorder.stopRecording();
        expect(mappings).toHaveLength(1);
        expect(recorder.isRecording).toBeFalsy();

        // replay: register the capture, take the backend down, serve from the recording.
        for (const mapping of mappings) recorder.stubFor(mapping);
        await backend.stop();

        const replayed = await fetch(`${recorder.baseUrl}/profile`);
        expect(replayed.status).toBe(200);
        expect(await replayed.json()).toEqual({ name: "ada" });
    });
});
