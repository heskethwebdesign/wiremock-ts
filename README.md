# wiremock-ts

A TypeScript-first HTTP mock server — [WireMock](https://wiremock.org/), reimagined for the Node/TS ecosystem.

Stand up a real HTTP server that returns the responses you stub, match incoming requests on almost anything, and verify what your code actually sent — through a fully-typed fluent API, a REST admin API, or a CLI. The same stubs can also serve **in-process** by intercepting `fetch`, with no socket at all.

It runs on Node's built-in `http`; the only runtime dependencies are `zod` and `jsonpath-plus`.

## Contents

- [Install](#install)
- [Quick start](#quick-start)
- [Two ways to serve](#two-ways-to-serve)
- [Request matching](#request-matching)
- [Responses](#responses)
- [Programmatic responses](#programmatic-responses)
- [Response templating](#response-templating)
- [Stateful scenarios](#stateful-scenarios)
- [Fault injection](#fault-injection)
- [Proxying](#proxying)
- [Record and playback](#record-and-playback)
- [Contract-first (OpenAPI)](#contract-first-openapi)
- [Verification](#verification)
- [CLI](#cli)
- [Admin API](#admin-api)
- [API reference](#api-reference)
- [Testing](#testing)
- [Scripts](#scripts)
- [Roadmap](#roadmap)
- [Licence](#licence)

## Install

```bash
npm install --save-dev wiremock-ts
```

Requires Node 20+. Ships as ESM with type declarations.

## Quick start

```ts
import { equalToJson, get, ok, okJson, post, urlPathEqualTo, WireMockServer } from "wiremock-ts";

const wm = await new WireMockServer({ port: 8080 }).start();

wm.stubFor(get(urlPathEqualTo("/api/user")).willReturn(okJson({ id: 1, name: "ada" })));

wm.stubFor(
    post(urlPathEqualTo("/orders"))
        .withRequestBody(equalToJson({ sku: "abc" }))
        .willReturn(ok("accepted")),
);

// point your code at wm.baseUrl, then verify what it sent:
wm.verify({ method: "POST", urlPath: "/orders" }, 1); // true if called exactly once

await wm.stop();
```

Use `port: 0` to bind a free ephemeral port (ideal for parallel tests) and read the chosen address from `wm.baseUrl`. In tests, `await using` cleans up automatically:

```ts
import { get, ok, startMock, urlPathEqualTo } from "wiremock-ts";

it("works", async () => {
    await using wm = await startMock({ port: 0 });
    wm.stubFor(get(urlPathEqualTo("/ping")).willReturn(ok("pong")));
    // ... the server is stopped when the block exits
});
```

## Two ways to serve

The same stubs can be served two ways:

1. **A real HTTP server** (`start()`) — anything that speaks HTTP can hit it.
2. **In-process `fetch` interception** (`interceptFetch()`) — no socket; `fetch` calls are answered from the registry. Unmatched requests pass through to the real `fetch` by default.

```ts
const wm = new WireMockServer(); // not started
wm.stubFor(get(urlPathEqualTo("/api/ping")).willReturn(okJson({ pong: true })));
wm.interceptFetch();

await fetch("https://example.test/api/ping"); // served in-process, no network

wm.restoreFetch();
```

Pass `interceptFetch({ passthrough: false })` to return `404` for unmatched requests instead of hitting the network.

## Request matching

A request matches when every constraint declared on the pattern is satisfied. An empty pattern matches anything.

| Field             | Matches on                                          |
| ----------------- | --------------------------------------------------- |
| `method`          | HTTP method, or `"ANY"`                             |
| `url`             | exact path **and** query string                     |
| `urlPath`         | exact path only                                     |
| `urlPathPattern`  | regex against the path                              |
| `urlPattern`      | regex against path + query                          |
| `queryParameters` | per-parameter content pattern                       |
| `headers`         | per-header content pattern (case-insensitive names) |
| `bodyPatterns`    | content patterns against the raw body               |

URL matchers and content matchers are exposed as builder helpers:

```ts
import {
    absent,
    containing,
    equalTo,
    equalToJson,
    get,
    matching,
    matchingJsonPath,
    notMatching,
    urlEqualTo,
    urlMatching,
    urlPathEqualTo,
    urlPathMatching,
} from "wiremock-ts";

wm.stubFor(
    get(urlPathMatching("^/users/\\d+$"))
        .withQueryParam("expand", equalTo("profile"))
        .withHeader("authorization", matching("^Bearer "))
        .willReturn(ok()),
);
```

Content patterns: `equalTo(value, caseInsensitive?)`, `containing`, `matching` / `notMatching` (regex), `equalToJson(value, { ignoreExtraElements?, ignoreArrayOrder? })`, `matchingJsonPath`, and `absent`.

When several stubs match, the lowest `priority` wins (set with `.atPriority(n)`); on a tie the most recently registered stub wins.

## Responses

Build responses fluently:

```ts
import { aResponse, created, noContent, notFound, ok, okJson, status } from "wiremock-ts";

aResponse()
    .withStatus(202)
    .withHeader("x-trace", "abc")
    .withJsonBody({ queued: true })
    .withFixedDelay(150); // ms
```

`ok(body?)`, `okJson(json)`, `created(body?)`, `noContent()`, `notFound(body?)` and `status(code)` are shortcuts. A response can carry `body`, `jsonBody`, or `base64Body`, plus headers, a fixed delay, a [template flag](#response-templating), a [fault](#fault-injection), or a [proxy target](#proxying).

## Programmatic responses

Pass a function to `willReturn` to compute the response from the request — fully typed, no string templating required. This is in-process only (used with `start()` or `interceptFetch()`).

```ts
wm.stubFor(
    get(urlPathMatching("^/echo")).willReturn((req) =>
        okJson({ method: req.method, path: req.urlPath, query: req.query }),
    ),
);
```

## Response templating

For declarative (serialisable) stubs, opt in with `.withTransform()` and use `{{ ... }}` tokens in the body and header values:

```ts
aResponse()
    .withBody("you requested {{request.path}} at {{now}} (id {{randomUuid}})")
    .withTransform();
```

Supported tokens: `request.method`, `request.url`, `request.path`, `request.body`, `request.query.<key>`, `request.headers.<key>`, `now`, and `randomUuid`. Unknown tokens render as empty.

## Stateful scenarios

Model a sequence of responses with a per-scenario state machine. A stub only matches while its scenario is in `requiredScenarioState` (the implicit start state is `"Started"`), and serving it transitions to `newScenarioState`.

```ts
wm.stubFor(
    get(urlPathEqualTo("/job"))
        .inScenario("job")
        .whenScenarioStateIs("Started")
        .willSetStateTo("done")
        .willReturn(okJson({ status: "pending" })),
);
wm.stubFor(
    get(urlPathEqualTo("/job"))
        .inScenario("job")
        .whenScenarioStateIs("done")
        .willReturn(okJson({ status: "complete" })),
);
```

## Fault injection

Return a connection-level failure instead of a normal response:

```ts
wm.stubFor(get(urlPathEqualTo("/flaky")).willReturn(aResponse().withFault("connection-reset")));
```

Faults: `connection-reset`, `empty-response`, `malformed-chunk`, `random-then-close`. Under `interceptFetch()` a fault surfaces as a rejected `fetch` (network error).

## Proxying

Forward a matched request to a real upstream and return its response:

```ts
import { proxiedFrom } from "wiremock-ts";

wm.stubFor(get(urlMatching("^/v1/")).willReturn(proxiedFrom("https://api.example.com")));
```

## Record and playback

Capture live traffic against a real backend, then replay it offline:

```ts
wm.startRecording("https://api.example.com");
// ... drive your app; every request is proxied and captured ...
const mappings = wm.stopRecording();

// replay later, with the backend unavailable:
for (const mapping of mappings) wm.stubFor(mapping);
```

## Contract-first (OpenAPI)

Generate a working mock from an OpenAPI 3 document — one stub per operation, with response bodies generated from the schemas (`$ref` resolution, `example`/`default`/`enum`, and format-aware strings such as `uuid`, `email`, `date-time`).

```ts
import openapi from "./openapi.json" with { type: "json" };

wm.loadOpenApi(openapi); // registers a stub for every path + method
```

Use `stubsFromOpenApi(doc)` to get the mappings without registering them, or `generateSample(schema, doc)` to build representative data from a single schema.

## Verification

Assert what your code sent, either by boolean or by throwing:

```ts
import { containing, postRequestedFor, urlPathEqualTo } from "wiremock-ts";

wm.verify(postRequestedFor(urlPathEqualTo("/orders")), 1); // boolean
wm.assertReceived(postRequestedFor(urlPathEqualTo("/orders"))); // throws if never received
wm.countRequests({ method: "GET", urlPath: "/health" }); // number
wm.findRequests(postRequestedFor(urlPathEqualTo("/orders")).withRequestBody(containing("abc")));
```

`getRequestedFor`, `postRequestedFor`, `putRequestedFor`, `deleteRequestedFor`, `patchRequestedFor` and `anyRequestedFor` build verification patterns and accept `.withHeader` / `.withQueryParam` / `.withRequestBody`.

## CLI

```bash
wiremock-ts --port 8080 --host 127.0.0.1 --mappings ./mappings
```

`--mappings <dir>` loads every `*.json` file in the directory; each file is either a single stub mapping or `{ "mappings": [ ... ] }`.

## Admin API

Served on the same port under `/__admin`:

| Method & path                   | Purpose                           |
| ------------------------------- | --------------------------------- |
| `GET /__admin/health`           | Liveness                          |
| `GET /__admin/mappings`         | List stubs                        |
| `POST /__admin/mappings`        | Register a stub (`201`)           |
| `GET /__admin/mappings/{id}`    | Fetch one stub                    |
| `DELETE /__admin/mappings/{id}` | Delete one stub                   |
| `POST /__admin/mappings/reset`  | Clear all stubs                   |
| `GET /__admin/requests`         | Request journal                   |
| `DELETE /__admin/requests`      | Clear the journal                 |
| `POST /__admin/requests/count`  | Count requests matching a pattern |
| `POST /__admin/requests/find`   | Find requests matching a pattern  |
| `POST /__admin/reset`           | Reset stubs **and** journal       |

Request bodies are validated with `zod`; malformed JSON or schema-invalid mappings return `400`.

## API reference

`WireMockServer` (and `startMock(options)`, which constructs and starts in one call):

- Lifecycle: `start()`, `stop()`, `baseUrl`, `port`, `[Symbol.asyncDispose]`
- Stubbing: `stubFor(mapping)` / `register(mapping)`, `listMappings()`, `loadOpenApi(doc)`
- Verification: `verify(pattern, count?)`, `assertReceived(pattern, count?)`, `countRequests(pattern)`, `findRequests(pattern)`
- Reset: `resetMappings()`, `resetRequests()`, `resetAll()`
- Record: `startRecording(targetBaseUrl)`, `stopRecording()`, `isRecording`
- Interception: `interceptFetch(options?)`, `restoreFetch()`

`pattern` accepts a plain `RequestPattern` or any `*RequestedFor(...)` builder. Builders, content matchers, response builders, and the OpenAPI helpers are all exported from the package root.

## Testing

The suite is **45 tests** run with [Vitest](https://vitest.dev/), split between:

- **Unit tests** for pure logic — content matchers, the request matcher, the template renderer, OpenAPI generation, and the builders.
- **Integration tests** that start a real server on an ephemeral port and drive it over `fetch` — stubbing, scenarios, faults, templating, proxying, record/playback, the admin API, and `fetch` interception. Proxy and record/playback tests run a second server as the upstream.

Coverage (`npm run test:coverage`, V8 provider): **~87% statements, ~90% lines, ~90% functions, ~74% branches**. The `cli.ts` entrypoint is excluded from the figure — it's verified by an end-to-end run (and by the `fleet mock` integration that spawns it) rather than unit tests; `index.ts` is excluded as it only re-exports.

## Scripts

| Script                  | Description                                |
| ----------------------- | ------------------------------------------ |
| `npm run dev`           | Run the CLI under `tsx watch`              |
| `npm run build`         | Bundle to `dist/` (ESM + `.d.ts`) via tsup |
| `npm test`              | Run the Vitest suite                       |
| `npm run test:coverage` | Run the suite with a coverage report       |
| `npm run typecheck`     | `tsc --noEmit`                             |
| `npm run lint`          | ESLint (flat config)                       |
| `npm run format`        | Prettier (formats and sorts imports)       |

## Roadmap

- Standalone remote HTTP client SDK
- GraphQL / gRPC / WebSocket mocking
- Deep request/response schema validation against the contract

## Licence

MIT © Hesketh Web Design
