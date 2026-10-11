import { promises as fs } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skipped = new Set([
  ".git",
  "node_modules",
  "data",
  "config.local.json",
  ".npm-cache",
  ".test-runs",
  ".checks",
  ".artifacts",
  "dist",
  "__pycache__",
]);
const forbiddenPath =
  /(^|\/)(?:data|\.artifacts|\.test-runs|\.checks|node_modules|\.npm-cache|\.env)(\/|$)|(?:^|\/)config\.local\.json$|\.(?:db|sqlite|log)$/i;
async function walk(dir, relative = "", skip = false) {
  const files = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (skip && skipped.has(entry.name)) continue;
    assert.equal(
      entry.isSymbolicLink(),
      false,
      `Unexpected symbolic link: ${relative}${entry.name}`,
    );
    const rel = relative + entry.name;
    if (entry.isDirectory())
      files.push(...(await walk(path.join(dir, entry.name), rel + "/", skip)));
    else files.push(rel);
  }
  return files;
}
function inspectText(text, name) {
  assert.ok(
    !/[A-Za-z]:[\\/]+Users[\\/]+[^\s"']+/i.test(text),
    `User-specific Windows path: ${name}`,
  );
  assert.ok(
    !/\/(?:home|Users)\/[^\s"']+/i.test(text),
    `User-specific home path: ${name}`,
  );
  assert.ok(
    !/\b192\.168\.\d{1,3}\.\d{1,3}\b/.test(text),
    `Personal network address: ${name}`,
  );
  assert.ok(
    !/\bgh[pousr]_[A-Za-z0-9]{30,}\b/.test(text),
    `Possible credential: ${name}`,
  );
  assert.ok(
    !/[A-Z0-9._%+-]+@(?:gmail|hotmail|outlook|yahoo)\.com\b/i.test(text),
    `Personal email address: ${name}`,
  );
}
const source = await walk(root, "", true);
for (const rel of source) {
  if (/\.(?:js|mjs|css|html|svg|json|md|ps1|cmd|yml|yaml|py|txt)$/.test(rel))
    inspectText(await fs.readFile(path.join(root, rel), "utf8"), rel);
}
// Check the actual Git index as well, including accidental staging of ignored files.
const tracked = execFileSync("git", ["ls-files", "-z"], {
  cwd: root,
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);
for (const rel of tracked)
  assert.ok(
    !forbiddenPath.test(rel),
    `Private/runtime file in Git index: ${rel}`,
  );
const dist = path.join(root, "dist"),
  built = await walk(dist);
for (const rel of built) {
  assert.ok(!forbiddenPath.test(rel), `Private/runtime file in demo: ${rel}`);
  if (!rel.startsWith("vendor/") && /\.(?:js|css|html|svg|json)$/.test(rel)) {
    const text = await fs.readFile(path.join(dist, rel), "utf8");
    inspectText(text, rel);
    assert.ok(
      !/(?:src|href)=["']\/(?!\/)/.test(text),
      `Root-relative asset breaks project Pages: ${rel}`,
    );
  }
}
const html = await fs.readFile(path.join(dist, "index.html"), "utf8");
assert.match(html, /data-mode="demo"/);
assert.match(
  await fs.readFile(path.join(root, "public/index.html"), "utf8"),
  /data-mode="local"/,
);
const books = JSON.parse(
  await fs.readFile(path.join(dist, "demo/catalogue.json"), "utf8"),
);
assert.equal(books.length, 6);
for (const book of books) {
  assert.equal(book.authors, "The Den Editions");
  assert.equal(book.progress, undefined);
  assert.equal(book.pageCount, 4);
  assert.ok(
    (await fs.readFile(path.join(dist, book.file)))
      .subarray(0, 5)
      .equals(Buffer.from("%PDF-")),
  );
  assert.match(await fs.readFile(path.join(dist, book.cover), "utf8"), /<svg/);
}
assert.equal(built.filter((file) => file.endsWith(".pdf")).length, 6);
console.log(
  `Public check passed: ${source.length} source files, ${built.length} demo assets, 6 original PDFs; no library database, reading state, local config, or detected personal identifiers.`,
);
