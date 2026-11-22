// Static file serving: gzip compression, caching, and a path-traversal
// guard so a request can never escape public/ via "../" tricks.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { PUBLIC_DIR, MIME_TYPES, STATIC_CACHE_CONTROL } from "./config.js";
import { applySecurityHeaders } from "./securityHeaders.js";

/**
 * Serves a static file from public/ if the resolved path stays inside it;
 * otherwise responds 404. Gzips text-like assets when the client accepts
 * gzip encoding.
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
export function serveStatic(req, res) {
  const urlPath = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const resolved = path.normalize(path.join(PUBLIC_DIR, urlPath));

  // Path-traversal guard: the resolved path must stay inside PUBLIC_DIR.
  if (!resolved.startsWith(PUBLIC_DIR)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  fs.readFile(resolved, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(resolved);
    const mime = MIME_TYPES[ext] || "application/octet-stream";
    applySecurityHeaders(res);
    res.setHeader("Content-Type", mime);
    res.setHeader("Cache-Control", STATIC_CACHE_CONTROL);

    const acceptsGzip = (req.headers["accept-encoding"] || "").includes("gzip");
    const isCompressible = [".html", ".js", ".css", ".json", ".svg"].includes(ext);

    if (acceptsGzip && isCompressible) {
      res.setHeader("Content-Encoding", "gzip");
      res.writeHead(200);
      res.end(zlib.gzipSync(content));
    } else {
      res.writeHead(200);
      res.end(content);
    }
  });
}
