import { describe, expect, it } from "vitest";

import { matchContentPattern } from "../src/matching/matchers";

describe("matchContentPattern", () => {
    it("matches equalTo and rejects mismatches", () => {
        expect(matchContentPattern({ equalTo: "alpha" }, "alpha")).toBe(true);
        expect(matchContentPattern({ equalTo: "alpha" }, "beta")).toBe(false);
    });

    it("honours caseInsensitive", () => {
        expect(matchContentPattern({ equalTo: "Alpha", caseInsensitive: true }, "alpha")).toBe(
            true,
        );
        expect(matchContentPattern({ equalTo: "Alpha" }, "alpha")).toBe(false);
    });

    it("matches contains and regex patterns", () => {
        expect(matchContentPattern({ contains: "ell" }, "hello")).toBe(true);
        expect(matchContentPattern({ matches: "^h.*o$" }, "hello")).toBe(true);
        expect(matchContentPattern({ doesNotMatch: "^x" }, "hello")).toBe(true);
        expect(matchContentPattern({ doesNotMatch: "^h" }, "hello")).toBe(false);
    });

    it("treats undefined as only satisfying absent", () => {
        expect(matchContentPattern({ absent: true }, undefined)).toBe(true);
        expect(matchContentPattern({ absent: true }, "present")).toBe(false);
        expect(matchContentPattern({ equalTo: "x" }, undefined)).toBe(false);
    });

    it("compares json bodies with options", () => {
        const body = JSON.stringify({ a: 1, b: 2, list: [1, 2, 3] });
        expect(matchContentPattern({ equalToJson: { a: 1, b: 2, list: [1, 2, 3] } }, body)).toBe(
            true,
        );
        expect(matchContentPattern({ equalToJson: { a: 1 } }, body)).toBe(false);
        expect(
            matchContentPattern({ equalToJson: { a: 1 }, ignoreExtraElements: true }, body),
        ).toBe(true);
        expect(
            matchContentPattern(
                {
                    equalToJson: { list: [3, 2, 1] },
                    ignoreArrayOrder: true,
                    ignoreExtraElements: true,
                },
                body,
            ),
        ).toBe(true);
    });

    it("evaluates json path expressions", () => {
        const body = JSON.stringify({ items: [{ name: "a" }, { name: "b" }] });
        expect(matchContentPattern({ matchesJsonPath: "$.items[?(@.name=='b')]" }, body)).toBe(
            true,
        );
        expect(matchContentPattern({ matchesJsonPath: "$.missing" }, body)).toBe(false);
    });
});
