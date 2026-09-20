import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createApi, HttpError } from "./api.js";

const root = fileURLToPath(new URL("../frontend/", import.meta.url));

const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".gz": "application/octet-stream",
};

export function createServer({ env = process.env, fetchImpl = fetch } = {}) {
  const api = createApi({ env, fetchImpl });

  const readBody = (req) => async (limit) => {
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) throw new HttpError(413, "Request is too large.");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  };

  return http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    );
    try {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname.startsWith("/api/")) {
        res.setHeader("Cache-Control", "no-store");
        const result = await api.handle({
          method: req.method,
          pathname: url.pathname,
          headers: req.headers,
          readBody: readBody(req),
        });
        for (const [key, value] of Object.entries(result.headers || {}))
          res.setHeader(key, value);

        if (result.stream) {
          res.writeHead(result.status, {
            "Content-Type": "text/plain; charset=utf-8",
            "X-Accel-Buffering": "no",
          });
          for await (const delta of result.stream) res.write(delta);
          res.end();
          return;
        }
        res.writeHead(result.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result.body));
        return;
      }

      if (!["GET", "HEAD"].includes(req.method))
        throw new HttpError(405, "Method not allowed.");
      const pathname = decodeURIComponent(url.pathname);
      const relative = pathname === "/" ? "index.html" : pathname.slice(1);
      if (relative.split("/").some((p) => p.startsWith(".")) || relative === "js/config.js")
        throw new HttpError(404, "Not found.");
      const file = path.resolve(root, relative);
      if (!file.startsWith(root)) throw new HttpError(404, "Not found.");
      const body = await readFile(file).catch(() => {
        throw new HttpError(404, "Not found.");
      });
      res.writeHead(200, {
        "Content-Type": TYPES[path.extname(file)] || "application/octet-stream",
        "Cache-Control": "no-cache",
      });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch (err) {
      if (res.headersSent) { res.end(); return; }
      res.writeHead(err.status || 500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        error: err.status ? err.message : "An unexpected server error occurred.",
      }));
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = process.env.HOST || "127.0.0.1";
  const port = Number(process.env.PORT || 3000);
  createServer().listen(port, host, () =>
    console.log(`Yomu is ready at http://${host}:${port}`),
  );
}
