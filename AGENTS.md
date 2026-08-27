# Project instructions

- Runtime: Node.js 22 or newer, TypeScript, esbuild, Vitest and jsdom.
- Run `npm test`, `npm run check`, and `npm run build` before handing off changes.
- Keep the bookmarklet self-contained: runtime code must not fetch scripts, analytics, or Facebook data to a server.
- Treat Facebook DOM as unstable. Prefer semantic attributes and tested fallbacks over generated CSS class names.
- Never collect cookies, passwords, access tokens, or hidden API responses.
- Keep the UI usable on narrow touch screens and render untrusted Facebook text with `textContent` only.
- `dist/` is generated and must not be committed.
