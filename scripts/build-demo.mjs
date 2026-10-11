import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "dist");
const publicDir = path.join(root, "public");
const pdfjs = path.join(root, "node_modules/pdfjs-dist");
const books = JSON.parse(
  await fs.readFile(path.join(root, "demo/books.json"), "utf8"),
);
if (books.length !== 6 || new Set(books.map((book) => book.id)).size !== 6)
  throw new Error("Expected six unique demo books.");
// Only generated build output may be replaced. Never copy data/, config, or the repository root.
const existing = await fs.lstat(output).catch(() => null);
if (
  existing?.isSymbolicLink() ||
  path.dirname(output) !== root ||
  path.basename(output) !== "dist"
)
  throw new Error("Unsafe output directory.");
await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(output, { recursive: true });

const applicationFiles = [
  "index.html",
  "styles.css",
  "polish.css",
  "app.js",
  "library-client.js",
  "demo-library.js",
  "books-mark.svg",
  "logo.svg",
  "book.css",
  "pdf-text-layer.css",
  "reader.js",
  "reader.css",
  "reader-frame.html",
  "reader-frame.js",
  "reader-frame.css",
  "reader-gestures.js",
  "reader-transition.js",
];
for (const file of applicationFiles)
  await fs.copyFile(path.join(publicDir, file), path.join(output, file));
let html = await fs.readFile(path.join(output, "index.html"), "utf8");
html = html
  .replace('data-mode="local"', 'data-mode="demo"')
  .replace("The Den · Your library", "The Den · A century on the shelf")
  .replace(
    "The Den — your local personal library, managed by calibre.",
    "Explore an interactive bookshelf of six original short books about the 1800s. The Den is a local library you can make your own.",
  );
await fs.writeFile(path.join(output, "index.html"), html);
await fs.writeFile(path.join(output, ".nojekyll"), "");

const catalogue = [];
for (const book of books) {
  for (const [asset, prefix] of [
    [book.cover, "./demo/covers/"],
    [book.file, "./demo/books/"],
  ]) {
    if (
      !asset.startsWith(prefix) ||
      asset.includes("..") ||
      /[?#\\]/.test(asset)
    )
      throw new Error("Invalid demo asset path.");
    const relative = asset.slice(2);
    await fs.mkdir(path.dirname(path.join(output, relative)), {
      recursive: true,
    });
    await fs.copyFile(
      path.join(publicDir, relative),
      path.join(output, relative),
    );
  }
  const {
    id,
    uuid,
    title,
    authors,
    tags,
    formats,
    cover,
    file,
    description,
    series,
    added,
    color,
  } = book;
  catalogue.push({
    id,
    uuid,
    title,
    authors,
    tags,
    formats,
    cover,
    file,
    description,
    series,
    added,
    color,
    pageCount: 4,
  });
}
await fs.mkdir(path.join(output, "demo"), { recursive: true });
await fs.writeFile(
  path.join(output, "demo/catalogue.json"),
  JSON.stringify(catalogue, null, 2),
);

for (const file of [
  "build/pdf.mjs",
  "build/pdf.worker.mjs",
  "web/pdf_viewer.mjs",
  "web/pdf_viewer.css",
  "LICENSE",
]) {
  const destination = path.join(output, "vendor/pdfjs", file);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(path.join(pdfjs, file), destination);
}
for (const directory of ["cmaps", "standard_fonts", "wasm", "web/images"]) {
  await fs.cp(
    path.join(pdfjs, directory),
    path.join(output, "vendor/pdfjs", directory),
    { recursive: true, dereference: true },
  );
}
await fs.copyFile(path.join(root, "LICENSE"), path.join(output, "LICENSE"));
console.log(
  `Built ${books.length} demo books and the shared reader in dist/. No personal library data included.`,
);
