import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import {
  demoRequest,
  resetDemoProgress,
  validPosition,
} from "../public/demo-library.js";

test("demo is read-only, remembers valid positions, rejects invalid data, and scopes reset", async (t) => {
  const storage = new Map([["unrelated-preference", "keep"]]);
  const catalogue = JSON.parse(
    await fs.readFile(new URL("../demo/books.json", import.meta.url), "utf8"),
  ).map((book) => ({ ...book, pageCount: 4 }));
  const originalFetch = globalThis.fetch,
    originalStorage = Object.getOwnPropertyDescriptor(
      globalThis,
      "localStorage",
    );
  globalThis.fetch = async (url) => {
    assert.match(String(url), /\/demo\/catalogue\.json$/);
    return { ok: true, json: async () => catalogue };
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
  });
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalStorage)
      Object.defineProperty(globalThis, "localStorage", originalStorage);
    else delete globalThis.localStorage;
  });
  assert.equal(validPosition({ page: 0, totalPages: 4 }), false);
  assert.equal(validPosition({ page: 3, totalPages: 2 }), false);
  assert.equal(validPosition({ page: 1.2, totalPages: 4 }), false);
  let books = (await demoRequest("/api/books")).books;
  assert.equal(books.length, 6);
  assert.ok(books.every((book) => book.progress === null));
  await assert.rejects(
    demoRequest("/api/import", { method: "POST", body: "private bytes" }),
    /sample library/,
  );
  await assert.rejects(
    demoRequest("/api/books/1/metadata", {
      method: "PATCH",
      body: { title: "overwrite" },
    }),
    /sample library/,
  );
  await assert.rejects(
    demoRequest("/api/books/1/progress", {
      method: "PUT",
      body: { page: 99, totalPages: 99 },
    }),
    /Invalid/,
  );
  await demoRequest("/api/books/1/progress", {
    method: "PUT",
    body: { page: 2, totalPages: 4 },
  });
  books = (await demoRequest("/api/books")).books;
  assert.deepEqual(books.find((book) => book.id === 1).progress, {
    page: 2,
    totalPages: 4,
  });
  resetDemoProgress();
  assert.ok(
    (await demoRequest("/api/books")).books.every((book) => !book.progress),
  );
  assert.equal(storage.get("unrelated-preference"), "keep");
  globalThis.localStorage.setItem = () => {
    throw Error("Storage unavailable");
  };
  const saved = await demoRequest("/api/books/1/progress", {
    method: "PUT",
    body: { page: 3, totalPages: 4 },
  });
  assert.equal(saved.persisted, false);
  assert.equal(
    (await demoRequest("/api/books")).books.find((book) => book.id === 1)
      .progress.page,
    3,
  );
});
