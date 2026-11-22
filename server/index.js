// Saans AI — entry point. Routes requests to the static file server or the
// /api/plan handler. Module layout:
//   config.js           shared constants / env
//   securityHeaders.js   response security headers (CSP, HSTS, etc.)
//   validate.js          input validation + sanitization for /api/plan
//   gemini.js            prompt building + the Gemini API call
//   staticFiles.js        static file serving (gzip, caching, path-traversal guard)
import http from "node:http";
import { PORT, GEMINI_API_KEY, MAX_REQUEST_BODY_BYTES, FALLBACK_PLAN } from "./config.js";
import { applySecurityHeaders } from "./securityHeaders.js";
import { validatePlanRequest } from "./validate.js";
import { callGemini } from "./gemini.js";
import { serveStatic } from "./staticFiles.js";

/**
 * Writes a JSON response with the standard security headers applied.
 * @param {import('http').ServerResponse} res
 * @param {number} status - HTTP status code.
 * @param {object} obj - Serialized as the response body.
 */
function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  applySecurityHeaders(res);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

/**
 * Handles POST /api/plan end-to-end: streams and size-limits the request
 * body, parses and validates it, calls Gemini, and always responds with a
 * usable plan — either a live one or the graceful fallback — never a raw
 * error or an unhandled rejection.
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
function handleApiPlan(req, res) {
  let body = "";
  let tooLarge = false;

  req.on("data", (chunk) => {
    if (tooLarge) return;
    body += chunk;
    if (body.length > MAX_REQUEST_BODY_BYTES) {
      tooLarge = true;
      sendJSON(res, 413, { error: "Request too large." });
      req.destroy();
    }
  });

  req.on("end", async () => {
    if (tooLarge) return;

    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      sendJSON(res, 400, { error: "Invalid JSON body." });
      return;
    }

    const validation = validatePlanRequest(payload);
    if (!validation.ok) {
      sendJSON(res, 400, { error: validation.error });
      return;
    }

    try {
      const plan = await callGemini(validation.data);
      sendJSON(res, 200, { ...plan, source: "live" });
    } catch {
      sendJSON(res, 200, { ...FALLBACK_PLAN, source: "fallback" });
    }
  });

  req.on("error", () => {});
}

const server = http.createServer((req, res) => {
  const urlPath = req.url.split("?")[0];

  if (urlPath === "/api/plan") {
    if (req.method !== "POST") {
      sendJSON(res, 405, { error: "Method not allowed." });
      return;
    }
    handleApiPlan(req, res);
    return;
  }

  if (req.method === "GET" && urlPath === "/healthz") {
    sendJSON(res, 200, { ok: true, geminiConfigured: Boolean(GEMINI_API_KEY) });
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJSON(res, 405, { error: "Method not allowed." });
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Saans AI listening on port ${PORT}`);
});

export default server;
