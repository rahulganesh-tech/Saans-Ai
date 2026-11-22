import { applySecurityHeaders } from "../server/securityHeaders.js";
import { GEMINI_API_KEY } from "../server/config.js";

export default function handler(req, res) {
  applySecurityHeaders(res);
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Method not allowed." }));
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ ok: true, geminiConfigured: Boolean(GEMINI_API_KEY) }));
}
