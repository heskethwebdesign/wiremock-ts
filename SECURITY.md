# Security Policy

## Supported versions

The latest published version of `wiremock-ts` receives security fixes.

## Reporting a vulnerability

Please report security issues **privately** through GitHub Security Advisories —
<https://github.com/wrxck/wiremock-ts/security/advisories/new> — rather than opening a public issue. You can expect an acknowledgement within a few days.

## Intended use and hardening

wiremock-ts is a development and testing mock server. It binds to `127.0.0.1` by default; keep it bound to localhost in any untrusted environment. Two capabilities are sensitive if the server is reachable by others:

- **The `/__admin` API is unauthenticated** unless you set the `adminToken` option. It can register and delete stubs, reset state, and read the request journal — which contains the headers and bodies the system-under-test sent (potentially credentials or PII). With `adminToken` set, every `/__admin` request must present it via `Authorization: Bearer <token>` or `X-Admin-Token: <token>`.
- **Proxying and recording can issue outbound requests to arbitrary hosts** (`proxiedFrom`, `proxyBaseUrl`, `startRecording`), which is an SSRF vector if the admin port is exposed. Set the `allowedProxyHosts` option to restrict targets to an explicit hostname allowlist; other targets are refused.

If you must expose the server beyond localhost, set both `adminToken` and `allowedProxyHosts`, and treat the request journal as sensitive data.
