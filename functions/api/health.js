/**
 * Cloudflare Pages Function: health probe.
 */

function json(payload) {
  return new Response(JSON.stringify(payload), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function onRequestGet() {
  return json({
    ok: true,
    runtime: "cloudflare-pages",
    version: "1.0.0",
  });
}
