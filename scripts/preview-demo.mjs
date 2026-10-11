import http from "node:http";
import path from "node:path";
import { promises as fs, createReadStream } from "node:fs";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../dist",
);
const port = Number(process.env.DEMO_PORT || 4321);
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".png": "image/png",
};
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/") {
      res.writeHead(302, { Location: "/theden/" });
      res.end();
      return;
    }
    if (
      !["GET", "HEAD"].includes(req.method) ||
      !url.pathname.startsWith("/theden/")
    ) {
      res.writeHead(404);
      res.end();
      return;
    }
    const rel =
      decodeURIComponent(url.pathname.slice("/theden/".length)) || "index.html";
    const file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep)) throw Error("Outside build");
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw Error("Not a file");
    res.writeHead(200, {
      "Content-Type": types[path.extname(file)] || "application/octet-stream",
      "Content-Length": stat.size,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    if (req.method === "HEAD") res.end();
    else createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(`The Den demo: http://127.0.0.1:${port}/theden/`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.close(() => process.exit(0)));
