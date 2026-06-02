import type { RequestPatternBuilder } from "../dsl/builders";
import type { LoggedRequest, RegisteredStub, RequestPattern, StubMapping } from "../types";

export interface WireMockClientOptions {
    // sent as both `x-admin-token` and `authorization: bearer` on every admin call.
    adminToken?: string;
    // override the fetch implementation; defaults to the global fetch.
    fetch?: typeof fetch;
}

const toPattern = (pattern: RequestPattern | RequestPatternBuilder): RequestPattern =>
    "build" in pattern ? pattern.build() : pattern;

// a thin client for driving a running wiremock-ts server over its admin api.
// it mirrors the in-process verification surface, so the same dsl builders
// register stubs and assert requests against a remote instance.
export class WireMockClient {
    readonly #baseUrl: string;
    readonly #adminToken: string | undefined;
    readonly #fetch: typeof fetch;

    constructor(baseUrl: string, options: WireMockClientOptions = {}) {
        this.#baseUrl = baseUrl.replace(/\/+$/, "");
        this.#adminToken = options.adminToken;
        this.#fetch = options.fetch ?? globalThis.fetch;
    }

    get baseUrl(): string {
        return this.#baseUrl;
    }

    async #admin(method: string, path: string, body?: unknown): Promise<unknown> {
        const headers: Record<string, string> = {};
        if (body !== undefined) headers["content-type"] = "application/json";
        if (this.#adminToken !== undefined) headers["x-admin-token"] = this.#adminToken;
        const res = await this.#fetch(`${this.#baseUrl}/__admin${path}`, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await res.text();
        if (!res.ok) {
            throw new Error(`admin ${method} ${path} failed: ${res.status} ${text}`);
        }
        return text.length === 0 ? undefined : JSON.parse(text);
    }

    async register(mapping: RegisteredStub): Promise<StubMapping> {
        if (typeof mapping.responseProvider === "function") {
            throw new Error(
                "a programmatic responseProvider cannot run on a remote server; register a static response instead",
            );
        }
        return (await this.#admin("POST", "/mappings", mapping)) as StubMapping;
    }

    stubFor(mapping: RegisteredStub): Promise<StubMapping> {
        return this.register(mapping);
    }

    async listMappings(): Promise<StubMapping[]> {
        const body = (await this.#admin("GET", "/mappings")) as { mappings: StubMapping[] };
        return body.mappings;
    }

    async countRequests(pattern: RequestPattern | RequestPatternBuilder): Promise<number> {
        const body = (await this.#admin("POST", "/requests/count", toPattern(pattern))) as {
            count: number;
        };
        return body.count;
    }

    async findRequests(pattern: RequestPattern | RequestPatternBuilder): Promise<LoggedRequest[]> {
        const body = (await this.#admin("POST", "/requests/find", toPattern(pattern))) as {
            requests: LoggedRequest[];
        };
        return body.requests;
    }

    async verify(
        pattern: RequestPattern | RequestPatternBuilder,
        count?: number,
    ): Promise<boolean> {
        const actual = await this.countRequests(pattern);
        return count === undefined ? actual > 0 : actual === count;
    }

    async assertReceived(
        pattern: RequestPattern | RequestPatternBuilder,
        count?: number,
    ): Promise<void> {
        const actual = await this.countRequests(pattern);
        const matched = count === undefined ? actual > 0 : actual === count;
        if (!matched) {
            const expectation =
                count === undefined ? "at least one matching request" : `exactly ${count}`;
            throw new Error(`expected ${expectation} but received ${actual}`);
        }
    }

    async resetMappings(): Promise<void> {
        await this.#admin("POST", "/mappings/reset");
    }

    async resetRequests(): Promise<void> {
        await this.#admin("DELETE", "/requests");
    }

    async resetAll(): Promise<void> {
        await this.#admin("POST", "/reset");
    }
}

export const connectMock = (baseUrl: string, options?: WireMockClientOptions): WireMockClient =>
    new WireMockClient(baseUrl, options);
