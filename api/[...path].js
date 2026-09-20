import { createApi } from "../backend/api.js";

// One catch-all function serves every /api route, using the same logic as the local
// server. Replaces the previous rewrite to Render, whose free tier slept between
// reading sessions and cost ~30s to wake.
const api = createApi();

export default async function handler(req, res) {
  const pathname = new URL(req.url, `https://${req.headers.host}`).pathname;

  // Vercel may have already parsed the body; fall back to the raw stream when not.
  const readBody = async (limit) => {
    if (req.body !== undefined && req.body !== null) {
      const raw = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
      const buffer = Buffer.from(raw);
      if (buffer.length > limit) throw Object.assign(new Error("Request is too large."), { status: 413 });
      return buffer;
    }
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) throw Object.assign(new Error("Request is too large."), { status: 413 });
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  };

  res.setHeader("Cache-Control", "no-store");
  try {
    const result = await api.handle({
      method: req.method,
      pathname,
      headers: req.headers,
      readBody,
    });
    for (const [key, value] of Object.entries(result.headers || {})) res.setHeader(key, value);

    if (result.stream) {
      res.writeHead(result.status, {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Accel-Buffering": "no",
      });
      for await (const delta of result.stream) res.write(delta);
      res.end();
      return;
    }
    res.status(result.status).json(result.body);
  } catch (err) {
    if (res.headersSent) { res.end(); return; }
    res.status(err.status || 500).json({
      error: err.status ? err.message : "An unexpected server error occurred.",
    });
  }
}
