import { describe, expect, it } from "vitest";

import { renderTemplate, type LoggedRequest } from "../src/index";

const req = (over: Partial<LoggedRequest> = {}): LoggedRequest => ({
    method: "GET",
    url: "/x?a=1",
    urlPath: "/x",
    query: { a: ["1"] },
    headers: { "x-id": "42" },
    body: "hello",
    loggedAt: 0,
    ...over,
});

describe("renderTemplate", () => {
    it("substitutes request fields", () => {
        expect(
            renderTemplate("m={{request.method}} p={{request.path}} b={{request.body}}", req()),
        ).toBe("m=GET p=/x b=hello");
    });

    it("substitutes query and header values (header keys are lower-cased)", () => {
        expect(renderTemplate("{{request.query.a}}-{{ request.headers.x-id }}", req())).toBe(
            "1-42",
        );
    });

    it("supports now / randomUuid and renders unknown expressions as empty", () => {
        const [now, uuid, nope] = renderTemplate("{{now}}|{{randomUuid}}|{{nope}}", req()).split(
            "|",
        );
        expect(now).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(uuid).toMatch(/^[0-9a-f-]{36}$/);
        expect(nope).toBe("");
    });
});
