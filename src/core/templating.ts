import { randomUUID } from "node:crypto";

import type { LoggedRequest } from "../types";

// the value namespace available to {{ ... }} templates.
const buildContext = (req: LoggedRequest): Record<string, unknown> => ({
    request: {
        method: req.method,
        url: req.url,
        path: req.urlPath,
        body: req.body,
        query: Object.fromEntries(
            Object.entries(req.query).map(([key, values]) => [key, values[0] ?? ""]),
        ),
        headers: req.headers,
    },
});

const resolveExpression = (expr: string, ctx: Record<string, unknown>): string => {
    if (expr === "now") return new Date().toISOString();
    if (expr === "randomUuid") return randomUUID();

    let current: unknown = ctx;
    for (const segment of expr.split(".")) {
        if (current !== null && typeof current === "object" && segment in current) {
            current = (current as Record<string, unknown>)[segment];
        } else {
            return "";
        }
    }
    return current === null || current === undefined ? "" : String(current);
};

// render a string, replacing {{ expr }} tokens. supported expressions:
// request.method / request.url / request.path / request.body,
// request.query.<key>, request.headers.<key>, now, randomUuid.
export const renderTemplate = (template: string, req: LoggedRequest): string => {
    const ctx = buildContext(req);
    return template.replace(/\{\{\s*([\w.-]+?)\s*\}\}/g, (_match, expr: string) =>
        resolveExpression(expr, ctx),
    );
};
