import type { RequestJournal } from "../core/requestJournal";
import type { StubRegistry } from "../core/stubRegistry";
import { requestPatternSchema, stubMappingSchema } from "../types";

export interface AdminResult {
    status: number;
    body: unknown;
}

const ok = (body: unknown): AdminResult => ({ status: 200, body });
const notFound = (): AdminResult => ({ status: 404, body: { error: "Not found" } });
const badRequest = (detail: unknown): AdminResult => ({
    status: 400,
    body: { error: "Bad request", detail },
});

const parseJson = (body: string): { ok: true; value: unknown } | { ok: false } => {
    try {
        return { ok: true, value: body.length === 0 ? {} : JSON.parse(body) };
    } catch {
        return { ok: false };
    }
};

// dispatch a request whose path is everything after the /__admin prefix.
export const handleAdmin = (
    registry: StubRegistry,
    journal: RequestJournal,
    method: string,
    path: string,
    body: string,
): AdminResult => {
    const verb = method.toUpperCase();
    const segments = path.split("/").filter((s) => s.length > 0);
    const [resource, id] = segments;

    if (verb === "GET" && segments.length === 0) return ok({ name: "wiremock-ts" });
    if (verb === "GET" && resource === "health") return ok({ status: "ok" });

    if (resource === "mappings") {
        if (verb === "GET" && id === undefined) return ok({ mappings: registry.list() });
        if (verb === "POST" && id === undefined) {
            const parsed = parseJson(body);
            if (!parsed.ok) return badRequest("invalid json");
            const result = stubMappingSchema.safeParse(parsed.value);
            if (!result.success) return badRequest(result.error.issues);
            return { status: 201, body: registry.register(result.data) };
        }
        if (verb === "POST" && id === "reset") {
            registry.reset();
            return ok({ reset: true });
        }
        if (verb === "GET" && id !== undefined) {
            const mapping = registry.getById(id);
            return mapping ? ok(mapping) : notFound();
        }
        if (verb === "DELETE" && id !== undefined) {
            return registry.removeById(id) ? ok({ removed: true }) : notFound();
        }
    }

    if (resource === "requests") {
        if (verb === "GET" && id === undefined) return ok({ requests: journal.all() });
        if (verb === "DELETE" && id === undefined) {
            journal.reset();
            return ok({ reset: true });
        }
        if (verb === "POST" && (id === "count" || id === "find")) {
            const parsed = parseJson(body);
            if (!parsed.ok) return badRequest("invalid json");
            const result = requestPatternSchema.safeParse(parsed.value);
            if (!result.success) return badRequest(result.error.issues);
            return id === "count"
                ? ok({ count: journal.count(result.data) })
                : ok({ requests: journal.findMatching(result.data) });
        }
    }

    if (verb === "POST" && resource === "reset") {
        registry.reset();
        journal.reset();
        return ok({ reset: true });
    }

    return notFound();
};
