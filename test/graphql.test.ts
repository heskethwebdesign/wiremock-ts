import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
    graphQlRequest,
    graphQlRequestedFor,
    okJson,
    startMock,
    WireMockServer,
} from "../src/index";

let server: WireMockServer;

beforeEach(async () => {
    server = await startMock({ port: 0 });
});
afterEach(async () => {
    await server.stop();
});

const postGraphQl = (body: unknown, path = "/graphql"): Promise<Response> =>
    fetch(`${server.baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });

describe("graphql stubbing", () => {
    it("matches a named operation", async () => {
        server.stubFor(graphQlRequest("GetUser").willReturn(okJson({ data: { user: { id: 1 } } })));
        const res = await postGraphQl({
            query: "query GetUser { user { id } }",
            operationName: "GetUser",
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ data: { user: { id: 1 } } });
    });

    it("does not match a different operation", async () => {
        server.stubFor(graphQlRequest("GetUser").willReturn(okJson({ data: {} })));
        const res = await postGraphQl({
            query: "query GetPost { post { id } }",
            operationName: "GetPost",
        });
        expect(res.status).toBe(404);
    });

    it("can require a substring of the query", async () => {
        server.stubFor(
            graphQlRequest("Search", { queryContains: "first: 10" }).willReturn(
                okJson({ data: { search: [] } }),
            ),
        );
        const miss = await postGraphQl({
            query: "query Search { search(first: 5) { id } }",
            operationName: "Search",
        });
        expect(miss.status).toBe(404);
        const hit = await postGraphQl({
            query: "query Search { search(first: 10) { id } }",
            operationName: "Search",
        });
        expect(hit.status).toBe(200);
    });

    it("serves on a custom path", async () => {
        server.stubFor(
            graphQlRequest("Ping", { path: "/api/graphql" }).willReturn(okJson({ data: "pong" })),
        );
        const res = await postGraphQl(
            { query: "query Ping { ping }", operationName: "Ping" },
            "/api/graphql",
        );
        expect(res.status).toBe(200);
    });

    it("verifies a graphql operation was called", async () => {
        server.stubFor(graphQlRequest("GetUser").willReturn(okJson({ data: {} })));
        await postGraphQl({ query: "query GetUser { user { id } }", operationName: "GetUser" });
        expect(server.verify(graphQlRequestedFor("GetUser"))).toBe(true);
        expect(server.verify(graphQlRequestedFor("GetPost"))).toBe(false);
    });

    it("verifies with a query substring", async () => {
        server.stubFor(graphQlRequest("Search").willReturn(okJson({ data: {} })));
        await postGraphQl({
            query: "query Search { search(first: 10) { id } }",
            operationName: "Search",
        });
        expect(server.verify(graphQlRequestedFor("Search", { queryContains: "first: 10" }))).toBe(
            true,
        );
        expect(server.verify(graphQlRequestedFor("Search", { queryContains: "last: 10" }))).toBe(
            false,
        );
    });
});
