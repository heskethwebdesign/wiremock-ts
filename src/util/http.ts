import type { IncomingMessage } from "node:http";

export const readBody = async (req: IncomingMessage): Promise<string> => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
        chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks).toString("utf8");
};

// collapse node's header bag into lower-cased single strings (multi-value
// headers are joined with ", " as per rfc 9110).
export const normaliseHeaders = (
    headers: NodeJS.Dict<string | string[]>,
): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
        if (value === undefined) continue;
        out[key.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
    }
    return out;
};

export const stripQuery = (path: string): string => {
    const index = path.indexOf("?");
    return index === -1 ? path : path.slice(0, index);
};
