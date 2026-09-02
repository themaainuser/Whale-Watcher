/**
 * Webhook security e2e — boots the real HTTP listener and checks the
 * HMAC-SHA256 signature gate in both directions (C2).
 * Run: npm run test:unit
 */
import crypto from "node:crypto";
import http from "node:http";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { startEthWebhook } from "../src/listeners/eth.js";
import type { NormalizedTransfer } from "../src/types.js";

const SECRET = "test-signing-key-0123456789abcdef";
// Port 0 = ephemeral: no fixed port to collide with, safe for parallel runs.
const PORT = 0;

let server: http.Server | null = null;
let boundPort = 0;
let received: NormalizedTransfer[] = [];

const body = JSON.stringify({
  event: {
    activity: [
      {
        hash: "0x" + "cd".repeat(32),
        fromAddress: "0xaaa1",
        toAddress: "0xbbb2",
        value: "1500", // native ETH: human units per Alchemy docs
        asset: "ETH",
        blockNum: "0x1234abc",
        logId: "0x" + "cd".repeat(32) + "_2a",
      },
    ],
  },
});

function signWith(key: string): string {
  return crypto.createHmac("sha256", key).update(body).digest("hex");
}

function post(headers: Record<string, string>): Promise<{ status: number | undefined }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: boundPort,
        path: "/alchemy-webhook",
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve({ status: res.statusCode }));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

describe("eth webhook signature gate", () => {
  before(async () => {
    process.env.ALCHEMY_SIGNING_KEY = SECRET;
    process.env.PORT = String(PORT);
    server = startEthWebhook(async (t) => {
      received.push(t);
    });
    if (!server) throw new Error("webhook server failed to start");
    await new Promise<void>((resolve, reject) => {
      server!.once("listening", () => resolve());
      server!.once("error", reject);
    });
    const addr = server.address();
    if (addr === null || typeof addr === "string") throw new Error("unexpected address");
    boundPort = addr.port;
  });

  after(() => {
    return new Promise<void>((resolve) => {
      server?.close(() => resolve());
      server = null;
    });
  });

  it("accepts a valid signature and processes the activity once", async () => {
    const res = await post({ "x-alchemy-signature": signWith(SECRET) });
    assert.equal(res.status, 200);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(received.length, 1);
    assert.equal(received[0].amount, 1500);
  });

  it("rejects an invalid signature (401)", async () => {
    const res = await post({ "x-alchemy-signature": "0".repeat(64) });
    assert.equal(res.status, 401);
  });

  it("rejects a missing signature (401)", async () => {
    const res = await post({});
    assert.equal(res.status, 401);
  });

  it("rejects a signature made with the wrong key (401)", async () => {
    const res = await post({ "x-alchemy-signature": signWith("other-key") });
    assert.equal(res.status, 401);
  });

  it("processed exactly one transfer overall", () => {
    assert.equal(received.length, 1);
  });
});
