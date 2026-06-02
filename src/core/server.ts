import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { handleAdmin } from "../admin/adminApi";
import type {
    Fault,
    LoggedRequest,
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

export class WireMockServer {
    readonly registry = new StubRegistry();
    readonly journal = new RequestJournal();

    #server: Server | undefined;
    readonly #port: number;
    readonly #host: string;
    #boundPort = 0;

    constructor(options: WireMockOptions = {}) {
        this.#port = options.port ?? 8080;
        this.#host = options.host ?? "127.0.0.1";
    }

    // ---- stubbing + verification (in-process api) ---------------------------

    register(mapping: StubMapping): StubMapping {
        return this.registry.register(mapping);
    }

    stubFor(mapping: StubMapping): StubMapping {
        return this.register(mapping);
    }

    listMappings(): StubMapping[] {
        return this.registry.list();
    }

    countRequests(pattern: RequestPattern): number {
        return this.journal.count(pattern);
    }

    findRequests(pattern: RequestPattern): LoggedRequest[] {
        return this.journal.findMatching(pattern);
    }

    verify(pattern: RequestPattern, count?: number): boolean {
        const actual = this.journal.count(pattern);
        return count === undefined ? actual > 0 : actual === count;
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
        const server = this.#server;
        if (!server) return;
        this.#server = undefined;
        await new Promise<void>((resolve, reject) => {
            server.close((err) => (err ? reject(err) : resolve()));
        });
    }

    // ---- request handling ---------------------------------------------------

    async #handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
        const url = req.url ?? "/";
        const method = req.method ?? "GET";
        const body = await readBody(req);

        if (url === ADMIN_PREFIX || url.startsWith(`${ADMIN_PREFIX}/`)) {
            const subPath = stripQuery(url.slice(ADMIN_PREFIX.length)) || "/";
            const result = handleAdmin(this.registry, this.journal, method, subPath, body);
            sendJson(res, result.status, result.body);
            return;
        }

        const logged = this.#toLogged(req, url, method, body);
        this.journal.record(logged);

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
        await this.#sendStub(res, match.response, logged);
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
