import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../backend/server.js";
const cookies = new Map();
async function server(t, options = {}) {
  const app = createServer({...options, env: {APP_PASSWORD: "test-password", ...options.env}});
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => app.close(resolve)));
  const base = `http://127.0.0.1:${app.address().port}`;
  const login = await post(base + "/api/login", {password: "test-password"});
  cookies.set(base, login.headers.get("set-cookie").split(";")[0]);
  return base;
}
const post = (url, data, headers = {}) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookies.get(new URL(url).origin) || "", ...headers },
    body: JSON.stringify(data),
  });
const input = {
  text: "そんなに無理しなくてもいいんだよ。",
  context: "",
  level: "N3",
};
const explanation = {simpleJapanese: "がんばりすぎなくてもいい。"};

test("status reveals capabilities, never credentials; server files cannot be downloaded", async (t) => {
  const base = await server(t, { env: { OPENAI_API_KEY: "super-secret" } });
  const status = await (await fetch(base + "/api/status")).text();
  assert(!status.includes("super-secret"));
  assert.equal(JSON.parse(status).explanations, true);
  for (const file of [
    "/.env",
    "/backend/server.js",
    "/data/index.json",
    "/js/config.js",
    "/.git/config",
  ])
    assert.equal((await fetch(base + file)).status, 404);
});
test("validates methods, JSON, text length, origin and missing provider setup", async (t) => {
  const base = await server(t, { env: {} });
  assert.equal((await fetch(base + "/api/explain")).status, 405);
  assert.equal((await post(base + "/api/explain", {})).status, 400);
  assert.equal(
    (await post(base + "/api/explain", { ...input, text: "x".repeat(6001) }))
      .status,
    400,
  );
  assert.equal(
    (
      await post(base + "/api/explain", input, {
        Origin: "https://evil.example",
      })
    ).status,
    403,
  );
  assert.equal((await post(base + "/api/explain", input)).status, 503);
  assert.equal(
    (
      await fetch(base + "/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookies.get(base) },
        body: "oops",
      })
    ).status,
    400,
  );
  assert.equal(
    (await fetch(base + "/api/explain", { method: "POST", body: "{}", headers: {Cookie: cookies.get(base)} })).status,
    415,
  );
  assert.equal(
    (
      await post(base + "/api/explain", {
        ...input,
        context: "x".repeat(110000),
      })
    ).status,
    413,
  );
});
test("explanation uses server credentials and preserves whole selected passage and context", async (t) => {
  let request;
  const base = await server(t, {
    env: {
      OPENAI_API_KEY: "private-key",
      ALLOWED_ORIGINS: "https://personal.vercel.app",
    },
    fetchImpl: async (url, options) => {
      request = { url, ...options };
      return Response.json({
        output: [
          {
            content: [
              { type: "output_text", text: JSON.stringify(explanation) },
            ],
          },
        ],
      });
    },
  });
  const res = await post(base + "/api/explain", input, {
    Origin: "https://personal.vercel.app",
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), explanation);
  assert.equal(request.headers.Authorization, "Bearer private-key");
  const body = JSON.parse(request.body);
  assert.deepEqual(JSON.parse(body.input[0].content), input);
  assert(body.instructions.includes("日本語だけ"));
  assert.deepEqual(body.text.format.schema.required, ["simpleJapanese"]);
});
test("malformed AI output and provider errors are recoverable without leaking secrets", async (t) => {
  const base = await server(t, {
    env: { OPENAI_API_KEY: "private-key" },
    fetchImpl: async () =>
      Response.json({
        output: [
          { content: [{ type: "output_text", text: '{"meaning":"partial"}' }] },
        ],
      }),
  });
  assert.equal((await post(base + "/api/explain", input)).status, 502);
  const other = await server(t, {
    env: { OPENAI_API_KEY: "private-key" },
    fetchImpl: async () => {
      throw new Error("private-key");
    },
  });
  const res = await post(other + "/api/explain", input);
  assert.equal(res.status, 502);
  assert(!(await res.text()).includes("private-key"));
});
test("OCR uses a server-only header and returns paragraphs for selection", async (t) => {
  let request;
  const payload = {
    textAnnotations: [{ description: "日本語" }],
    fullTextAnnotation: { text: "日本語", pages: [] },
  };
  const base = await server(t, {
    env: { GOOGLE_VISION_API_KEY: "vision-secret" },
    fetchImpl: async (url, options) => {
      request = { url, ...options };
      return Response.json({ responses: [payload] });
    },
  });
  const res = await post(base + "/api/vision", { image: "aGVsbG8=" });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), payload);
  assert.equal(request.headers["X-Goog-Api-Key"], "vision-secret");
  assert(!request.url.includes("vision-secret"));
  assert.equal(
    (await post(base + "/api/vision", { image: "bad ! image" })).status,
    400,
  );
});

test("password protects paid APIs and persistent signed sessions reject tampering", async (t) => {
  const base = await server(t, {env: {NODE_ENV: "production"}});
  for (const route of ["vision", "explain"])
    assert.equal((await post(base + "/api/" + route, {}, {Cookie: ""})).status, 401);
  assert.equal((await post(base + "/api/login", {password: "wrong"})).status, 401);
  const login = await post(base + "/api/login", {password: "test-password"});
  const cookie = login.headers.get("set-cookie");
  for (const flag of ["HttpOnly", "Secure", "SameSite=Strict", "Max-Age=7776000"]) assert(cookie.includes(flag));
  assert(!cookie.includes("test-password"));
  const session = async (value) => (await fetch(base + "/api/session", {headers: {Cookie: value}})).json();
  assert.equal((await session(cookie.split(";")[0])).authenticated, true);
  assert.equal((await session(cookie.split(";")[0] + "a")).authenticated, false);
  const logout = await post(base + "/api/logout", {});
  assert(logout.headers.get("set-cookie").includes("Max-Age=0"));
  for (let i = 0; i < 10; i++) await post(base + "/api/login", {password: "wrong"});
  assert.equal((await post(base + "/api/login", {password: "wrong"})).status, 429);
});
