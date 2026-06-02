import { describe, expect, it } from "vitest";

import {
    absent,
    any,
    anyUrl,
    aResponse,
    containing,
    created,
    del,
    deleteRequestedFor,
    equalTo,
    equalToJson,
    get,
    getRequestedFor,
    head,
    matching,
    matchingJsonPath,
    noContent,
    notFound,
    notMatching,
    ok,
    okJson,
    options,
    patch,
    post,
    proxiedFrom,
    put,
    status,
    urlEqualTo,
    urlMatching,
    urlPathMatching,
} from "../src/index";

describe("response builders", () => {
    it("set the expected status and shape", () => {
        expect(ok().build().status).toBe(200);
        expect(okJson({ a: 1 }).build()).toEqual({ status: 200, jsonBody: { a: 1 } });
        expect(created("x").build()).toEqual({ status: 201, body: "x" });
        expect(noContent().build().status).toBe(204);
        expect(notFound().build().status).toBe(404);
        expect(status(503).build().status).toBe(503);
        expect(proxiedFrom("http://up").build().proxyBaseUrl).toBe("http://up");
        expect(aResponse().withHeader("x", "y").withFixedDelay(5).build()).toEqual({
            headers: { x: "y" },
            fixedDelayMilliseconds: 5,
        });
    });
});

describe("value matchers", () => {
    it("produce the expected content patterns", () => {
        expect(equalTo("a")).toEqual({ equalTo: "a" });
        expect(equalTo("a", true)).toEqual({ equalTo: "a", caseInsensitive: true });
        expect(containing("b")).toEqual({ contains: "b" });
        expect(matching("^c")).toEqual({ matches: "^c" });
        expect(notMatching("^c")).toEqual({ doesNotMatch: "^c" });
        expect(equalToJson({ a: 1 }, { ignoreArrayOrder: true })).toEqual({
            equalToJson: { a: 1 },
            ignoreArrayOrder: true,
        });
        expect(matchingJsonPath("$.a")).toEqual({ matchesJsonPath: "$.a" });
        expect(absent()).toEqual({ absent: true });
    });
});

describe("mapping + request builders", () => {
    it("assemble request patterns across methods and url matchers", () => {
        const mapping = post(urlEqualTo("/p"))
            .withName("n")
            .atPriority(3)
            .withHeader("h", equalTo("v"))
            .withQueryParam("q", equalTo("1"))
            .withRequestBody(containing("x"))
            .willReturn(ok());
        expect(mapping.request).toEqual({
            method: "POST",
            url: "/p",
            headers: { h: { equalTo: "v" } },
            queryParameters: { q: { equalTo: "1" } },
            bodyPatterns: [{ contains: "x" }],
        });
        expect(mapping.priority).toBe(3);
        expect(mapping.name).toBe("n");

        expect(get(urlMatching("^/a")).willReturn(ok()).request).toEqual({
            method: "GET",
            urlPattern: "^/a",
        });
        expect(put(urlPathMatching("^/b")).willReturn(ok()).request.urlPathPattern).toBe("^/b");
        expect(del(anyUrl()).willReturn(ok()).request).toEqual({ method: "DELETE" });
        expect(patch(urlEqualTo("/c")).willReturn(ok()).request.method).toBe("PATCH");
        expect(head(anyUrl()).willReturn(ok()).request.method).toBe("HEAD");
        expect(options(anyUrl()).willReturn(ok()).request.method).toBe("OPTIONS");
        expect(any(anyUrl()).willReturn(ok()).request.method).toBe("ANY");

        expect(
            getRequestedFor(urlPathMatching("^/x")).withHeader("a", equalTo("b")).build(),
        ).toEqual({
            method: "GET",
            urlPathPattern: "^/x",
            headers: { a: { equalTo: "b" } },
        });
        expect(deleteRequestedFor(anyUrl()).build().method).toBe("DELETE");
    });
});
