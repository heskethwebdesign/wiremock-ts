import type {
    ContentPattern,
    Fault,
    HttpMethod,
    LoggedRequest,
    RegisteredStub,
    RequestPattern,
    ResponseDefinition,
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

    // render body and header values as {{ ... }} templates when served.
    withTransform(): this {
        this.#response.transform = true;
        return this;
    }

    withFault(fault: Fault): this {
        this.#response.fault = fault;
        return this;
    }

    withProxyBaseUrl(baseUrl: string): this {
        this.#response.proxyBaseUrl = baseUrl;
        return this;
    }

    withBase64Body(base64: string): this {
        this.#response.base64Body = base64;
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
export const proxiedFrom = (baseUrl: string): ResponseBuilder =>
    new ResponseBuilder().withProxyBaseUrl(baseUrl);

// a per-request response factory for programmatic stubs (in-process only).
export type ResponseFactory = (req: LoggedRequest) => ResponseBuilder | ResponseDefinition;

// ---- mapping builder --------------------------------------------------------

export class MappingBuilder {
    #request: RequestPattern;
    #priority: number | undefined;
    #name: string | undefined;
    #scenarioName: string | undefined;
    #requiredScenarioState: string | undefined;
    #newScenarioState: string | undefined;

    constructor(method: HttpMethod, url: Partial<RequestPattern>) {
        this.#request = { method, ...url };
    }

    inScenario(name: string): this {
        this.#scenarioName = name;
        return this;
    }

    whenScenarioStateIs(state: string): this {
        this.#requiredScenarioState = state;
        return this;
    }

    willSetStateTo(state: string): this {
        this.#newScenarioState = state;
        return this;
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

    willReturn(response: ResponseBuilder | ResponseDefinition | ResponseFactory): RegisteredStub {
        const mapping: RegisteredStub = { request: this.#request, response: {} };
        if (typeof response === "function") {
            mapping.responseProvider = (req: LoggedRequest): ResponseDefinition => {
                const produced = response(req);
                return produced instanceof ResponseBuilder ? produced.build() : produced;
            };
        } else {
            mapping.response = response instanceof ResponseBuilder ? response.build() : response;
        }
        if (this.#priority !== undefined) mapping.priority = this.#priority;
        if (this.#name !== undefined) mapping.name = this.#name;
        if (this.#scenarioName !== undefined) mapping.scenarioName = this.#scenarioName;
        if (this.#requiredScenarioState !== undefined) {
            mapping.requiredScenarioState = this.#requiredScenarioState;
        }
        if (this.#newScenarioState !== undefined) mapping.newScenarioState = this.#newScenarioState;
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

// ---- request verification builders ------------------------------------------

export class RequestPatternBuilder {
    #pattern: RequestPattern;

    constructor(method: HttpMethod, url: Partial<RequestPattern>) {
        this.#pattern = { method, ...url };
    }

    withQueryParam(name: string, pattern: ContentPattern): this {
        (this.#pattern.queryParameters ??= {})[name] = pattern;
        return this;
    }

    withHeader(name: string, pattern: ContentPattern): this {
        (this.#pattern.headers ??= {})[name] = pattern;
        return this;
    }

    withRequestBody(pattern: ContentPattern): this {
        (this.#pattern.bodyPatterns ??= []).push(pattern);
        return this;
    }

    build(): RequestPattern {
        return this.#pattern;
    }
}

const requestedFor =
    (method: HttpMethod) =>
    (url: Partial<RequestPattern>): RequestPatternBuilder =>
        new RequestPatternBuilder(method, url);

export const getRequestedFor = requestedFor("GET");
export const postRequestedFor = requestedFor("POST");
export const putRequestedFor = requestedFor("PUT");
export const deleteRequestedFor = requestedFor("DELETE");
export const patchRequestedFor = requestedFor("PATCH");
export const anyRequestedFor = requestedFor("ANY");
