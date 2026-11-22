/**
 * Applies the standard security header set to every response: CSP, HSTS,
 * X-Frame-Options, X-Content-Type-Options, Referrer-Policy, and
 * Permissions-Policy. Kept as a single explicit function (rather than a
 * third-party middleware) so every header is easy to audit at a glance.
 * @param {import('http').ServerResponse} res
 */
export function applySecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Permissions-Policy",
    "geolocation=(), camera=(), microphone=(), payment=(), usb=()"
  );
  res.setHeader(
    "Strict-Transport-Security",
    "max-age=63072000; includeSubDomains; preload"
  );
  // style-src needs 'unsafe-inline' because the frontend sets el.style.width
  // on the exposure-budget bar via JS (CSSOM inline-style assignment is
  // governed by CSP style-src, confirmed empirically). script-src stays
  // strict with no exception.
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data:; connect-src 'self'; base-uri 'none'; " +
      "frame-ancestors 'none'; form-action 'none'; object-src 'none'"
  );
}
