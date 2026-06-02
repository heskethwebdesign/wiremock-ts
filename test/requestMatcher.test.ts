import { describe, expect, it } from "vitest";

import { requestMatches } from "../src/matching/requestMatcher";
import type { LoggedRequest } from "../src/types";

const req = (over: Partial<LoggedRequest> = {}): LoggedRequest => ({
    method: "GET",
    url: "/things",
    urlPath: "/things",
    query: {},
    headers: {},
    body: "",
    loggedAt: 0,
    ...over,
});

describe("requestMatches", () => {
    it("matches an empty pattern against any request", () => {
        expect(requestMatches({}, req())).toBe(true);
    });

    it("matches method and treats ANY as a wildcard", () => {
        expect(requestMatches({ method: "GET" }, req({ method: "GET" }))).toBe(true);
        expect(requestMatches({ method: "POST" }, req({ method: "GET" }))).toBe(false);
        expect(requestMatches({ method: "ANY" }, req({ method: "DELETE" }))).toBe(true);
    });

    it("matches url variants", () => {
        expect(requestMatches({ urlPath: "/things" }, req())).toBe(true);
        expect(requestMatches({ urlPathPattern: "^/th.*" }, req())).toBe(true);
        expect(requestMatches({ url: "/things?page=2" }, req({ url: "/things?page=2" }))).toBe(
            true,
        );
        expect(requestMatches({ urlPath: "/other" }, req())).toBe(false);
    });

    it("matches query parameters and headers", () => {
        const request = req({
            query: { page: ["2"] },
            headers: { "x-api-key": "secret" },
        });
        expect(requestMatches({ queryParameters: { page: { equalTo: "2" } } }, request)).toBe(true);
        expect(requestMatches({ headers: { "X-Api-Key": { equalTo: "secret" } } }, request)).toBe(
            true,
        );
        expect(requestMatches({ queryParameters: { page: { equalTo: "3" } } }, request)).toBe(
            false,
        );
    });

    it("matches request bodies", () => {
        const request = req({ method: "POST", body: JSON.stringify({ id: 7 }) });
        expect(
            requestMatches({ method: "POST", bodyPatterns: [{ equalToJson: { id: 7 } }] }, request),
        ).toBe(true);
        expect(
            requestMatches({ method: "POST", bodyPatterns: [{ equalToJson: { id: 8 } }] }, request),
        ).toBe(false);
    });
});
