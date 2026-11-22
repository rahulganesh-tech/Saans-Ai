// Automated test suite for Saans AI. Spawns the server as a child process
// on a dedicated test port and exercises it over real HTTP, so these tests
// verify actual request/response behavior, not just internal function calls.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const PORT = 8099;
const BASE = `http://localhost:${PORT}`;
let child;

before(async () => {
  child = spawn("node", ["server/index.js"], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: "ignore",
  });
  // Give the server a moment to bind the port.
  await new Promise((resolve) => setTimeout(resolve, 400));
});

after(() => {
  child.kill();
});

test("GET / serves the frontend HTML", async () => {
  const resp = await fetch(`${BASE}/`);
  assert.equal(resp.status, 200);
  const text = await resp.text();
  assert.match(text, /<title>Saans AI/);
});

test("GET /app.js serves JavaScript", async () => {
  const resp = await fetch(`${BASE}/app.js`);
  assert.equal(resp.status, 200);
  assert.match(resp.headers.get("content-type"), /javascript/);
});

test("GET /styles.css serves CSS", async () => {
  const resp = await fetch(`${BASE}/styles.css`);
  assert.equal(resp.status, 200);
  assert.match(resp.headers.get("content-type"), /css/);
});

test("GET /healthz reports ok", async () => {
  const resp = await fetch(`${BASE}/healthz`);
  assert.equal(resp.status, 200);
  const data = await resp.json();
  assert.equal(data.ok, true);
});

test("GET /does-not-exist returns 404, not a crash", async () => {
  const resp = await fetch(`${BASE}/does-not-exist`);
  assert.equal(resp.status, 404);
});

test("POST /api/plan without a description returns 400", async () => {
  const resp = await fetch(`${BASE}/api/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ city: "Delhi", aqiBand: "Poor" }),
  });
  assert.equal(resp.status, 400);
});

test("POST /api/plan with invalid JSON body returns 400, not a crash", async () => {
  const resp = await fetch(`${BASE}/api/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{not valid json",
  });
  assert.equal(resp.status, 400);
});

test("POST /api/plan with a valid description never returns a blank/empty body, even without a Gemini key", async () => {
  const resp = await fetch(`${BASE}/api/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      description: "Kids have school, planning an evening walk.",
      city: "Delhi",
      aqiBand: "Severe",
      household: ["School-age children"],
    }),
  });
  assert.equal(resp.status, 200);
  const data = await resp.json();
  assert.ok(Array.isArray(data.routine) && data.routine.length > 0);
  assert.ok(Array.isArray(data.indoorHacks) && data.indoorHacks.length > 0);
  assert.ok(Array.isArray(data.alternatives) && data.alternatives.length > 0);
  assert.equal(data.source, "fallback"); // no GEMINI_API_KEY set in test env
});

test("path traversal outside public/ is rejected, not served", async () => {
  const resp = await fetch(`${BASE}/../package.json`);
  assert.notEqual(resp.status, 200);
});

test("responses carry security headers", async () => {
  const resp = await fetch(`${BASE}/`);
  assert.ok(resp.headers.get("content-security-policy"));
  assert.ok(resp.headers.get("x-frame-options"));
  assert.ok(resp.headers.get("x-content-type-options"));
});

test("an oversized /api/plan request body is rejected with 413", async () => {
  const bigDescription = "a".repeat(20_000);
  const resp = await fetch(`${BASE}/api/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description: bigDescription, city: "Delhi", aqiBand: "Poor" }),
  });
  assert.equal(resp.status, 413);
});

test("an unexpected HTTP method is rejected with 405, not served as a file", async () => {
  const resp = await fetch(`${BASE}/`, { method: "DELETE" });
  assert.equal(resp.status, 405);
});

test("an invalid AQI band falls back to a safe default instead of crashing", async () => {
  const resp = await fetch(`${BASE}/api/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description: "Test plan", city: "Delhi", aqiBand: "Nonsense", household: ["not-a-real-flag"] }),
  });
  assert.equal(resp.status, 200);
});

test("static assets are served gzip-compressed when the client accepts it", async () => {
  // Node's fetch/undici transparently decompresses a gzip response before
  // handing back the body, so we check the header the server set rather
  // than re-gunzipping an already-decompressed payload.
  const resp = await fetch(`${BASE}/app.js`, { headers: { "Accept-Encoding": "gzip" } });
  assert.equal(resp.headers.get("content-encoding"), "gzip");
  const text = await resp.text();
  assert.match(text, /DEMO_PLAN/);
});

test("GET /api/plan returns 405 Method Not Allowed", async () => {
  const resp = await fetch(`${BASE}/api/plan`);
  assert.equal(resp.status, 405);
});

test("GET / includes CPCB AQI bands and scenario presets", async () => {
  const resp = await fetch(`${BASE}/`);
  const html = await resp.text();
  assert.match(html, /data-scenario="priya"/);
  assert.match(html, /CPCB/i);
});
