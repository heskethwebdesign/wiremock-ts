import { JSONPath } from "jsonpath-plus";

import type { ContentPattern } from "../types";

// jsonpath-plus ships awkward overloads; wrap it in the single call shape we use.
const runJsonPath = JSONPath as unknown as (options: {
    path: string;
    json: unknown;
    wrap?: boolean;
}) => unknown[];

const safeRegExp = (source: string): RegExp => {
    try {
        return new RegExp(source);
    } catch {
        // an invalid pattern can never match anything.
        return /(?!)/;
    }
};

const stringEquals = (expected: string, actual: string, caseInsensitive?: boolean): boolean =>
    caseInsensitive ? expected.toLowerCase() === actual.toLowerCase() : expected === actual;

const deepMatch = (
    expected: unknown,
    actual: unknown,
    ignoreExtra: boolean,
    ignoreOrder: boolean,
): boolean => {
    if (Array.isArray(expected)) {
        if (!Array.isArray(actual)) return false;
        if (ignoreOrder) {
            const used = new Array<boolean>(actual.length).fill(false);
            for (const item of expected) {
                const idx = actual.findIndex(
                    (candidate, i) =>
                        !used[i] && deepMatch(item, candidate, ignoreExtra, ignoreOrder),
                );
                if (idx === -1) return false;
                used[idx] = true;
            }
            return ignoreExtra || actual.length === expected.length;
        }
        if (!ignoreExtra && actual.length !== expected.length) return false;
        if (actual.length < expected.length) return false;
        return expected.every((item, i) => deepMatch(item, actual[i], ignoreExtra, ignoreOrder));
    }

    if (expected !== null && typeof expected === "object") {
        if (actual === null || typeof actual !== "object" || Array.isArray(actual)) return false;
        const expectedObj = expected as Record<string, unknown>;
        const actualObj = actual as Record<string, unknown>;
        for (const key of Object.keys(expectedObj)) {
            if (!(key in actualObj)) return false;
            if (!deepMatch(expectedObj[key], actualObj[key], ignoreExtra, ignoreOrder))
                return false;
        }
        if (!ignoreExtra) {
            return Object.keys(actualObj).every((key) => key in expectedObj);
        }
        return true;
    }

    return expected === actual;
};

const jsonEquals = (expected: unknown, value: string, pattern: ContentPattern): boolean => {
    let actual: unknown;
    try {
        actual = JSON.parse(value);
    } catch {
        return false;
    }
    return deepMatch(
        expected,
        actual,
        pattern.ignoreExtraElements ?? false,
        pattern.ignoreArrayOrder ?? false,
    );
};

const jsonPathMatches = (path: string, value: string): boolean => {
    let json: unknown;
    try {
        json = JSON.parse(value);
    } catch {
        return false;
    }
    try {
        const result = runJsonPath({ path, json, wrap: true });
        return result.length > 0;
    } catch {
        return false;
    }
};

// evaluate a single content pattern against a value. an undefined value only
// satisfies an `absent` pattern; every other matcher requires a value.
export const matchContentPattern = (
    pattern: ContentPattern,
    value: string | undefined,
): boolean => {
    if (pattern.absent === true) return value === undefined;
    if (value === undefined) return false;

    if (
        pattern.equalTo !== undefined &&
        !stringEquals(pattern.equalTo, value, pattern.caseInsensitive)
    ) {
        return false;
    }
    if (pattern.contains !== undefined) {
        const haystack = pattern.caseInsensitive ? value.toLowerCase() : value;
        const needle = pattern.caseInsensitive ? pattern.contains.toLowerCase() : pattern.contains;
        if (!haystack.includes(needle)) return false;
    }
    if (pattern.matches !== undefined && !safeRegExp(pattern.matches).test(value)) {
        return false;
    }
    if (pattern.doesNotMatch !== undefined && safeRegExp(pattern.doesNotMatch).test(value)) {
        return false;
    }
    if (pattern.equalToJson !== undefined && !jsonEquals(pattern.equalToJson, value, pattern)) {
        return false;
    }
    if (pattern.matchesJsonPath !== undefined && !jsonPathMatches(pattern.matchesJsonPath, value)) {
        return false;
    }
    return true;
};
