import { z } from "zod";

// supported http methods; "ANY" matches every method.
export const HTTP_METHODS = [
    "GET",
    "POST",
    "PUT",
    "DELETE",
    "PATCH",
    "HEAD",
    "OPTIONS",
    "TRACE",
    "ANY",
] as const;

export type HttpMethod = (typeof HTTP_METHODS)[number];

// a single value matcher, modelled on wiremock content patterns. all present
// keys must be satisfied for the pattern to match.
export const contentPatternSchema = z.object({
    equalTo: z.string().optional(),
    caseInsensitive: z.boolean().optional(),
    contains: z.string().optional(),
    matches: z.string().optional(),
    doesNotMatch: z.string().optional(),
    equalToJson: z.unknown().optional(),
    ignoreArrayOrder: z.boolean().optional(),
    ignoreExtraElements: z.boolean().optional(),
    matchesJsonPath: z.string().optional(),
    absent: z.boolean().optional(),
});

export type ContentPattern = z.infer<typeof contentPatternSchema>;

export const requestPatternSchema = z.object({
    method: z.enum(HTTP_METHODS).optional(),
    url: z.string().optional(),
    urlPath: z.string().optional(),
    urlPathPattern: z.string().optional(),
    urlPattern: z.string().optional(),
    queryParameters: z.record(z.string(), contentPatternSchema).optional(),
    headers: z.record(z.string(), contentPatternSchema).optional(),
    bodyPatterns: z.array(contentPatternSchema).optional(),
});

export type RequestPattern = z.infer<typeof requestPatternSchema>;

export const responseDefinitionSchema = z.object({
    status: z.number().int().optional(),
    statusMessage: z.string().optional(),
    body: z.string().optional(),
    jsonBody: z.unknown().optional(),
    base64Body: z.string().optional(),
    headers: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
    fixedDelayMilliseconds: z.number().int().nonnegative().optional(),
});

export type ResponseDefinition = z.infer<typeof responseDefinitionSchema>;

export const stubMappingSchema = z.object({
    id: z.string().optional(),
    name: z.string().optional(),
    priority: z.number().int().optional(),
    request: requestPatternSchema,
    response: responseDefinitionSchema,
});

export type StubMapping = z.infer<typeof stubMappingSchema>;

// a request as observed by the server, used for matching and the journal.
export interface LoggedRequest {
    method: string;
    url: string;
    urlPath: string;
    query: Record<string, string[]>;
    headers: Record<string, string>;
    body: string;
    loggedAt: number;
}
