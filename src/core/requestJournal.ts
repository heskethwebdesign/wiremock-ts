import { requestMatches } from "../matching/requestMatcher";
import type { LoggedRequest, RequestPattern } from "../types";

export class RequestJournal {
    #requests: LoggedRequest[] = [];

    record(req: LoggedRequest): void {
        this.#requests.push(req);
    }

    all(): LoggedRequest[] {
        return [...this.#requests];
    }

    findMatching(pattern: RequestPattern): LoggedRequest[] {
        return this.#requests.filter((req) => requestMatches(pattern, req));
    }

    count(pattern: RequestPattern): number {
        return this.findMatching(pattern).length;
    }

    reset(): void {
        this.#requests = [];
    }
}
