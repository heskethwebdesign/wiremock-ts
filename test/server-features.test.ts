import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { aResponse, get, ok, urlPathEqualTo, WireMockServer } from "../src/index";

let server: WireMockServer;

beforeEach(async () => {
    server = await new WireMockServer({ port: 0 }).start();
});

afterEach(async () => {
    await server.stop();
});

describe("stateful scenarios", () => {
    it("advances through scenario states", async () => {
        server.stubFor(
            get(urlPathEqualTo("/state"))
                .inScenario("orders")
                .whenScenarioStateIs("Started")
                .willSetStateTo("second")
                .willReturn(ok("first")),
        );
        server.stubFor(
            get(urlPathEqualTo("/state"))
                .inScenario("orders")
                .whenScenarioStateIs("second")
                .willReturn(ok("second")),
        );

        expect(await (await fetch(`${server.baseUrl}/state`)).text()).toBe("first");
        expect(await (await fetch(`${server.baseUrl}/state`)).text()).toBe("second");
        expect(await (await fetch(`${server.baseUrl}/state`)).text()).toBe("second");
    });
});

describe("response templating", () => {
    it("renders request data into the response when transform is enabled", async () => {
        server.stubFor(
            get(urlPathEqualTo("/echo")).willReturn(
                aResponse()
                    .withStatus(200)
                    .withBody("path={{request.path}} n={{request.query.n}}")
                    .withTransform(),
            ),
        );

        const res = await fetch(`${server.baseUrl}/echo?n=7`);
        expect(await res.text()).toBe("path=/echo n=7");
    });
});

describe("fault injection", () => {
    it("connection-reset aborts the request", async () => {
        server.stubFor(
            get(urlPathEqualTo("/boom")).willReturn(aResponse().withFault("connection-reset")),
        );
        await expect(fetch(`${server.baseUrl}/boom`)).rejects.toThrow();
    });

    it("empty-response closes without a valid http response", async () => {
        server.stubFor(
            get(urlPathEqualTo("/empty")).willReturn(aResponse().withFault("empty-response")),
        );
        await expect(fetch(`${server.baseUrl}/empty`)).rejects.toThrow();
    });
});
