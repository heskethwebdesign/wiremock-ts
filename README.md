# wiremock-ts

A TypeScript-first HTTP mock server — [WireMock](https://wiremock.org/), reimagined for the Node/TS ecosystem.

Stand up a real HTTP server that returns the responses you stub, match incoming
requests on (almost) anything, and verify what your code actually sent — all
through a fully-typed, fluent API, a REST admin API, or a CLI.

## Why

- **TypeScript-native** — fluent builders with full type inference; no Java, no
  loosely-typed JSON to hand-write.
- **Tiny** — runs on Node's built-in `http`; only `zod` and `jsonpath-plus` at
  runtime.
- **Familiar** — the stub/request/response model and the `/__admin` API mirror
  WireMock, so existing mental models carry over.

## Install

```bash
npm install --save-dev wiremock-ts
```

## Quick start (programmatic)

```ts
import { equalToJson, get, ok, okJson, post, urlPathEqualTo, WireMockServer } from "wiremock-ts";

const wm = await new WireMockServer({ port: 8080 }).start();

wm.stubFor(get(urlPathEqualTo("/api/user")).willReturn(okJson({ id: 1, name: "ada" })));

wm.stubFor(
    post(urlPathEqualTo("/orders"))
        .withRequestBody(equalToJson({ sku: "abc" }))
        .willReturn(ok("accepted")),
);

// ... point your code at wm.baseUrl, then verify:
wm.verify({ method: "POST", urlPath: "/orders" }, 1); // true if called exactly once

await wm.stop();
```

Use `port: 0` to bind an ephemeral port (ideal for parallel tests); read the
chosen address from `wm.baseUrl`.

## CLI

```bash
wiremock-ts --port 8080 --host 127.0.0.1 --mappings ./mappings
```

`--mappings <dir>` loads every `*.json` file in the directory; each file is
either a single stub mapping or `{ "mappings": [ ... ] }`.

## Admin API

Served on the same port under `/__admin`:

| Method & path                   | Purpose                           |
| ------------------------------- | --------------------------------- |
| `GET  /__admin/health`          | Liveness                          |
| `GET  /__admin/mappings`        | List stubs                        |
| `POST /__admin/mappings`        | Register a stub (201)             |
| `GET  /__admin/mappings/{id}`   | Fetch one stub                    |
| `DELETE /__admin/mappings/{id}` | Delete one stub                   |
| `POST /__admin/mappings/reset`  | Clear all stubs                   |
| `GET  /__admin/requests`        | Request journal                   |
| `DELETE /__admin/requests`      | Clear the journal                 |
| `POST /__admin/requests/count`  | Count requests matching a pattern |
| `POST /__admin/requests/find`   | Find requests matching a pattern  |
| `POST /__admin/reset`           | Reset stubs **and** journal       |

## Matching

Requests are matched on `method`, url (`url` exact, `urlPath`, `urlPathPattern`
regex, `urlPattern` regex over path+query), `queryParameters`, `headers`, and
`bodyPatterns`. Each value uses a content pattern: `equalTo` (with
`caseInsensitive`), `contains`, `matches` / `doesNotMatch` (regex),
`equalToJson` (with `ignoreExtraElements` / `ignoreArrayOrder`),
`matchesJsonPath`, or `absent`. When several stubs match, the lowest `priority`
wins; on a tie the most recently registered stub wins.

## Scripts

| Script              | Description                        |
| ------------------- | ---------------------------------- |
| `npm run dev`       | Run the CLI under `tsx watch`      |
| `npm run build`     | Bundle to `dist/` (ESM + `.d.ts`)  |
| `npm test`          | Run the vitest suite               |
| `npm run typecheck` | `tsc --noEmit`                     |
| `npm run lint`      | ESLint                             |
| `npm run format`    | Prettier (formats + sorts imports) |

## Roadmap

- Response templating (Handlebars-style)
- Proxying and record/playback
- Stateful scenarios
- Standalone HTTP client SDK
- Native [fleet](https://github.com/) integration (`fleet mock`)

## Licence

MIT © Hesketh Web Design
