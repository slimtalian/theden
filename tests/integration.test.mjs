import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import http from "node:http";
import { createDen, inside, PROJECT } from "../server.mjs";
import { samplePDF, sampleEPUB } from "./fixtures.mjs";

test("local library, imports, isolation, and reading-state recovery", async (t) => {
  const dataDir = path.join(
    PROJECT,
    ".test-runs",
    "i-" + randomUUID().slice(0, 6),
  );
  let app = await createDen({
      dataDir,
      libraryPath: path.join(dataDir, "lib"),
      disableDesktop: true,
      host: "127.0.0.1",
    }),
    base = await app.listen(0);
  let token = "",
    pdfId,
    uuid;
  async function request(route, method = "GET", body, extra = {}) {
    const headers = { ...extra };
    if (method !== "GET") {
      headers["X-Den-Token"] = token;
      if (body && !Buffer.isBuffer(body)) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(body);
      }
    }
    return fetch(base + route, { method, headers, body });
  }
  t.after(async () => app.close());
  await t.test(
    "starts empty, validates local requests, hides project internals",
    async () => {
      const s = await (await request("/api/status")).json();
      token = s.token;
      assert.equal(s.app, "the-den");
      assert.equal(s.libraryPath, path.join(dataDir, "lib"));
      assert.deepEqual((await (await request("/api/books")).json()).books, []);
      assert.equal(
        (
          await request("/api/books", "GET", undefined, {
            Origin: "https://example.com",
          })
        ).status,
        403,
      );
      const wrongHost = await new Promise((resolve, reject) => {
        http
          .get(
            base + "/api/books",
            { headers: { Host: "example.com" } },
            (r) => {
              r.resume();
              resolve(r.statusCode);
            },
          )
          .on("error", reject);
      });
      assert.equal(wrongHost, 403);
      assert.equal(
        (
          await fetch(base + "/api/import?name=x.pdf", {
            method: "POST",
            body: samplePDF(),
          })
        ).status,
        403,
      );
      assert.equal((await request("/server.mjs")).status, 404);
      assert.equal(
        (await request("/data/calibre-library/metadata.db")).status,
        404,
      );
      assert.equal(inside(dataDir, path.join(dataDir, "file.pdf")), true);
      assert.equal(inside(dataDir, path.join(dataDir, "../outside")), false);
    },
  );
  await t.test(
    "imports PDF through calibre, serves identical original bytes and byte ranges",
    async () => {
      const response = await request(
        "/api/import?name=reader-check.pdf&tags=Verification",
        "POST",
        samplePDF(),
      );
      assert.equal(response.status, 201);
      const result = await response.json();
      assert.equal(result.added, true);
      pdfId = result.id;
      uuid = result.book.uuid;
      assert.deepEqual(result.book.formats, ["PDF"]);
      assert.deepEqual(result.book.tags, ["Verification"]);
      assert.deepEqual(
        Buffer.from(
          await (await request(`/api/books/${pdfId}/file`)).arrayBuffer(),
        ),
        samplePDF(),
      );
      const partial = await request(
        `/api/books/${pdfId}/file`,
        "GET",
        undefined,
        { Range: "bytes=0-7" },
      );
      assert.equal(partial.status, 206);
      assert.equal(await partial.text(), "%PDF-1.4");
      assert.equal(
        (
          await request(`/api/books/${pdfId}/file`, "GET", undefined, {
            Range: "bytes=9999999-",
          })
        ).status,
        416,
      );
      assert.equal(
        (
          await (
            await request(
              "/api/import?name=reader-check.pdf",
              "POST",
              samplePDF(),
            )
          ).json()
        ).duplicate,
        true,
      );
      assert.equal(
        (await (await request("/api/books")).json()).books.length,
        1,
      );
      assert.equal(
        (
          await request(
            "/api/import?name=bad.pdf",
            "POST",
            Buffer.from("not a pdf"),
          )
        ).status,
        415,
      );
      assert.equal(
        (await request("/api/import?name=bad.exe", "POST", Buffer.from("x")))
          .status,
        415,
      );
    },
  );
  await t.test(
    "imports EPUB, persists calibre metadata, and preserves PDF after rename",
    async () => {
      const epub = await (
        await request("/api/import?name=epub-check.epub", "POST", sampleEPUB())
      ).json();
      assert.equal(epub.added, true);
      assert.deepEqual(epub.book.formats, ["EPUB"]);
      assert.deepEqual(
        Buffer.from(
          await (
            await request(`/api/books/${epub.id}/file?format=EPUB`)
          ).arrayBuffer(),
        ),
        sampleEPUB(),
      );
      const edit = await request(`/api/books/${pdfId}/metadata`, "PATCH", {
        title: "A renamed PDF",
        authors: "Den Test Author",
        tags: ["Research", "Testing"],
      });
      assert.equal(edit.status, 200);
      const b = (
        await (await request("/api/books?refresh=1")).json()
      ).books.find((b) => b.id === pdfId);
      assert.equal(b.title, "A renamed PDF");
      assert.equal(b.uuid, uuid);
      assert.deepEqual(b.tags, ["Research", "Testing"]);
      assert.deepEqual(
        Buffer.from(
          await (await request(`/api/books/${pdfId}/file`)).arrayBuffer(),
        ),
        samplePDF(),
      );
      assert.equal(
        (
          await request(`/api/books/${pdfId}/progress`, "PUT", {
            page: 3,
            totalPages: 2,
          })
        ).status,
        400,
      );
    },
  );
  await t.test(
    "saves reading positions, reloads them, recovers backup without losing the broken file",
    async () => {
      assert.equal(
        (
          await request(`/api/books/${pdfId}/progress`, "PUT", {
            page: 1,
            totalPages: 2,
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await request(`/api/books/${pdfId}/progress`, "PUT", {
            page: 2,
            totalPages: 2,
          })
        ).status,
        200,
      );
      await app.close();
      app = await createDen({
        dataDir,
        libraryPath: path.join(dataDir, "lib"),
        disableDesktop: true,
        host: "127.0.0.1",
      });
      base = await app.listen(0);
      let s = await (await request("/api/status")).json();
      token = s.token;
      let b = (await (await request("/api/books")).json()).books.find(
        (b) => b.id === pdfId,
      );
      assert.equal(b.progress.page, 2);
      await app.close();
      await fs.writeFile(
        path.join(dataDir, "reading-state.json"),
        "{broken test state",
      );
      app = await createDen({
        dataDir,
        libraryPath: path.join(dataDir, "lib"),
        disableDesktop: true,
        host: "127.0.0.1",
      });
      base = await app.listen(0);
      s = await (await request("/api/status")).json();
      assert.match(s.recoveryMessage, /recovered from the backup/);
      b = (await (await request("/api/books")).json()).books.find(
        (b) => b.id === pdfId,
      );
      assert.equal(b.progress.page, 1);
      assert.ok(
        (await fs.readdir(dataDir)).some((f) =>
          f.startsWith("reading-state.json.unreadable-"),
        ),
      );
      assert.equal(
        (await (await request("/api/books")).json()).books.length,
        2,
      );
    },
  );
});
