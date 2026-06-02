import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { handleAdmin } from "../admin/adminApi";
import { stubsFromOpenApi, type OpenApiDocument } from "../contract/openapi";
import type { RequestPatternBuilder } from "../dsl/builders";
import type {
    Fault,
    LoggedRequest,
    RegisteredStub,
    RequestPattern,
    ResponseDefinition,
    StubMapping,
} from "../types";
import { normaliseHeaders, readBody, stripQuery } from "../util/http";
import { RequestJournal } from "./requestJournal";
import { StubRegistry } from "./stubRegistry";
import { renderTemplate } from "./templating";

const ADMIN_PREFIX = "/__admin";

export interface WireMockOptions {
    port?: number;
    host?: string;
    // when set, every /__admin request must present this token via
    // `Authorization: Bearer <token>` or `X-Admin-Token: <token>`.
    adminToken?: string;
    // when set, proxy and record targets are restricted to these hostnames.
    allowedProxyHosts?: string[];
}

const sleep = (milliseconds: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, milliseconds));

const hasHeader = (headers: Record<string, string | string[]>, name: string): boolean =>
    Object.keys(headers).some((key) => key.toLowerCase() === name);

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
    const payload = JSON.stringify(body ?? null);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(payload);
};

const renderHeader = (value: string | string[], req: LoggedRequest): string | string[] =>
    Array.isArray(value) ? value.map((v) => renderTemplate(v, req)) : renderTemplate(value, req);

const toPattern = (pattern: RequestPattern | RequestPatternBuilder): RequestPattern =>
    "build" in pattern ? pattern.build() : pattern;

const timingSafeEqualStr = (a: string, b: string): boolean => {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    return ab.length === bb.length && timingSafeEqual(ab, bb);
};

// headers we never copy verbatim from an upstream response, because we
// re-frame the body ourselves.
const STRIPPED_RESPONSE_HEADERS = new Set([
    "content-length",
    "content-encoding",
    "transfer-encoding",
]);

interface ProxiedResponse {
    status: number;
    headers: Record<string, string>;
    body: string;
}

const proxyRequest = async (
    targetBaseUrl: string,
    req: LoggedRequest,
): Promise<ProxiedResponse> => {
    const headers: Record<string, string> = { ...req.headers };
    delete headers.host;
    const init: RequestInit = { method: req.method, headers };
    if (req.method !== "GET" && req.method !== "HEAD" && req.body.length > 0) init.body = req.body;

    const upstream = await fetch(`${targetBaseUrl.replace(/\/+$/, "")}${req.url}`, init);
    const responseHeaders: Record<string, string> = {};
    upstream.headers.forEach((value, key) => {
        if (!STRIPPED_RESPONSE_HEADERS.has(key.toLowerCase())) responseHeaders[key] = value;
    });
    return { status: upstream.status, headers: responseHeaders, body: await upstream.text() };
};

export class WireMockServer {
    readonly registry = new StubRegistry();
    readonly journal = new RequestJournal();

    #server: Server | undefined;
    readonly #port: number;
    readonly #host: string;
    #boundPort = 0;
    #recording: { target: string; captured: StubMapping[] } | undefined;
    #originalFetch: typeof fetch | undefined;
    readonly #adminToken: string | undefined;
    readonly #allowedProxyHosts: string[] | undefined;

    constructor(options: WireMockOptions = {}) {
        this.#port = options.port ?? 8080;
        this.#host = options.host ?? "127.0.0.1";
        this.#adminToken = options.adminToken;
        this.#allowedProxyHosts = options.allowedProxyHosts;
    }

    #adminAuthorised(req: IncomingMessage): boolean {
        if (this.#adminToken === undefined) return true;
        const header = req.headers["x-admin-token"] ?? req.headers["authorization"];
        const provided = Array.isArray(header) ? header[0] : header;
        if (provided === undefined) return false;
        const token = provided.startsWith("Bearer ") ? provided.slice(7) : provided;
        return timingSafeEqualStr(token, this.#adminToken);
    }

    #isProxyAllowed(targetBaseUrl: string): boolean {
        if (this.#allowedProxyHosts === undefined) return true;
        try {
            return this.#allowedProxyHosts.includes(new URL(targetBaseUrl).hostname);
        } catch {
            return false;
        }
    }

    // ---- stubbing + verification (in-process api) ---------------------------

    register(mapping: RegisteredStub): RegisteredStub {
        return this.registry.register(mapping);
    }

    stubFor(mapping: RegisteredStub): RegisteredStub {
        return this.register(mapping);
    }

    listMappings(): StubMapping[] {
        return this.registry.list();
    }

    // register a stub for every operation in an openapi document and return
    // the generated mappings.
    loadOpenApi(doc: OpenApiDocument): StubMapping[] {
        const stubs = stubsFromOpenApi(doc);
        for (const stub of stubs) this.register(stub);
        return stubs;
    }

    countRequests(pattern: RequestPattern | RequestPatternBuilder): number {
        return this.journal.count(toPattern(pattern));
    }

    findRequests(pattern: RequestPattern | RequestPatternBuilder): LoggedRequest[] {
        return this.journal.findMatching(toPattern(pattern));
    }

    verify(pattern: RequestPattern | RequestPatternBuilder, count?: number): boolean {
        const actual = this.journal.count(toPattern(pattern));
        return count === undefined ? actual > 0 : actual === count;
    }

    // throws with a helpful message when the expectation is not met.
    assertReceived(pattern: RequestPattern | RequestPatternBuilder, count?: number): void {
        const resolved = toPattern(pattern);
        const actual = this.journal.count(resolved);
        const satisfied = count === undefined ? actual > 0 : actual === count;
        if (!satisfied) {
            const expected = count === undefined ? "at least one" : String(count);
            throw new Error(
                `expected ${expected} request(s) matching ${JSON.stringify(resolved)}, received ${actual}`,
            );
        }
    }

    resetMappings(): void {
        this.registry.reset();
    }

    resetRequests(): void {
        this.journal.reset();
    }

    resetAll(): void {
        this.registry.reset();
        this.journal.reset();
    }

    // ---- record / playback --------------------------------------------------

    // proxy every subsequent request to targetBaseUrl and capture each
    // request/response pair as a stub mapping.
    startRecording(targetBaseUrl: string): void {
        if (!this.#isProxyAllowed(targetBaseUrl)) {
            throw new Error(`proxy target not allowed: ${targetBaseUrl}`);
        }
        this.#recording = { target: targetBaseUrl, captured: [] };
    }

    // stop recording and return the captured mappings (replay them with
    // stubFor to play back offline).
    stopRecording(): StubMapping[] {
        const captured = this.#recording?.captured ?? [];
        this.#recording = undefined;
        return captured;
    }

    get isRecording(): boolean {
        return this.#recording !== undefined;
    }

    // ---- in-process fetch interception --------------------------------------

    // patch global fetch so the same stubs serve without opening a socket.
    // unmatched requests pass through to the real fetch unless passthrough is
    // disabled, in which case they receive a 404.
    interceptFetch(options: { passthrough?: boolean } = {}): void {
        if (this.#originalFetch !== undefined) return;
        const original = globalThis.fetch;
        this.#originalFetch = original;
        const passthrough = options.passthrough ?? true;

        const patched = async (
            input: Parameters<typeof fetch>[0],
            init?: Parameters<typeof fetch>[1],
        ): Promise<Response> => {
            const request = new Request(input, init);
            const logged = await this.#loggedFromRequest(request);
            this.journal.record(logged);

            const match = this.registry.findMatch(logged);
            if (match === undefined) {
                if (passthrough) return original(input, init);
                return new Response(
                    JSON.stringify({ error: "No stub mapping matched the request" }),
                    {
                        status: 404,
                        headers: { "content-type": "application/json" },
                    },
                );
            }
            if (match.scenarioName !== undefined && match.newScenarioState !== undefined) {
                this.registry.setScenarioState(match.scenarioName, match.newScenarioState);
            }
            const definition = match.responseProvider
                ? match.responseProvider(logged)
                : match.response;
            return this.#responseFor(definition, logged, original);
        };

        globalThis.fetch = patched as typeof fetch;
    }

    restoreFetch(): void {
        if (this.#originalFetch === undefined) return;
        globalThis.fetch = this.#originalFetch;
        this.#originalFetch = undefined;
    }

    async #loggedFromRequest(request: Request): Promise<LoggedRequest> {
        const url = new URL(request.url);
        const query: Record<string, string[]> = {};
        for (const key of url.searchParams.keys()) {
            if (!(key in query)) query[key] = url.searchParams.getAll(key);
        }
        const headers: Record<string, string> = {};
        request.headers.forEach((value, key) => {
            headers[key.toLowerCase()] = value;
        });
        const body =
            request.method === "GET" || request.method === "HEAD" ? "" : await request.text();
        return {
            method: request.method,
            url: `${url.pathname}${url.search}`,
            urlPath: url.pathname,
            query,
            headers,
            body,
            loggedAt: Date.now(),
        };
    }

    async #responseFor(
        definition: ResponseDefinition,
        req: LoggedRequest,
        original: typeof fetch,
    ): Promise<Response> {
        if (definition.fixedDelayMilliseconds) await sleep(definition.fixedDelayMilliseconds);
        if (definition.proxyBaseUrl !== undefined) {
            if (!this.#isProxyAllowed(definition.proxyBaseUrl)) {
                return new Response(JSON.stringify({ error: "Proxy target not allowed" }), {
                    status: 502,
                    headers: { "content-type": "application/json" },
                });
            }
            const target = `${definition.proxyBaseUrl.replace(/\/+$/, "")}${req.url}`;
            const init: RequestInit = { method: req.method, headers: req.headers };
            if (req.method !== "GET" && req.method !== "HEAD" && req.body.length > 0)
                init.body = req.body;
            return original(target, init);
        }
        if (definition.fault !== undefined) {
            // surface as a network-level failure, mirroring a real fetch error.
            throw new TypeError(`fetch failed: simulated fault ${definition.fault}`);
        }

        const transform = definition.transform === true;
        const headers = new Headers();
        for (const [name, value] of Object.entries(definition.headers ?? {})) {
            const rendered = transform ? renderHeader(value, req) : value;
            for (const single of Array.isArray(rendered) ? rendered : [rendered]) {
                headers.append(name, single);
            }
        }

        let body: string | Buffer;
        if (definition.jsonBody !== undefined) {
            const json = JSON.stringify(definition.jsonBody);
            body = transform ? renderTemplate(json, req) : json;
            if (!headers.has("content-type")) headers.set("content-type", "application/json");
        } else if (definition.base64Body !== undefined) {
            body = Buffer.from(definition.base64Body, "base64");
        } else {
            const raw = definition.body ?? "";
            body = transform ? renderTemplate(raw, req) : raw;
        }

        return new Response(body, {
            status: definition.status ?? 200,
            ...(definition.statusMessage === undefined
                ? {}
                : { statusText: definition.statusMessage }),
            headers,
        });
    }

    // ---- lifecycle ----------------------------------------------------------

    get port(): number {
        return this.#boundPort || this.#port;
    }

    get baseUrl(): string {
        return `http://${this.#host}:${this.port}`;
    }

    async start(): Promise<this> {
        if (this.#server) return this;
        const server = createServer((req, res) => {
            this.#handle(req, res).catch((err: unknown) => this.#fail(res, err));
        });
        this.#server = server;
        await new Promise<void>((resolve, reject) => {
            const onError = (err: Error): void => reject(err);
            server.once("error", onError);
            server.listen(this.#port, this.#host, () => {
                const address = server.address();
                if (address !== null && typeof address === "object") this.#boundPort = address.port;
                server.off("error", onError);
                resolve();
            });
        });
        return this;
    }

    async stop(): Promise<void> {
        this.restoreFetch();
        const server = this.#server;
        if (!server) return;
        this.#server = undefined;
        await new Promise<void>((resolve, reject) => {
            server.close((err) => (err ? reject(err) : resolve()));
        });
    }

    // enables `await using server = await startMock()` automatic cleanup.
    async [Symbol.asyncDispose](): Promise<void> {
        await this.stop();
    }

    // ---- request handling ---------------------------------------------------

    async #handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
        const url = req.url ?? "/";
        const method = req.method ?? "GET";
        const body = await readBody(req);

        if (url === ADMIN_PREFIX || url.startsWith(`${ADMIN_PREFIX}/`)) {
            if (!this.#adminAuthorised(req)) {
                sendJson(res, 401, { error: "Unauthorised: a valid admin token is required" });
                return;
            }
            const subPath = stripQuery(url.slice(ADMIN_PREFIX.length)) || "/";
            const result = handleAdmin(this.registry, this.journal, method, subPath, body);
            sendJson(res, result.status, result.body);
            return;
        }

        const logged = this.#toLogged(req, url, method, body);
        this.journal.record(logged);

        if (this.#recording !== undefined) {
            await this.#proxyAndRecord(res, this.#recording, logged);
            return;
        }

        const match = this.registry.findMatch(logged);
        if (!match) {
            sendJson(res, 404, {
                error: "No stub mapping matched the request",
                request: { method: logged.method, url: logged.url },
                registeredStubs: this.registry.list().length,
            });
            return;
        }
        if (match.scenarioName !== undefined && match.newScenarioState !== undefined) {
            this.registry.setScenarioState(match.scenarioName, match.newScenarioState);
        }
        const definition = match.responseProvider ? match.responseProvider(logged) : match.response;
        await this.#sendStub(res, definition, logged);
    }

    #toLogged(req: IncomingMessage, url: string, method: string, body: string): LoggedRequest {
        const parsed = new URL(url, `http://${this.#host}`);
        const query: Record<string, string[]> = {};
        for (const key of parsed.searchParams.keys()) {
            if (!(key in query)) query[key] = parsed.searchParams.getAll(key);
        }
        return {
            method,
            url,
            urlPath: parsed.pathname,
            query,
            headers: normaliseHeaders(req.headers),
            body,
            loggedAt: Date.now(),
        };
    }

    async #sendStub(
        res: ServerResponse,
        definition: ResponseDefinition,
        req: LoggedRequest,
    ): Promise<void> {
        if (definition.fixedDelayMilliseconds) await sleep(definition.fixedDelayMilliseconds);

        if (definition.proxyBaseUrl !== undefined) {
            if (!this.#isProxyAllowed(definition.proxyBaseUrl)) {
                sendJson(res, 502, {
                    error: "Proxy target not allowed",
                    target: definition.proxyBaseUrl,
                });
                return;
            }
            const proxied = await proxyRequest(definition.proxyBaseUrl, req);
            res.writeHead(proxied.status, proxied.headers);
            res.end(proxied.body);
            return;
        }

        if (definition.fault !== undefined) {
            this.#injectFault(res, definition.fault);
            return;
        }

        const transform = definition.transform === true;
        const headers: Record<string, string | string[]> = {};
        for (const [name, value] of Object.entries(definition.headers ?? {})) {
            headers[name] = transform ? renderHeader(value, req) : value;
        }

        let payload: string | Buffer = "";
        if (definition.jsonBody !== undefined) {
            const json = JSON.stringify(definition.jsonBody);
            payload = transform ? renderTemplate(json, req) : json;
            if (!hasHeader(headers, "content-type")) headers["content-type"] = "application/json";
        } else if (definition.base64Body !== undefined) {
            payload = Buffer.from(definition.base64Body, "base64");
        } else if (definition.body !== undefined) {
            payload = transform ? renderTemplate(definition.body, req) : definition.body;
        }

        const httpStatus = definition.status ?? 200;
        if (definition.statusMessage !== undefined) {
            res.writeHead(httpStatus, definition.statusMessage, headers);
        } else {
            res.writeHead(httpStatus, headers);
        }
        res.end(payload);
    }

    async #proxyAndRecord(
        res: ServerResponse,
        recording: { target: string; captured: StubMapping[] },
        req: LoggedRequest,
    ): Promise<void> {
        const proxied = await proxyRequest(recording.target, req);
        recording.captured.push({
            request: { method: req.method as RequestPattern["method"], urlPath: req.urlPath },
            response: { status: proxied.status, body: proxied.body, headers: proxied.headers },
        });
        res.writeHead(proxied.status, proxied.headers);
        res.end(proxied.body);
    }

    #injectFault(res: ServerResponse, fault: Fault): void {
        const socket = res.socket;
        if (!socket) {
            res.end();
            return;
        }
        switch (fault) {
            case "empty-response":
                // close cleanly without sending any bytes.
                socket.end();
                return;
            case "connection-reset":
                // abort the connection with an rst.
                socket.destroy();
                return;
            case "malformed-chunk":
                socket.write("HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\ngarbage");
                socket.destroy();
                return;
            case "random-then-close":
                socket.write(randomBytes(32));
                socket.destroy();
                return;
        }
    }

    #fail(res: ServerResponse, err: unknown): void {
        if (res.headersSent) {
            res.end();
            return;
        }
        sendJson(res, 500, { error: "Internal mock server error", detail: String(err) });
    }
}

// convenience for tests: construct and start a server in one step.
export const startMock = (options?: WireMockOptions): Promise<WireMockServer> =>
    new WireMockServer(options).start();
