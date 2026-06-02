import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { startMock, WireMockServer, type OpenApiDocument } from "../src/index";

const doc: OpenApiDocument = {
    paths: {
        "/users": {
            post: {
                requestBody: {
                    required: true,
                    content: {
                        "application/json": { schema: { $ref: "#/components/schemas/NewUser" } },
                    },
                },
                responses: {
                    "201": {
                        content: {
                            "application/json": { example: { id: "u1", name: "Ada" } },
                        },
                    },
                },
            },
        },
        "/health": {
            get: {
                responses: {
                    "200": { content: { "application/json": { example: { ok: true } } } },
                },
            },
        },
    },
    components: {
        schemas: {
            NewUser: {
                type: "object",
                required: ["name", "age"],
                properties: {
                    name: { type: "string" },
                    age: { type: "integer" },
                },
            },
        },
    },
};

let server: WireMockServer;

beforeEach(async () => {
    server = await startMock({ port: 0 });
});
afterEach(async () => {
    await server.stop();
});

const postUser = (body: string): Promise<Response> =>
    fetch(`${server.baseUrl}/users`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
    });

describe("openapi request validation", () => {
    it("accepts a conforming body and serves the success response", async () => {
        server.loadOpenApi(doc, { validateRequests: true });
        const res = await postUser(JSON.stringify({ name: "Ada", age: 36 }));
        expect(res.status).toBe(201);
        expect(await res.json()).toEqual({ id: "u1", name: "Ada" });
    });

    it("rejects a body missing a required field with 400 and details", async () => {
        server.loadOpenApi(doc, { validateRequests: true });
        const res = await postUser(JSON.stringify({ name: "Ada" }));
        expect(res.status).toBe(400);
        const payload = (await res.json()) as { error: string; errors: string[] };
        expect(payload.error).toMatch(/schema validation/i);
        expect(payload.errors.join(" ")).toMatch(/age/);
    });

    it("rejects a body with a wrong field type", async () => {
        server.loadOpenApi(doc, { validateRequests: true });
        const res = await postUser(JSON.stringify({ name: "Ada", age: "old" }));
        expect(res.status).toBe(400);
        const payload = (await res.json()) as { errors: string[] };
        expect(payload.errors.join(" ")).toMatch(/integer/);
    });

    it("rejects a missing required body", async () => {
        server.loadOpenApi(doc, { validateRequests: true });
        const res = await postUser("");
        expect(res.status).toBe(400);
    });

    it("rejects invalid json", async () => {
        server.loadOpenApi(doc, { validateRequests: true });
        const res = await postUser("{not json");
        expect(res.status).toBe(400);
    });

    it("does not validate when the option is off", async () => {
        server.loadOpenApi(doc);
        const res = await postUser(JSON.stringify({ name: "Ada" }));
        expect(res.status).toBe(201);
    });

    it("leaves operations without a request body untouched", async () => {
        server.loadOpenApi(doc, { validateRequests: true });
        const res = await fetch(`${server.baseUrl}/health`);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });
    });
});
