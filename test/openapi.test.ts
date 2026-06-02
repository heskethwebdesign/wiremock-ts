import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
    generateSample,
    startMock,
    stubsFromOpenApi,
    WireMockServer,
    type OpenApiDocument,
} from "../src/index";

const spec: OpenApiDocument = {
    paths: {
        "/users": {
            get: {
                responses: {
                    "200": {
                        content: {
                            "application/json": {
                                schema: {
                                    type: "array",
                                    items: { $ref: "#/components/schemas/User" },
                                },
                            },
                        },
                    },
                },
            },
            post: {
                responses: {
                    "201": {
                        content: {
                            "application/json": { schema: { $ref: "#/components/schemas/User" } },
                        },
                    },
                },
            },
        },
        "/users/{id}": {
            get: {
                responses: {
                    "200": {
                        content: {
                            "application/json": { schema: { $ref: "#/components/schemas/User" } },
                        },
                    },
                },
            },
        },
    },
    components: {
        schemas: {
            User: {
                type: "object",
                properties: {
                    id: { type: "integer" },
                    name: { type: "string" },
                    email: { type: "string", format: "email" },
                    active: { type: "boolean" },
                },
            },
        },
    },
};

const USER_SAMPLE = { id: 0, name: "string", email: "user@example.com", active: true };

describe("stubsFromOpenApi", () => {
    it("generates one stub per operation", () => {
        expect(stubsFromOpenApi(spec)).toHaveLength(3);
    });
});

describe("generateSample", () => {
    it("builds schema-shaped data with format-aware strings, resolving $refs", () => {
        expect(generateSample({ $ref: "#/components/schemas/User" }, spec)).toEqual(USER_SAMPLE);
    });
});

describe("loadOpenApi (live)", () => {
    let server: WireMockServer;
    beforeEach(async () => {
        server = await startMock({ port: 0 });
    });
    afterEach(async () => {
        await server.stop();
    });

    it("serves generated responses, including templated paths", async () => {
        server.loadOpenApi(spec);

        const list = await fetch(`${server.baseUrl}/users`);
        expect(list.status).toBe(200);
        expect(await list.json()).toEqual([USER_SAMPLE]);

        const one = await fetch(`${server.baseUrl}/users/42`);
        expect(one.status).toBe(200);
        expect(await one.json()).toEqual(USER_SAMPLE);

        const created = await fetch(`${server.baseUrl}/users`, { method: "POST", body: "{}" });
        expect(created.status).toBe(201);
    });
});
