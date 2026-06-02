import { randomUUID } from "node:crypto";

import type {
    LoggedRequest,
    RegisteredStub,
    RequestPattern,
    ResponseDefinition,
    ResponseProvider,
} from "../types";
import {
    compileRequestBodyValidators,
    validateRequestBody,
    type BodyValidator,
} from "./validation";

// a deliberately small structural view of the parts of an openapi 3 document
// we read; callers pass their already-parsed spec.
export interface OpenApiSchema {
    $ref?: string;
    type?: string;
    format?: string;
    enum?: unknown[];
    example?: unknown;
    default?: unknown;
    items?: OpenApiSchema;
    properties?: Record<string, OpenApiSchema>;
    required?: string[];
}

interface OpenApiMediaType {
    schema?: OpenApiSchema;
    example?: unknown;
}

interface OpenApiResponse {
    content?: Record<string, OpenApiMediaType>;
}

interface OpenApiRequestBody {
    required?: boolean;
    content?: Record<string, OpenApiMediaType>;
}

interface OpenApiOperation {
    responses?: Record<string, OpenApiResponse>;
    requestBody?: OpenApiRequestBody;
}

export interface OpenApiDocument {
    paths?: Record<string, Record<string, OpenApiOperation>>;
    components?: { schemas?: Record<string, OpenApiSchema> };
}

const METHODS = ["get", "post", "put", "delete", "patch", "head", "options"] as const;

const MAX_DEPTH = 8;

const resolveRef = (ref: string, doc: OpenApiDocument): OpenApiSchema | undefined => {
    const name = ref.replace("#/components/schemas/", "");
    return doc.components?.schemas?.[name];
};

const sampleString = (format: string | undefined): string => {
    switch (format) {
        case "date-time":
            return new Date().toISOString();
        case "date":
            return new Date().toISOString().slice(0, 10);
        case "uuid":
            return randomUUID();
        case "email":
            return "user@example.com";
        case "uri":
            return "https://example.com";
        default:
            return "string";
    }
};

// produce a representative value for a json schema, resolving local $refs.
export const generateSample = (schema: OpenApiSchema, doc: OpenApiDocument, depth = 0): unknown => {
    if (depth > MAX_DEPTH) return null;

    if (schema.$ref !== undefined) {
        const resolved = resolveRef(schema.$ref, doc);
        return resolved ? generateSample(resolved, doc, depth + 1) : null;
    }
    if (schema.example !== undefined) return schema.example;
    if (schema.default !== undefined) return schema.default;
    if (schema.enum !== undefined && schema.enum.length > 0) return schema.enum[0];

    switch (schema.type) {
        case "object": {
            const out: Record<string, unknown> = {};
            for (const [key, propSchema] of Object.entries(schema.properties ?? {})) {
                out[key] = generateSample(propSchema, doc, depth + 1);
            }
            return out;
        }
        case "array":
            return schema.items ? [generateSample(schema.items, doc, depth + 1)] : [];
        case "string":
            return sampleString(schema.format);
        case "integer":
        case "number":
            return 0;
        case "boolean":
            return true;
        default:
            return schema.properties
                ? generateSample({ ...schema, type: "object" }, doc, depth)
                : null;
    }
};

// openapi path templates ("/users/{id}") become a regex urlPathPattern; static
// paths use an exact urlPath.
const toUrlMatcher = (path: string): Partial<RequestPattern> => {
    if (!path.includes("{")) return { urlPath: path };
    const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\{[^}]+\\\}/g, "[^/]+");
    return { urlPathPattern: `^${escaped}$` };
};

const pickResponse = (
    responses: Record<string, OpenApiResponse>,
): { status: number; response: OpenApiResponse } | undefined => {
    const codes = Object.keys(responses);
    const chosen =
        codes.find((c) => /^2\d\d$/.test(c)) ?? (codes.includes("default") ? "default" : codes[0]);
    if (chosen === undefined) return undefined;
    const response = responses[chosen];
    if (response === undefined) return undefined;
    const status = chosen === "default" ? 200 : Number.parseInt(chosen, 10) || 200;
    return { status, response };
};

export interface StubsFromOpenApiOptions {
    // when true, operations with a request body schema validate incoming
    // bodies and answer 400 with the violations when they do not conform.
    validateRequests?: boolean;
}

// a stub whose response is gated by request-body validation: a conforming
// body gets the schema-generated success response, a non-conforming one a 400.
const validatingResponse =
    (validator: BodyValidator, success: ResponseDefinition): ResponseProvider =>
    (req: LoggedRequest): ResponseDefinition => {
        const result = validateRequestBody(validator, req.body);
        return result.ok
            ? success
            : {
                  status: 400,
                  jsonBody: {
                      error: "Request body failed schema validation",
                      errors: result.errors,
                  },
              };
    };

// turn an openapi document into ready-to-serve stub mappings, one per
// operation, returning schema-generated json bodies. with validateRequests,
// operations that declare a request body schema reject non-conforming bodies.
export const stubsFromOpenApi = (
    doc: OpenApiDocument,
    options: StubsFromOpenApiOptions = {},
): RegisteredStub[] => {
    const validators = options.validateRequests ? compileRequestBodyValidators(doc) : undefined;
    const stubs: RegisteredStub[] = [];
    for (const [path, item] of Object.entries(doc.paths ?? {})) {
        for (const method of METHODS) {
            const operation = item[method];
            if (operation?.responses === undefined) continue;
            const picked = pickResponse(operation.responses);
            if (picked === undefined) continue;

            const media = picked.response.content?.["application/json"];
            const body =
                media?.example !== undefined
                    ? media.example
                    : media?.schema
                      ? generateSample(media.schema, doc)
                      : undefined;

            const request = {
                method: method.toUpperCase() as RequestPattern["method"],
                ...toUrlMatcher(path),
            };
            const success: ResponseDefinition = {
                status: picked.status,
                ...(body === undefined ? {} : { jsonBody: body }),
            };
            const validator = validators?.get(`${method.toUpperCase()} ${path}`);
            if (validator) {
                stubs.push({
                    request,
                    response: {},
                    responseProvider: validatingResponse(validator, success),
                });
            } else {
                stubs.push({ request, response: success });
            }
        }
    }
    return stubs;
};
