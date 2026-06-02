import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import { startMock, WireMockServer } from "../src/index";

let server: WireMockServer;

beforeEach(async () => {
    server = await startMock({ port: 0 });
});
afterEach(async () => {
    await server.stop();
});

const wsUrl = (path: string): string => `${server.baseUrl.replace(/^http/, "ws")}${path}`;

// connect, run an optional action once open, and resolve once `count` messages
// have arrived (or reject on error/timeout).
function collect(
    path: string,
    count: number,
    afterOpen?: (ws: WebSocket) => void,
): Promise<string[]> {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl(path));
        const messages: string[] = [];
        const timer = setTimeout(() => {
            ws.terminate();
            reject(new Error("timed out waiting for messages"));
        }, 2000);
        ws.on("open", () => afterOpen?.(ws));
        ws.on("message", (data: { toString(): string }) => {
            messages.push(data.toString());
            if (messages.length >= count) {
                clearTimeout(timer);
                ws.close();
                resolve(messages);
            }
        });
        ws.on("error", (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}

describe("websocket mocking", () => {
    it("pushes scripted messages on connect", async () => {
        server.stubWebSocket("/ws", { onConnect: ["hello", "world"] });
        expect(await collect("/ws", 2)).toEqual(["hello", "world"]);
    });

    it("echoes received messages", async () => {
        server.stubWebSocket("/echo", { echo: true });
        const got = await collect("/echo", 1, (ws) => ws.send("ping"));
        expect(got).toEqual(["ping"]);
    });

    it("computes replies", async () => {
        server.stubWebSocket("/reply", {
            reply: (message) => (message === "ping" ? "pong" : undefined),
        });
        const got = await collect("/reply", 1, (ws) => ws.send("ping"));
        expect(got).toEqual(["pong"]);
    });

    it("rejects connections to an unstubbed path", async () => {
        const failed = await new Promise<boolean>((resolve) => {
            const ws = new WebSocket(wsUrl("/nope"));
            ws.on("open", () => {
                ws.close();
                resolve(false);
            });
            ws.on("error", () => resolve(true));
            ws.on("close", () => resolve(true));
        });
        expect(failed).toBe(true);
    });
});
