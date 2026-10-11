import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { networkInterfaces } from "node:os";
import { randomUUID } from "node:crypto";
import { createDen, PROJECT } from "../server.mjs";

function request(url, headers = {}, method = "GET") {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { headers, method }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", reject);
    req.end();
  });
}

test("LAN binding accepts local interface addresses and preserves request guards", async (t) => {
  const dataDir = path.join(
    PROJECT,
    ".test-runs",
    "n-" + randomUUID().slice(0, 6),
  );
  const app = await createDen({
    dataDir,
    libraryPath: path.join(dataDir, "lib"),
    host: "0.0.0.0",
    disableDesktop: true,
  });
  t.after(() => app.close());
  const base = await app.listen(0);
  const port = app.server.address().port;
  assert.equal(app.server.address().address, "0.0.0.0");
  assert.equal(await request(base + "/"), 200);
  const frame = await fetch(base + "/reader-frame.html");
  assert.equal(frame.status, 200);
  assert.match(
    frame.headers.get("content-security-policy"),
    /frame-ancestors 'self'/,
  );
  const library = await fetch(base + "/");
  assert.match(
    library.headers.get("content-security-policy"),
    /frame-ancestors 'none'/,
  );
  assert.equal(await request(base + "/", { Host: `example.com:${port}` }), 403);
  assert.equal(
    await request(base + "/", { Host: `203.0.113.10:${port}` }),
    403,
  );
  const address = Object.values(networkInterfaces())
    .flat()
    .find((a) => a?.family === "IPv4" && !a.internal)?.address;
  if (!address) {
    t.diagnostic("No LAN interface available; live interface request skipped.");
    return;
  }
  const lan = `http://${address}:${port}`;
  assert.ok(app.accessUrls().includes(lan));
  assert.equal(await request(lan + "/logo.svg", { Origin: lan }), 200);
  assert.equal(await request(lan + "/", { Origin: "http://example.com" }), 403);
  assert.equal(
    await request(lan + "/", { "Sec-Fetch-Site": "cross-site" }),
    403,
  );
  assert.equal(
    await request(lan + "/api/import?name=test.pdf", { Origin: lan }, "POST"),
    403,
  );

  const localOnly = await createDen({
    dataDir,
    libraryPath: path.join(dataDir, "lib"),
    host: "127.0.0.1",
    disableDesktop: true,
  });
  t.after(() => localOnly.close());
  const localBase = await localOnly.listen(0);
  assert.equal(localOnly.server.address().address, "127.0.0.1");
  assert.equal(
    await request(localBase + "/", {
      Host: `${address}:${localOnly.server.address().port}`,
    }),
    403,
  );
});
