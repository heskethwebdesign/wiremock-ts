import type { ContentPattern, LoggedRequest, RequestPattern } from "../types";
import { matchContentPattern } from "./matchers";

const methodMatches = (expected: RequestPattern["method"], actual: string): boolean =>
    expected === undefined || expected === "ANY" || expected.toUpperCase() === actual.toUpperCase();

const safeRegExp = (source: string): RegExp => {
    try {
        return new RegExp(source);
    } catch {
        return /(?!)/;
    }
};

const urlMatches = (pattern: RequestPattern, req: LoggedRequest): boolean => {
    if (pattern.url !== undefined && pattern.url !== req.url) return false;
    if (pattern.urlPath !== undefined && pattern.urlPath !== req.urlPath) return false;
    if (
        pattern.urlPathPattern !== undefined &&
        !safeRegExp(pattern.urlPathPattern).test(req.urlPath)
    ) {
        return false;
    }
    if (pattern.urlPattern !== undefined && !safeRegExp(pattern.urlPattern).test(req.url)) {
        return false;
    }
    return true;
};

const headersMatch = (patterns: Record<string, ContentPattern>, req: LoggedRequest): boolean =>
    Object.entries(patterns).every(([name, pattern]) =>
        matchContentPattern(pattern, req.headers[name.toLowerCase()]),
    );

const queryMatches = (patterns: Record<string, ContentPattern>, req: LoggedRequest): boolean =>
    Object.entries(patterns).every(([name, pattern]) => {
        const values = req.query[name];
        const first = values && values.length > 0 ? values[0] : undefined;
        return matchContentPattern(pattern, first);
    });

const bodyMatches = (patterns: ContentPattern[], req: LoggedRequest): boolean =>
    patterns.every((pattern) => matchContentPattern(pattern, req.body));

// returns true only when every constraint declared on the pattern is satisfied
// by the request. an empty pattern matches any request.
export const requestMatches = (pattern: RequestPattern, req: LoggedRequest): boolean => {
    if (!methodMatches(pattern.method, req.method)) return false;
    if (!urlMatches(pattern, req)) return false;
    if (pattern.queryParameters && !queryMatches(pattern.queryParameters, req)) return false;
    if (pattern.headers && !headersMatch(pattern.headers, req)) return false;
    if (pattern.bodyPatterns && !bodyMatches(pattern.bodyPatterns, req)) return false;
    return true;
};
