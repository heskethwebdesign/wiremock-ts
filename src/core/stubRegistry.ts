import { randomUUID } from "node:crypto";

import { requestMatches } from "../matching/requestMatcher";
import type { LoggedRequest, StubMapping } from "../types";

// stubs without an explicit priority sort below any that set one. lower numbers
// win, matching wiremock semantics.
const DEFAULT_PRIORITY = Number.MAX_SAFE_INTEGER;

// wiremock's implicit starting state for any scenario.
const DEFAULT_SCENARIO_STATE = "Started";

interface StoredStub {
    mapping: StubMapping;
    insertionIndex: number;
}

export class StubRegistry {
    #stubs: StoredStub[] = [];
    #counter = 0;
    #scenarios = new Map<string, string>();

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
        const matches = this.#stubs.filter(
            (s) => requestMatches(s.mapping.request, req) && this.#scenarioMatches(s.mapping),
        );
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

    getScenarioState(name: string): string {
        return this.#scenarios.get(name) ?? DEFAULT_SCENARIO_STATE;
    }

    setScenarioState(name: string, state: string): void {
        this.#scenarios.set(name, state);
    }

    #scenarioMatches(mapping: StubMapping): boolean {
        if (mapping.requiredScenarioState === undefined || mapping.scenarioName === undefined) {
            return true;
        }
        return this.getScenarioState(mapping.scenarioName) === mapping.requiredScenarioState;
    }

    reset(): void {
        this.#stubs = [];
        this.#counter = 0;
        this.#scenarios.clear();
    }
}
