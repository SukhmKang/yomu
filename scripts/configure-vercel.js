import { writeFile } from "node:fs/promises";
const backend = process.argv[2];
let url;
try {
  url = new URL(backend);
} catch {
  throw new Error(
    "Usage: npm run configure:vercel -- https://YOUR-SERVICE.onrender.com",
  );
}
if (
  url.protocol !== "https:" ||
  url.username ||
  url.password ||
  url.pathname !== "/" ||
  url.search ||
  url.hash
)
  throw new Error(
    "Use the HTTPS backend origin without a path, query, or credentials.",
  );
const config = {
  version: 2,
  framework: null,
  buildCommand: "npm run build",
  outputDirectory: "frontend",
  rewrites: [
    { source: "/api/:path*", destination: `${url.origin}/api/:path*` },
  ],
  headers: [
    {
      source: "/(.*)",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "no-referrer" },
        {
          key: "Content-Security-Policy",
          value:
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
        },
      ],
    },
    {
      source: "/sw.js",
      headers: [{ key: "Cache-Control", value: "no-cache" }],
    },
  ],
};
await writeFile(
  new URL("../vercel.json", import.meta.url),
  JSON.stringify(config, null, 2) + "\n",
);
console.log(
  `Vercel /api routes now point to ${url.origin}. Set ALLOWED_ORIGINS on Render to your Vercel origin.`,
);
