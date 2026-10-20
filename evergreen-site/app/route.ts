// @ts-expect-error Vite resolves the shared vanilla HTML frontend at build time.
import html from "../frontend/index.html?raw";

export const dynamic = "force-dynamic";
export function GET() {
  return new Response(html, { headers: {
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'self' https://chatgpt.com https://*.chatgpt.com",
  } });
}
