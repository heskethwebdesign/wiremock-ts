import type {
    ContentPattern,
    HttpMethod,
    RequestPattern,
    ResponseDefinition,
    StubMapping,
} from "../types";

// ---- url matchers -----------------------------------------------------------

export const urlEqualTo = (url: string): Partial<RequestPattern> => ({ url });
export const urlPathEqualTo = (urlPath: string): Partial<RequestPattern> => ({ urlPath });
export const urlMatching = (urlPattern: string): Partial<RequestPattern> => ({ urlPattern });
export const urlPathMatching = (urlPathPattern: string): Partial<RequestPattern> => ({
    urlPathPattern,
});
export const anyUrl = (): Partial<RequestPattern> => ({});

// ---- value matchers ---------------------------------------------------------

export const equalTo = (value: string, caseInsensitive = false): ContentPattern =>
    caseInsensitive ? { equalTo: value, caseInsensitive: true } : { equalTo: value };
export const containing = (value: string): ContentPattern => ({ contains: value });
export const matching = (pattern: string): ContentPattern => ({ matches: pattern });
export const notMatching = (pattern: string): ContentPattern => ({ doesNotMatch: pattern });
export const equalToJson = (
    json: unknown,
    options?: { ignoreArrayOrder?: boolean; ignoreExtraElements?: boolean },
): ContentPattern => ({ equalToJson: json, ...options });
export const matchingJsonPath = (expression: string): ContentPattern => ({
    matchesJsonPath: expression,
});
export const absent = (): ContentPattern => ({ absent: true });

// ---- response builder -------------------------------------------------------

export class ResponseBuilder {
    #response: ResponseDefinition = {};

    withStatus(status: number): this {
        this.#response.status = status;
        return this;
    }

    withStatusMessage(message: string): this {
        this.#response.statusMessage = message;
        return this;
    }

    withBody(body: string): this {
        this.#response.body = body;
        return this;
    }

    withJsonBody(json: unknown): this {
        this.#response.jsonBody = json;
        return this;
    }

    withHeader(name: string, value: string | string[]): this {
        (this.#response.headers ??= {})[name] = value;
        return this;
    }

    withFixedDelay(milliseconds: number): this {
        this.#response.fixedDelayMilliseconds = milliseconds;
        return this;
    }

    build(): ResponseDefinition {
        return { ...this.#response };
    }
}

export const aResponse = (): ResponseBuilder => new ResponseBuilder();
export const status = (code: number): ResponseBuilder => new ResponseBuilder().withStatus(code);
export const ok = (body?: string): ResponseBuilder => {
    const builder = new ResponseBuilder().withStatus(200);
    return body === undefined ? builder : builder.withBody(body);
};
export const okJson = (json: unknown): ResponseBuilder =>
    new ResponseBuilder().withStatus(200).withJsonBody(json);
export const created = (body?: string): ResponseBuilder => {
    const builder = new ResponseBuilder().withStatus(201);
    return body === undefined ? builder : builder.withBody(body);
};
export const noContent = (): ResponseBuilder => new ResponseBuilder().withStatus(204);
export const notFound = (body?: string): ResponseBuilder => {
    const builder = new ResponseBuilder().withStatus(404);
    return body === undefined ? builder : builder.withBody(body);
};

// ---- mapping builder --------------------------------------------------------

export class MappingBuilder {
    #request: RequestPattern;
    #priority: number | undefined;
    #name: string | undefined;

    constructor(method: HttpMethod, url: Partial<RequestPattern>) {
        this.#request = { method, ...url };
    }

    withQueryParam(name: string, pattern: ContentPattern): this {
        (this.#request.queryParameters ??= {})[name] = pattern;
        return this;
    }

    withHeader(name: string, pattern: ContentPattern): this {
        (this.#request.headers ??= {})[name] = pattern;
        return this;
    }

    withRequestBody(pattern: ContentPattern): this {
        (this.#request.bodyPatterns ??= []).push(pattern);
        return this;
    }

    atPriority(priority: number): this {
        this.#priority = priority;
        return this;
    }

    withName(name: string): this {
        this.#name = name;
        return this;
    }

    willReturn(response: ResponseBuilder | ResponseDefinition): StubMapping {
        const definition = response instanceof ResponseBuilder ? response.build() : response;
        const mapping: StubMapping = { request: this.#request, response: definition };
        if (this.#priority !== undefined) mapping.priority = this.#priority;
        if (this.#name !== undefined) mapping.name = this.#name;
        return mapping;
    }
}

const forMethod =
    (method: HttpMethod) =>
    (url: Partial<RequestPattern>): MappingBuilder =>
        new MappingBuilder(method, url);

export const get = forMethod("GET");
export const post = forMethod("POST");
export const put = forMethod("PUT");
export const del = forMethod("DELETE");
export const patch = forMethod("PATCH");
export const head = forMethod("HEAD");
export const options = forMethod("OPTIONS");
export const any = forMethod("ANY");
