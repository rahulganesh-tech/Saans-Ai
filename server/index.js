// Saans AI — entry point. Routes requests to the static file server or the
// /api/plan handler. Module layout:
//   config.js           shared constants / env
//   securityHeaders.js   response security headers (CSP, HSTS, etc.)
//   validate.js          input validation + sanitization for /api/plan
//   gemini.js            prompt building + the Gemini API call
//   staticFiles.js        static file serving (gzip, caching, path-traversal guard)
import http from "node:http";
import { PORT, GEMINI_API_KEY, MAX_REQUEST_BODY_BYTES } from "./config.js";
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

// The same realistic sample plan used by the frontend's "Try Demo" button —
// returned whenever Gemini is unavailable, over quota, missing a key, or
// returns something invalid, so the user never sees a blank screen or a
// raw error.
const FALLBACK_PLAN = {
  routine: [
    { time: "Morning (7-9am)", activity: "Keep windows closed; run the kitchen exhaust while cooking breakfast", why: "Indoor cooking fumes add to an already poor outdoor AQI" },
    { time: "School drop-off (8am)", activity: "Drive or carpool with windows up instead of walking", why: "Cuts direct exposure during the coldest, smoggiest part of the morning" },
    { time: "Midday (12-2pm)", activity: "If you must go out, go now — AQI is usually at its least-bad this window", why: "Winter smog is typically worst at night and early morning" },
    { time: "Afternoon (3-5pm)", activity: "Move outdoor play to an indoor activity today", why: "Matches today's reduced safe-outdoor-time budget" },
    { time: "Evening (6-8pm)", activity: "Keep windows shut as temperatures drop and smog settles", why: "Pollutant levels typically spike again after sunset" },
  ],
  indoorHacks: [
    { hack: "Keep one indoor plant-free, clutter-free room as a 'clean air room' with the door shut", benefit: "Easier to keep genuinely low-dust than the whole house" },
    { hack: "Damp-mop floors instead of dry-sweeping", benefit: "Dry sweeping re-suspends settled particulate matter" },
    { hack: "Avoid burning incense, candles, or agarbatti indoors today", benefit: "Adds to indoor particulate load on an already bad air day" },
    { hack: "Crack a single window for 10 minutes around midday only, if ventilating", benefit: "Midday is usually the least polluted window" },
  ],
  alternatives: [
    { insteadOf: "Morning jog outdoors", tryThis: "Indoor bodyweight routine or stair climbs", impact: "Avoids peak-exposure outdoor exertion that increases how much polluted air you breathe in" },
    { insteadOf: "Walking kids to school", tryThis: "Drive or carpool with windows up", impact: "Meaningfully cuts a vulnerable child's direct smog exposure time" },
    { insteadOf: "Burning leaves or waste in the yard", tryThis: "Compost or municipal waste collection", impact: "Removes a direct, local source of smoke on top of the regional smog" },
    { insteadOf: "Evening market errands on foot", tryThis: "Combine errands into one short car trip, or shift to midday", impact: "Less time breathing outdoor air during the worst pollution window" },
  ],
};

const server = http.createServer((req, res) => {
  const urlPath = req.url.split("?")[0];

  if (req.method === "POST" && urlPath === "/api/plan") {
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
