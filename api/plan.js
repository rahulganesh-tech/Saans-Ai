import { applySecurityHeaders } from "../server/securityHeaders.js";
import { validatePlanRequest } from "../server/validate.js";
import { callGemini } from "../server/gemini.js";
import { FALLBACK_PLAN, MAX_REQUEST_BODY_BYTES } from "../server/config.js";

export default async function handler(req, res) {
  applySecurityHeaders(res);

  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Method not allowed." }));
    return;
  }

  let payload = req.body;
  if (!payload || typeof payload !== "object") {
    try {
      const chunks = [];
      let totalLength = 0;
      for await (const chunk of req) {
        totalLength += chunk.length;
        if (totalLength > MAX_REQUEST_BODY_BYTES) {
          res.writeHead(413, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "Request too large." }));
          return;
        }
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks).toString("utf-8");
      payload = JSON.parse(raw);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Invalid JSON body." }));
      return;
    }
  }

  const validation = validatePlanRequest(payload);
  if (!validation.ok) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: validation.error }));
    return;
  }

  try {
    const plan = await callGemini(validation.data);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ...plan, source: "live" }));
  } catch {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ...FALLBACK_PLAN, source: "fallback" }));
  }
}
