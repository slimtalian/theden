import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs, createReadStream } from "node:fs";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { networkInterfaces } from "node:os";

const execute = promisify(execFile);
export const PROJECT = path.dirname(fileURLToPath(import.meta.url));
const MAX_UPLOAD = 100 * 1024 * 1024;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".epub": "application/epub+zip",
  ".wasm": "application/wasm",
  ".ttf": "font/ttf",
  ".bcmap": "application/octet-stream",
  ".pfb": "application/octet-stream",
};
const FIELDS =
  "title,authors,tags,formats,cover,uuid,comments,series,timestamp";
function failure(status, message) {
  return Object.assign(new Error(message), { status });
}
export function inside(root, candidate) {
  const rel = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    rel === "" ||
    (!rel.startsWith(".." + path.sep) && rel !== ".." && !path.isAbsolute(rel))
  );
}
async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
async function realInside(root, file) {
  const [r, f] = await Promise.all([fs.realpath(root), fs.realpath(file)]);
  if (!inside(r, f))
    throw failure(403, "This file is outside The Den library.");
  return f;
}
function textOnly(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}
async function hashFile(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
async function bodyJSON(req) {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (Buffer.byteLength(text) > 16384)
      throw failure(413, "This request is too large.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw failure(400, "Invalid JSON.");
  }
}

export async function createDen(options = {}) {
  const local = await fs
    .readFile(path.join(PROJECT, "config.local.json"), "utf8")
    .then(JSON.parse)
    .catch((e) => {
      if (e.code === "ENOENT") return {};
      throw e;
    });
  const host =
    options.host ?? process.env.DEN_HOST ?? local.host ?? "127.0.0.1";
  if (!["127.0.0.1", "0.0.0.0"].includes(host))
    throw new Error(
      "Set host to 127.0.0.1 for this PC only, or 0.0.0.0 for local-network access.",
    );
  const data = path.resolve(
    PROJECT,
    options.dataDir || process.env.DEN_DATA_DIR || "data",
  );
  const library = path.resolve(
    PROJECT,
    options.libraryPath || local.libraryPath || path.join(data, "library"),
  );
  if (process.platform === "win32" && library.length >= 75)
    throw new Error(
      "Use a Windows library path shorter than 75 characters for calibre. Choose a shorter libraryPath in config.local.json.",
    );
  const calibreDir =
    options.calibreDir ||
    local.calibreDirectory ||
    process.env.CALIBRE_DIRECTORY ||
    (process.platform === "win32"
      ? "C:/Program Files/Calibre2"
      : process.platform === "darwin"
        ? "/Applications/calibre.app/Contents/MacOS"
        : "");
  const exe = (name) =>
    calibreDir
      ? path.join(
          calibreDir,
          process.platform === "win32" ? `${name}.exe` : name,
        )
      : name;
  async function available(command) {
    if (path.isAbsolute(command)) return exists(command);
    for (const directory of (process.env.PATH || "").split(path.delimiter)) {
      if (directory && (await exists(path.join(directory, command))))
        return true;
    }
    return false;
  }
  const configDir = path.join(data, "calibre-config"),
    tempDir = path.join(data, "calibre-temp"),
    statePath = path.join(data, "reading-state.json");
  await Promise.all(
    [data, library, configDir, tempDir, path.join(data, "incoming")].map(
      (dir) => fs.mkdir(dir, { recursive: true }),
    ),
  );
  const env = {
    ...process.env,
    CALIBRE_CONFIG_DIRECTORY: configDir,
    CALIBRE_TEMP_DIR: tempDir,
    PYTHONIOENCODING: "utf-8",
  };
  let state = { version: 1, books: {}, imports: {} },
    recoveryMessage = "",
    cache = null,
    cacheTime = 0,
    queue = Promise.resolve(),
    importQueue = Promise.resolve();
  const serial = (fn) => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  };
  function validState(s) {
    return (
      s?.version === 1 &&
      s.books &&
      typeof s.books === "object" &&
      !Array.isArray(s.books) &&
      s.imports &&
      typeof s.imports === "object" &&
      !Array.isArray(s.imports)
    );
  }
  try {
    const parsed = JSON.parse(await fs.readFile(statePath, "utf8"));
    if (!validState(parsed))
      throw new Error("Unrecognized reading-state format.");
    state = parsed;
  } catch (e) {
    if (e.code !== "ENOENT") {
      const saved = `${statePath}.unreadable-${Date.now()}`;
      await fs.copyFile(statePath, saved);
      try {
        const backup = JSON.parse(
          await fs.readFile(statePath + ".bak", "utf8"),
        );
        if (!validState(backup)) throw new Error();
        state = backup;
        recoveryMessage =
          "Reading positions were recovered from the backup. The unreadable file was preserved.";
      } catch {
        recoveryMessage =
          "Reading positions could not be recovered. The unreadable file was preserved; your calibre books are intact.";
      }
    }
  }
  async function persist() {
    const temp = statePath + "." + randomUUID() + ".tmp";
    await fs.writeFile(temp, JSON.stringify(state, null, 2) + "\n");
    if (await exists(statePath)) {
      try {
        const previous = JSON.parse(await fs.readFile(statePath, "utf8"));
        if (validState(previous))
          await fs.copyFile(statePath, statePath + ".bak");
      } catch {}
    }
    await fs.rename(temp, statePath);
  }
  async function calibre(args) {
    if (!(await available(exe("calibredb"))))
      throw failure(
        503,
        "calibre was not found. Set calibreDirectory in config.local.json, then restart The Den.",
      );
    try {
      const result = await execute(
        exe("calibredb"),
        [...args, "--with-library", library],
        {
          env,
          windowsHide: true,
          timeout: 120000,
          maxBuffer: 32 * 1024 * 1024,
          encoding: "utf8",
        },
      );
      return result.stdout.replace(/^\uFEFF/, "");
    } catch (e) {
      console.error("calibre command failed:", e.stderr || e.message);
      throw failure(
        503,
        "calibre could not complete the operation. If its library is busy, finish that operation and refresh. Details are in the local server log.",
      );
    }
  }
  async function catalogue(force = false) {
    if (cache && !force && Date.now() - cacheTime < 2000) return cache;
    return serial(async () => {
      if (cache && !force && Date.now() - cacheTime < 2000) return cache;
      const output = await calibre([
        "list",
        "--for-machine",
        "--fields",
        FIELDS,
      ]);
      let rows;
      try {
        rows = JSON.parse(output);
      } catch {
        throw failure(503, "calibre returned an unreadable catalogue.");
      }
      cache = rows.map((b) => {
        const formats = {};
        for (const file of Array.isArray(b.formats) ? b.formats : []) {
          const ext = path.extname(file).slice(1).toUpperCase();
          if (/^[A-Z0-9]{1,10}$/.test(ext) && inside(library, file))
            formats[ext] = file;
        }
        return {
          id: b.id,
          uuid: b.uuid || String(b.id),
          title: b.title || "Untitled",
          authors:
            typeof b.authors === "string"
              ? b.authors
              : (b.authors || []).join(" & "),
          tags: Array.isArray(b.tags) ? b.tags : [],
          formats,
          cover: b.cover && inside(library, b.cover) ? b.cover : null,
          description: textOnly(b.comments),
          series: b.series || "",
          added: b.timestamp || "",
        };
      });
      cacheTime = Date.now();
      return cache;
    });
  }
  const publicBook = (b) => ({
    ...b,
    formats: Object.keys(b.formats),
    cover: b.cover ? `/api/books/${b.id}/cover` : null,
    progress: state.books[b.uuid] || null,
  });
  async function getBook(id) {
    if (!/^\d+$/.test(String(id))) throw failure(400, "Invalid book id.");
    const book = (await catalogue()).find((b) => b.id === Number(id));
    if (!book)
      throw failure(
        404,
        "This book is no longer in the library. Refresh the shelves.",
      );
    return book;
  }
  const token = randomBytes(32).toString("hex");
  let port = 0;
  const lanAddresses = () =>
    host === "0.0.0.0"
      ? [
          ...new Set(
            Object.values(networkInterfaces())
              .flat()
              .filter((a) => a && a.family === "IPv4" && !a.internal)
              .map((a) => a.address),
          ),
        ]
      : [];
  const accessUrls = () =>
    ["127.0.0.1", ...lanAddresses()].map(
      (address) => `http://${address}:${port}`,
    );
  const headers = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
  function send(res, status, value) {
    res.writeHead(status, {
      ...headers,
      "Content-Type": "application/json; charset=utf-8",
    });
    res.end(JSON.stringify(value));
  }
  async function sendFile(req, res, file, base, download = false) {
    const resolved = await realInside(base, file);
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) throw failure(404, "File not found.");
    const h = {
      ...headers,
      "Content-Type":
        TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Accept-Ranges": "bytes",
    };
    if (
      path.basename(file) === "reader-frame.html" &&
      base === path.join(PROJECT, "public")
    )
      h["Content-Security-Policy"] = headers["Content-Security-Policy"].replace(
        "frame-ancestors 'none'",
        "frame-ancestors 'self'",
      );
    if (download)
      h["Content-Disposition"] =
        `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(file))}`;
    let start = 0,
      end = stat.size - 1,
      status = 200;
    if (req.headers.range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (!m || (!m[1] && !m[2])) {
        res.writeHead(416, { ...h, "Content-Range": `bytes */${stat.size}` });
        res.end();
        return;
      }
      if (!m[1]) {
        start = Math.max(0, stat.size - Number(m[2]));
      } else {
        start = Number(m[1]);
        if (m[2]) end = Math.min(Number(m[2]), end);
      }
      if (
        start >= stat.size ||
        end < start ||
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end)
      ) {
        res.writeHead(416, { ...h, "Content-Range": `bytes */${stat.size}` });
        res.end();
        return;
      }
      status = 206;
      h["Content-Range"] = `bytes ${start}-${end}/${stat.size}`;
    }
    h["Content-Length"] = Math.max(0, end - start + 1);
    res.writeHead(status, h);
    if (req.method === "HEAD" || stat.size === 0) {
      res.end();
      return;
    }
    const stream = createReadStream(resolved, { start, end });
    stream.on("error", () => res.destroy());
    res.on("close", () => stream.destroy());
    stream.pipe(res);
  }
  async function receiveBook(req, url) {
    const original = url.searchParams.get("name") || "";
    const ext = path.extname(original).toLowerCase();
    if (![".pdf", ".epub"].includes(ext))
      throw failure(415, "Choose a PDF or EPUB file.");
    if (Number(req.headers["content-length"]) > MAX_UPLOAD)
      throw failure(413, "The prototype accepts files up to 100 MB.");
    const folder = path.join(data, "incoming", randomUUID());
    await fs.mkdir(folder);
    let name = path
      .basename(original.replaceAll("\\", "/"))
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
      .slice(0, 160);
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(name))
      name = "book-" + name;
    const file = path.join(folder, name || "book" + ext);
    let handle;
    try {
      handle = await fs.open(file, "wx");
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_UPLOAD)
          throw failure(413, "The prototype accepts files up to 100 MB.");
        await handle.write(chunk);
      }
      await handle.close();
      handle = null;
      const check = await fs.open(file, "r");
      const signature = Buffer.alloc(1024);
      const { bytesRead } = await check.read(signature, 0, 1024, 0);
      await check.close();
      if (
        ext === ".pdf" &&
        !signature.subarray(0, bytesRead).includes(Buffer.from("%PDF-"))
      )
        throw failure(415, "This file does not contain a PDF header.");
      if (ext === ".epub" && signature.subarray(0, 2).toString() !== "PK")
        throw failure(415, "This file does not appear to be an EPUB archive.");
      const hash = await hashFile(file);
      const current = await catalogue(true);
      const found = state.imports[hash];
      if (found && current.some((b) => b.uuid === found.uuid))
        return {
          added: false,
          duplicate: true,
          id: current.find((b) => b.uuid === found.uuid).id,
          message: "This exact file is already in your library.",
        };
      const priorIds = new Set(current.map((b) => b.id));
      const args = ["add"];
      for (const [query, flag] of [
        ["title", "--title"],
        ["author", "--authors"],
        ["tags", "--tags"],
      ]) {
        const value = url.searchParams.get(query);
        if (value) {
          if (value.length > 1000)
            throw failure(400, "Book details are too long.");
          args.push(flag, value);
        }
      }
      args.push(file);
      await serial(() => calibre(args));
      cache = null;
      const after = await catalogue(true);
      const added = after.find((b) => !priorIds.has(b.id));
      if (!added)
        return {
          added: false,
          duplicate: true,
          message:
            "calibre skipped a book with the same title and author. Manage alternate formats in calibre.",
        };
      await serial(async () => {
        state.imports[hash] = {
          uuid: added.uuid,
          filename: original,
          sha256: hash,
          addedAt: new Date().toISOString(),
        };
        await persist();
      });
      return { added: true, id: added.id, book: publicBook(added) };
    } finally {
      if (handle) await handle.close();
      await fs.unlink(file).catch(() => {});
      await fs.rmdir(folder).catch(() => {});
    }
  }
  async function desktopOpen(program, args) {
    if (options.disableDesktop)
      throw failure(403, "Desktop actions are disabled for this test server.");
    if (!(await available(exe(program))))
      throw failure(503, "The calibre application could not be found.");
    await new Promise((resolve, reject) => {
      const child = spawn(exe(program), args, {
        env,
        detached: true,
        windowsHide: true,
        stdio: "ignore",
      });
      child.once("error", reject);
      child.once("spawn", () => {
        child.unref();
        resolve();
      });
    });
  }
  const server = http.createServer(async (req, res) => {
    try {
      const allowedHosts = ["127.0.0.1", "localhost", ...lanAddresses()].map(
        (address) => `${address}:${port}`,
      );
      if (!allowedHosts.includes(req.headers.host))
        throw failure(
          403,
          "Use this computer’s localhost or network IP address to open The Den.",
        );
      const origin = `http://${req.headers.host}`;
      if (req.headers.origin && req.headers.origin !== origin)
        throw failure(403, "Cross-origin requests are not allowed.");
      if (req.headers["sec-fetch-site"] === "cross-site")
        throw failure(403, "Cross-site requests are not allowed.");
      const url = new URL(req.url, origin),
        route = url.pathname;
      const read = req.method === "GET" || req.method === "HEAD";
      if (!read && req.headers["x-den-token"] !== token)
        throw failure(403, "Reload The Den before making this change.");
      if (route === "/api/status" && read) {
        send(res, 200, {
          app: "the-den",
          version: "0.1.0",
          project: PROJECT,
          host,
          urls: accessUrls(),
          libraryPath: library,
          calibreAvailable: await available(exe("calibredb")),
          calibreVersion: await execute(exe("calibredb"), ["--version"], {
            env,
            windowsHide: true,
            timeout: 10000,
          })
            .then((r) => r.stdout.trim())
            .catch(() => null),
          pdfjsVersion: "6.4.299",
          maxUploadMB: 100,
          token,
          recoveryMessage,
        });
        return;
      }
      if (route === "/api/books" && read) {
        send(res, 200, {
          books: (await catalogue(url.searchParams.has("refresh"))).map(
            publicBook,
          ),
        });
        return;
      }
      if (route === "/api/import" && req.method === "POST") {
        const work = importQueue.then(() => receiveBook(req, url));
        importQueue = work.catch(() => {});
        send(res, 201, await work);
        return;
      }
      if (route === "/api/open-calibre" && req.method === "POST") {
        await desktopOpen("calibre", ["--with-library", library]);
        send(res, 200, { opened: true });
        return;
      }
      if (route === "/api/export-reading-state" && read) {
        res.writeHead(200, {
          ...headers,
          "Content-Type": "application/json",
          "Content-Disposition":
            'attachment; filename="the-den-reading-state.json"',
        });
        res.end(JSON.stringify(state, null, 2));
        return;
      }
      const match =
        /^\/api\/books\/(\d+)\/(cover|file|progress|metadata|open)$/.exec(
          route,
        );
      if (match) {
        const book = await getBook(match[1]);
        const action = match[2];
        if (action === "cover" && read) {
          if (!book.cover) throw failure(404, "No cover is available.");
          await sendFile(req, res, book.cover, library);
          return;
        }
        if (action === "file" && read) {
          const format = (
            url.searchParams.get("format") || "PDF"
          ).toUpperCase();
          if (!book.formats[format])
            throw failure(404, "This format is not available.");
          await sendFile(
            req,
            res,
            book.formats[format],
            library,
            url.searchParams.has("download"),
          );
          return;
        }
        if (action === "progress" && req.method === "PUT") {
          const p = await bodyJSON(req);
          if (
            !Number.isSafeInteger(p.page) ||
            !Number.isSafeInteger(p.totalPages) ||
            p.page < 1 ||
            p.totalPages < 1 ||
            p.totalPages > 1000000 ||
            p.page > p.totalPages
          )
            throw failure(400, "Invalid reading position.");
          await serial(async () => {
            state.books[book.uuid] = {
              page: p.page,
              totalPages: p.totalPages,
              updatedAt: new Date().toISOString(),
            };
            await persist();
          });
          send(res, 200, { progress: state.books[book.uuid] });
          return;
        }
        if (action === "metadata" && req.method === "PATCH") {
          const m = await bodyJSON(req);
          if (
            typeof m.title !== "string" ||
            !m.title.trim() ||
            m.title.length > 500 ||
            typeof m.authors !== "string" ||
            m.authors.length > 500 ||
            !Array.isArray(m.tags) ||
            m.tags.length > 30 ||
            m.tags.some(
              (t) => typeof t !== "string" || t.length > 80 || t.includes(","),
            )
          )
            throw failure(
              400,
              "Enter a title, author, and comma-separated categories.",
            );
          await serial(() =>
            calibre([
              "set_metadata",
              String(book.id),
              "--field",
              `title:${m.title.trim()}`,
              "--field",
              `authors:${m.authors.trim() || "Unknown"}`,
              "--field",
              `tags:${m.tags
                .map((t) => t.trim())
                .filter(Boolean)
                .join(",")}`,
            ]),
          );
          cache = null;
          send(res, 200, { updated: true });
          return;
        }
        if (action === "open" && req.method === "POST") {
          const data = await bodyJSON(req);
          const fmt = String(data.format || "EPUB").toUpperCase();
          if (!book.formats[fmt])
            throw failure(404, "This format is not available.");
          const file = await realInside(library, book.formats[fmt]);
          await desktopOpen("ebook-viewer", [file]);
          send(res, 200, { opened: true });
          return;
        }
      }
      if (read && route.startsWith("/vendor/pdfjs/")) {
        const base = path.join(PROJECT, "node_modules", "pdfjs-dist"),
          file = path.resolve(
            base,
            decodeURIComponent(route.slice("/vendor/pdfjs/".length)),
          );
        if (!inside(base, file)) throw failure(403, "Invalid file path.");
        await sendFile(req, res, file, base);
        return;
      }
      if (read && !route.startsWith("/api/")) {
        const base = path.join(PROJECT, "public"),
          file = path.resolve(
            base,
            route === "/" ? "index.html" : decodeURIComponent(route.slice(1)),
          );
        if (!inside(base, file)) throw failure(403, "Invalid file path.");
        await sendFile(req, res, file, base);
        return;
      }
      throw failure(404, "Not found.");
    } catch (e) {
      if (!e.status && e.code !== "ENOENT") console.error(e);
      const status = e.status || (e.code === "ENOENT" ? 404 : 500);
      if (!res.headersSent)
        send(res, status, {
          error: e.status
            ? e.message
            : status === 404
              ? "File not found."
              : "The operation failed. Check the local server log.",
        });
      else res.destroy();
    }
  });
  server.requestTimeout = 180000;
  return {
    server,
    data,
    library,
    host,
    accessUrls,
    state: () => structuredClone(state),
    catalogue,
    async listen(requestedPort = 4317) {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(requestedPort, host, () => {
          port = server.address().port;
          resolve();
        });
      });
      return `http://127.0.0.1:${port}`;
    },
    async close() {
      await queue;
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const app = await createDen();
  try {
    const url = await app.listen(Number(process.env.DEN_PORT || 4317));
    console.log(`The Den is ready: ${url} (listening on ${app.host})`);
    for (const address of app.accessUrls().slice(1))
      console.log(`Network address: ${address}`);
    console.log(`Library: ${app.library}`);
    await fs.writeFile(
      path.join(app.data, "server.json"),
      JSON.stringify(
        {
          pid: process.pid,
          url,
          host: app.host,
          urls: app.accessUrls(),
          project: PROJECT,
          startedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } catch (e) {
    console.error(
      e.code === "EADDRINUSE"
        ? "Port 4317 is in use. Check the existing process before starting another copy."
        : e,
    );
    process.exit(1);
  }
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, async () => {
      await app.close();
      process.exit(0);
    });
}
