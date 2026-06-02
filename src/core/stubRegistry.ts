import { randomUUID } from "node:crypto";

import { requestMatches } from "../matching/requestMatcher";
import type { LoggedRequest, StubMapping } from "../types";

// stubs without an explicit priority sort below any that set one. lower numbers
// win, matching wiremock semantics.
const DEFAULT_PRIORITY = Number.MAX_SAFE_INTEGER;

interface StoredStub {
    mapping: StubMapping;
    insertionIndex: number;
}

export class StubRegistry {
    #stubs: StoredStub[] = [];
    #counter = 0;

    register(mapping: StubMapping): StubMapping {
        const id = mapping.id ?? randomUUID();
        const stored: StubMapping = { ...mapping, id };
        const entry: StoredStub = { mapping: stored, insertionIndex: this.#counter++ };
        const existing = this.#stubs.findIndex((s) => s.mapping.id === id);
        if (existing === -1) {
            this.#stubs.push(entry);
        } else {
            this.#stubs[existing] = entry;
        }
        return stored;
    }

    findMatch(req: LoggedRequest): StubMapping | undefined {
        const matches = this.#stubs.filter((s) => requestMatches(s.mapping.request, req));
        if (matches.length === 0) return undefined;
        matches.sort((a, b) => {
            const pa = a.mapping.priority ?? DEFAULT_PRIORITY;
            const pb = b.mapping.priority ?? DEFAULT_PRIORITY;
            if (pa !== pb) return pa - pb;
            // on a priority tie the most recently registered stub wins.
            return b.insertionIndex - a.insertionIndex;
        });
        return matches[0]?.mapping;
    }

    list(): StubMapping[] {
        return this.#stubs.map((s) => s.mapping);
    }

    getById(id: string): StubMapping | undefined {
        return this.#stubs.find((s) => s.mapping.id === id)?.mapping;
    }

    removeById(id: string): boolean {
        const index = this.#stubs.findIndex((s) => s.mapping.id === id);
        if (index === -1) return false;
        this.#stubs.splice(index, 1);
        return true;
    }

    reset(): void {
        this.#stubs = [];
        this.#counter = 0;
    }
}
