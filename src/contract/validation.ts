import { Ajv, type ValidateFunction } from "ajv";

import type { OpenApiDocument } from "./openapi";

const METHODS = ["get", "post", "put", "delete", "patch", "head", "options"] as const;

const DOC_ID = "openapi.json";

const escapePointer = (segment: string): string => segment.replace(/~/g, "~0").replace(/\//g, "~1");

export interface BodyValidator {
    required: boolean;
    validate: ValidateFunction;
}

// compile an ajv validator for every operation that declares an
// application/json request body, keyed by `${METHOD} ${path}` (the openapi
// path template). internal `#/components/schemas` refs resolve against the
// whole document, registered once under a stable id.
export const compileRequestBodyValidators = (doc: OpenApiDocument): Map<string, BodyValidator> => {
    const ajv = new Ajv({ strict: false, allErrors: true });
    ajv.addSchema(doc as object, DOC_ID);
    const validators = new Map<string, BodyValidator>();
    for (const [path, item] of Object.entries(doc.paths ?? {})) {
        for (const method of METHODS) {
            const operation = item[method];
            const media = operation?.requestBody?.content?.["application/json"];
            if (media?.schema === undefined) continue;
            const pointer = `${DOC_ID}#/paths/${escapePointer(path)}/${method}/requestBody/content/${escapePointer(
                "application/json",
            )}/schema`;
            const validate = ajv.getSchema(pointer);
            if (validate === undefined) continue;
            validators.set(`${method.toUpperCase()} ${path}`, {
                required: operation?.requestBody?.required ?? false,
                validate,
            });
        }
    }
    return validators;
};

export type BodyValidationResult = { ok: true } | { ok: false; errors: string[] };

// validate a raw request body string against a compiled operation validator.
export const validateRequestBody = (
    validator: BodyValidator,
    body: string,
): BodyValidationResult => {
    if (body.length === 0) {
        return validator.required
            ? { ok: false, errors: ["request body is required"] }
            : { ok: true };
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(body);
    } catch {
        return { ok: false, errors: ["request body is not valid json"] };
    }
    if (validator.validate(parsed)) return { ok: true };
    const errors = (validator.validate.errors ?? []).map((issue) => {
        const where = issue.instancePath.length > 0 ? issue.instancePath : "(root)";
        return `${where} ${issue.message ?? "is invalid"}`.trim();
    });
    return {
        ok: false,
        errors: errors.length > 0 ? errors : ["request body failed schema validation"],
    };
};
