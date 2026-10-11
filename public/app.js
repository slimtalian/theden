import {
  isDemo,
  appURL,
  bookFileURL,
  libraryRequest,
} from "./library-client.js";
import { setupReader } from "./reader.js";
const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const escapeHTML = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const colors = [
  "#465c49",
  "#675a3f",
  "#6c4c3d",
  "#3f5959",
  "#615c42",
  "#674849",
  "#3f4d60",
];
let loaded = false,
  status,
  books = [],
  selected = null,
  query = "",
  category = "All books",
  view = "shelves",
  sort = "title",
  pendingFiles = [],
  importing = false,
  toastTimer = 0;
let motion = !matchMedia("(prefers-reduced-motion: reduce)").matches;
try {
  const prefs = JSON.parse(localStorage.getItem("the-den-ui") || "{}");
  if (["shelves", "catalogue"].includes(prefs.view)) view = prefs.view;
  if (prefs.motion === false) motion = false;
} catch {}
function savePrefs() {
  try {
    localStorage.setItem("the-den-ui", JSON.stringify({ view, motion }));
  } catch {}
}
function toast(text, error = false) {
  clearTimeout(toastTimer);
  $("#toast").textContent = text;
  $("#toast").hidden = false;
  $("#toast").setAttribute("role", error ? "alert" : "status");
  toastTimer = setTimeout(
    () => ($("#toast").hidden = true),
    error ? 10000 : 5000,
  );
}
async function api(route, options) {
  return libraryRequest(route, options, status?.token);
}

const seed = (b) =>
  [...b.uuid].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7);
const color = (b) => b.color || colors[seed(b) % colors.length];
function filtered() {
  const q = query.trim().toLowerCase();
  return books
    .filter(
      (b) =>
        (category === "All books" ||
          (category === "Uncategorized"
            ? b.tags.length === 0
            : b.tags.includes(category))) &&
        (!q ||
          `${b.title} ${b.authors} ${b.tags.join(" ")} ${b.series}`
            .toLowerCase()
            .includes(q)),
    )
    .sort((a, b) =>
      sort === "author"
        ? a.authors.localeCompare(b.authors) || a.title.localeCompare(b.title)
        : sort === "newest"
          ? String(b.added).localeCompare(String(a.added))
          : a.title.localeCompare(b.title),
    );
}
function renderCategories() {
  const counts = new Map();
  for (const book of books)
    for (const tag of book.tags) counts.set(tag, (counts.get(tag) || 0) + 1);
  const items = [
    ["All books", books.length],
    ...[...counts].sort((a, b) => a[0].localeCompare(b[0])),
  ];
  const uncategorized = books.filter((b) => !b.tags.length).length;
  if (uncategorized) items.push(["Uncategorized", uncategorized]);
  if (!items.some(([name]) => name === category)) category = "All books";
  $("#categories").innerHTML = items
    .map(
      ([name, count]) =>
        `<button type="button" data-category="${escapeHTML(name)}" aria-pressed="${name === category}"><span>${escapeHTML(name)}</span><span>${count}</span></button>`,
    )
    .join("");
}
let lastColumns = 0;
function shelfColumns() {
  const width = $("#shelves").clientWidth;
  return Math.max(isDemo ? 3 : 4, Math.min(isDemo ? (width < 480 ? 3 : 6) : 14, Math.floor((width - 25) / 59)));
}
function renderBooks() {
  if (!loaded) return;
  const list = filtered();
  const empty = books.length === 0;
  document.body.classList.toggle("empty-library", empty);
  $("#empty-state").hidden = !empty;
  $("#no-results").hidden = empty || list.length > 0;
  $("#book-count").textContent =
    `${list.length} ${list.length === 1 ? "volume" : "volumes"}`;
  $("#result-line").textContent = empty
    ? "Your collection is ready for its first book."
    : query || category !== "All books"
      ? `${list.length} ${list.length === 1 ? "match" : "matches"}${category === "All books" ? "" : ` in ${category}`}`
      : "Select a spine to take a closer look.";
  $("#shelf-hint").textContent = empty
    ? "A quiet place for a growing collection."
    : "Hover to lift · Select to hold · Drag to turn";
  $("#shelves").hidden = view !== "shelves" || (!empty && !list.length);
  $("#catalogue").hidden = view !== "catalogue" || empty || !list.length;
  $$("[data-view]").forEach((b) =>
    b.setAttribute("aria-pressed", b.dataset.view === view),
  );
  $("#shelves").innerHTML = "";
  const columns = shelfColumns();
  lastColumns = columns;
  const rows = Math.max(
    empty ? 2 : isDemo ? 1 : 3,
    Math.ceil(list.length / columns),
  );
  for (let r = 0; r < rows; r++) {
    const shelf = document.createElement("div");
    shelf.className = "shelf";
    const row = document.createElement("div");
    row.className = "shelf-books";
    for (const book of list.slice(r * columns, (r + 1) * columns)) {
      const n = seed(book),
        button = document.createElement("button");
      button.className = "volume" + (query ? " matched" : "");
      button.dataset.book = book.id;
      button.type = "button";
      button.setAttribute(
        "aria-label",
        `Hold ${book.title} by ${book.authors}`,
      );
      button.setAttribute("aria-pressed", String(book.id === selected?.id));
      button.title = `${book.title} — ${book.authors}`;
      button.style.setProperty("--book-color", color(book));
      button.style.setProperty(
        "--book-height",
        `${(isDemo ? 168 : 132) + (n % 27)}px`,
      );
      button.style.setProperty("--book-width", `${42 + (n % 13)}px`);
      button.innerHTML = `<span class="binding"><span class="spine-title">${escapeHTML(book.title)}</span><span class="spine-format">${escapeHTML(book.formats[0] || "BOOK")}</span></span>${book.progress ? '<span class="ribbon" aria-hidden="true"></span>' : ""}`;
      row.append(button);
    }
    shelf.append(row);
    $("#shelves").append(shelf);
  }
  $("#catalogue").innerHTML = list
    .map(
      (book) =>
        `<button type="button" class="catalogue-item" data-book="${book.id}" aria-pressed="${selected?.id === book.id}">${book.cover ? `<img class="catalogue-cover" src="${book.cover}" alt="" loading="lazy">` : `<span class="catalogue-cover" style="--book-color:${color(book)}"></span>`}<span><span class="catalogue-title">${escapeHTML(book.title)}</span><span class="catalogue-author">${escapeHTML(book.authors)}${book.tags.length ? " · " + escapeHTML(book.tags.join(", ")) : ""}</span></span><span class="catalogue-format">${escapeHTML(book.formats.join(" · "))}</span></button>`,
    )
    .join("");
}
async function refresh() {
  const result = await api("/api/books?refresh=1");
  books = result.books;
  loaded = true;
  renderCategories();
  if (selected) {
    selected = books.find((b) => b.id === selected.id) || null;
    if (selected) showBook(selected, false);
    else closeInspector();
  }
  renderBooks();
  $("#connection-status").innerHTML =
    '<span class="status-dot"></span>' +
    (isDemo
      ? "Sample collection · saved in this browser"
      : "calibre · local library");
}
function showBook(book, redraw = true) {
  selected = book;
  $("#workspace").classList.add("has-selection");
  $("#inspector").hidden = false;
  $("#cover-title").textContent = book.title;
  $("#cover-author").textContent = book.authors;
  $("#back-title").textContent = book.title;
  $("#back-author").textContent = book.authors;
  $("#object-spine").textContent = book.title;
  $("#book-title").textContent = book.title;
  $("#book-author").textContent = book.authors;
  $("#book-description").textContent = book.description;
  $("#book-description").hidden = !book.description;
  $("#book-format").textContent =
    book.formats.join(" · ") || "No file attached";
  $("#book-tags").innerHTML = book.tags
    .map((t) => `<span class="tag">${escapeHTML(t)}</span>`)
    .join("");
  $("#reading-position").textContent = book.progress
    ? `Saved at page ${book.progress.page} of ${book.progress.totalPages}`
    : "";
  const hasPDF = book.formats.includes("PDF");
  $("#read-button").textContent = hasPDF
    ? book.progress
      ? "Continue reading"
      : "Read PDF"
    : "Open in calibre reader";
  $("#read-button").disabled = !book.formats.length;
  $("#downloads").innerHTML = book.formats
    .map(
      (fmt) =>
        `<a href="${escapeHTML(bookFileURL(book, fmt, true))}" download>Download ${escapeHTML(fmt)}</a>`,
    )
    .join("");
  $("#book-object").style.setProperty("--cover", color(book));
  $("#book-object").style.setProperty("--depth", `${24 + (seed(book) % 9)}px`);
  $("#book-object").style.setProperty("--book-width", "160px");
  const front = $(".book-object .front");
  front.classList.remove("with-cover");
  front.style.removeProperty("--cover-art");
  if (book.cover) {
    const image = new Image();
    image.onload = () => {
      if (selected?.id === book.id) {
        $("#book-object").style.setProperty(
          "--book-width",
          `${Math.round(224 * Math.max(0.58, Math.min(0.88, image.naturalWidth / image.naturalHeight)))}px`,
        );
        front.style.setProperty("--cover-art", `url("${book.cover}")`);
        front.classList.add("with-cover");
      }
    };
    image.src = book.cover;
  }
  targetY = Math.round(angleY / 360) * 360 - 26;
  targetX = -8;
  animateBook();
  if (redraw) renderBooks();
}
function closeInspector() {
  $("#inspector").hidden = true;
  $("#workspace").classList.remove("has-selection");
  selected = null;
  renderBooks();
}
let angleY = -26,
  angleX = -8,
  targetY = -26,
  targetX = -8,
  vy = 0,
  vx = 0,
  raf = 0,
  lastFrame = 0,
  drag = null;
function paintBook() {
  $("#book-object").style.transform =
    `rotateX(${angleX}deg) rotateY(${angleY}deg)`;
}
function bookFrame(time) {
  const dt = Math.min((time - lastFrame) / 16.667 || 1, 2);
  lastFrame = time;
  const weight = selected ? 1 + (seed(selected) % 12) / 30 : 1;
  const damp = Math.pow(0.82, dt);
  vy = (vy + (((targetY - angleY) * 0.034) / weight) * dt) * damp;
  vx = (vx + (((targetX - angleX) * 0.034) / weight) * dt) * damp;
  angleY += vy * dt;
  angleX += vx * dt;
  paintBook();
  if (
    Math.abs(targetY - angleY) +
      Math.abs(targetX - angleX) +
      Math.abs(vy) +
      Math.abs(vx) >
    0.025
  )
    raf = requestAnimationFrame(bookFrame);
  else {
    raf = 0;
    angleY = targetY;
    angleX = targetX;
    paintBook();
  }
}
function animateBook() {
  if (!motion) {
    cancelAnimationFrame(raf);
    raf = 0;
    angleY = targetY;
    angleX = targetX;
    vy = vx = 0;
    paintBook();
    return;
  }
  if (!raf) {
    lastFrame = 0;
    raf = requestAnimationFrame(bookFrame);
  }
}
$("#book-stage").addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  drag = { x: e.clientX, y: e.clientY };
  e.currentTarget.setPointerCapture(e.pointerId);
  e.currentTarget.classList.add("is-held");
});
$("#book-stage").addEventListener("pointermove", (e) => {
  if (!drag) return;
  targetY += (e.clientX - drag.x) * 0.85;
  targetX = Math.max(-35, Math.min(35, targetX - (e.clientY - drag.y) * 0.3));
  drag = { x: e.clientX, y: e.clientY };
  animateBook();
});
function endDrag(e) {
  if (!drag) return;
  drag = null;
  e.currentTarget.classList.remove("is-held");
  if (e.currentTarget.hasPointerCapture(e.pointerId))
    e.currentTarget.releasePointerCapture(e.pointerId);
  targetY += motion ? Math.max(-40, Math.min(40, vy * 5)) : 0;
  targetX = -8;
  animateBook();
}
$("#book-stage").addEventListener("pointerup", endDrag);
$("#book-stage").addEventListener("pointercancel", endDrag);
$("#rotate-left").addEventListener("click", () => {
  targetY -= 45;
  animateBook();
});
$("#rotate-right").addEventListener("click", () => {
  targetY += 45;
  animateBook();
});
function setMotion() {
  document.body.classList.toggle("still", !motion);
  $("#motion").checked = motion;
  animateBook();
  savePrefs();
}
setMotion();
$("#motion").addEventListener("change", (e) => {
  motion =
    e.target.checked && !matchMedia("(prefers-reduced-motion: reduce)").matches;
  setMotion();
});
$("#search").addEventListener("input", (e) => {
  query = e.target.value;
  renderBooks();
});
$("#sort").addEventListener("change", (e) => {
  sort = e.target.value;
  renderBooks();
});
$("#categories").addEventListener("click", (e) => {
  const button = e.target.closest("[data-category]");
  if (button) {
    category = button.dataset.category;
    renderCategories();
    renderBooks();
  }
});
$$("[data-view]").forEach((button) =>
  button.addEventListener("click", () => {
    view = button.dataset.view;
    renderBooks();
    savePrefs();
  }),
);
$("#library-main").addEventListener("click", (e) => {
  const button = e.target.closest("[data-book]");
  if (button) {
    const book = books.find((b) => b.id === Number(button.dataset.book));
    if (book) {
      showBook(book);
      if (matchMedia('(max-width: 1000px)').matches)
        requestAnimationFrame(() => $('#inspector').scrollIntoView({ behavior: motion ? 'smooth' : 'instant', block: 'start' }));
    }
  }
});
$("#close-inspector").addEventListener("click", closeInspector);
$("#clear-filters").addEventListener("click", () => {
  query = "";
  category = "All books";
  $("#search").value = "";
  renderCategories();
  renderBooks();
});
$("#refresh-button").addEventListener("click", async (e) => {
  e.currentTarget.disabled = true;
  try {
    await refresh();
    toast(
      isDemo ? "Sample shelves refreshed." : "Shelves refreshed from calibre.",
    );
  } catch (e) {
    toast(e.message, true);
  } finally {
    $("#refresh-button").disabled = false;
  }
});
$$("[data-close]").forEach((b) =>
  b.addEventListener("click", () => {
    if (importing && b.closest("dialog").id === "import-dialog") return;
    b.closest("dialog").close();
  }),
);
function openImport(files = []) {
  if (isDemo) {
    $("#demo-dialog").showModal();
    return;
  }
  if (!status) {
    toast("The library connection is not ready.", true);
    return;
  }
  pendingFiles = files;
  $("#import-form").reset();
  $("#import-status").textContent = "";
  $("#import-submit").disabled = false;
  renderImportFiles();
  $("#import-dialog").showModal();
}
function renderImportFiles() {
  $("#file-input").required = !pendingFiles.length;
  $("#import-title").disabled = pendingFiles.length > 1;
  $("#import-files").innerHTML = pendingFiles
    .map(
      (f) =>
        `<p>${escapeHTML(f.name)} <span class="optional">${(f.size / 1024 / 1024).toFixed(1)} MB</span></p>`,
    )
    .join("");
}
$("#add-button").addEventListener("click", () => openImport());
$("#first-book").addEventListener("click", () => openImport());
$("#file-input").addEventListener("change", (e) => {
  pendingFiles = [...e.target.files];
  renderImportFiles();
});
$("#import-dialog").addEventListener("cancel", (e) => {
  if (importing) e.preventDefault();
});
$("#import-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (importing || !pendingFiles.length) return;
  const invalid = pendingFiles.find(
    (f) => !/\.(pdf|epub)$/i.test(f.name) || f.size > 100 * 1024 * 1024,
  );
  if (invalid) {
    $("#import-status").textContent =
      `${invalid.name}: choose a PDF or EPUB smaller than 100 MB.`;
    return;
  }
  importing = true;
  $("#import-submit").disabled = true;
  $$("#import-dialog input,#import-dialog [data-close]").forEach(
    (b) => (b.disabled = true),
  );
  let added = 0,
    lastId = null,
    skipped = 0;
  const errors = [];
  for (let i = 0; i < pendingFiles.length; i++) {
    const file = pendingFiles[i];
    $("#import-status").textContent =
      `Adding ${i + 1} of ${pendingFiles.length}: ${file.name}`;
    try {
      const params = new URLSearchParams({ name: file.name });
      if (pendingFiles.length === 1 && $("#import-title").value.trim())
        params.set("title", $("#import-title").value.trim());
      if ($("#import-author").value.trim())
        params.set("author", $("#import-author").value.trim());
      if ($("#import-tags").value.trim())
        params.set("tags", $("#import-tags").value.trim());
      const result = await api("/api/import?" + params, {
        method: "POST",
        body: file,
        headers: { "Content-Type": "application/octet-stream" },
      });
      if (result.added) {
        added++;
        lastId = result.id;
      } else skipped++;
    } catch (err) {
      errors.push(`${file.name}: ${err.message}`);
    }
  }
  importing = false;
  $$("#import-dialog input,#import-dialog [data-close]").forEach(
    (b) => (b.disabled = false),
  );
  $("#import-submit").disabled = false;
  try {
    await refresh();
    if (lastId) {
      const book = books.find((b) => b.id === lastId);
      if (book) showBook(book);
    }
  } catch (err) {
    errors.push(err.message);
  }
  if (errors.length) {
    $("#import-status").textContent =
      `${added} added; ${skipped} skipped.\n${errors.join("\n")}`;
  } else {
    $("#import-dialog").close();
    toast(
      `${added} ${added === 1 ? "book" : "books"} added${skipped ? `; ${skipped} already in calibre` : ""}.`,
    );
  }
});
let dragDepth = 0;
document.addEventListener("dragenter", (e) => {
  if (
    isDemo ||
    !e.dataTransfer?.types.includes("Files") ||
    !$("#reader").hidden
  )
    return;
  e.preventDefault();
  dragDepth++;
  $("#drop-overlay").hidden = false;
});
document.addEventListener("dragover", (e) => {
  if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
});
document.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) $("#drop-overlay").hidden = true;
});
document.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  $("#drop-overlay").hidden = true;
  if (importing) return;
  const files = [...e.dataTransfer.files];
  if (files.length) {
    $$("dialog[open]").forEach((d) => d.close());
    openImport(files);
  }
});
$("#edit-button").addEventListener("click", () => {
  if (!selected) return;
  $("#edit-title").value = selected.title;
  $("#edit-author").value = selected.authors;
  $("#edit-tags").value = selected.tags.join(", ");
  $("#edit-status").textContent = "";
  $("#edit-dialog").showModal();
});
$("#edit-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!selected) return;
  $("#edit-save").disabled = true;
  try {
    await api(`/api/books/${selected.id}/metadata`, {
      method: "PATCH",
      body: {
        title: $("#edit-title").value,
        authors: $("#edit-author").value,
        tags: $("#edit-tags")
          .value.split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      },
    });
    await refresh();
    $("#edit-dialog").close();
    toast("Book details saved in calibre.");
  } catch (err) {
    $("#edit-status").textContent = err.message;
  } finally {
    $("#edit-save").disabled = false;
  }
});
$("#settings-button").addEventListener("click", () => {
  if (isDemo) {
    $("#demo-dialog").showModal();
    return;
  }
  $("#library-path").textContent =
    status?.libraryPath || "Connection unavailable";
  $("#calibre-version").textContent = status?.calibreVersion || "Not found";
  $("#pdfjs-version").textContent =
    `PDF.js ${status?.pdfjsVersion || ""} · served from this computer`;
  $("#settings-dialog").showModal();
});
$("#open-calibre").addEventListener("click", async (e) => {
  e.currentTarget.disabled = true;
  try {
    await api("/api/open-calibre", { method: "POST" });
    toast("Opening The Den library in calibre.");
  } catch (err) {
    toast(err.message, true);
  } finally {
    $("#open-calibre").disabled = false;
  }
});

const reader = setupReader({
  api,
  getBooks: () => books,
  toast,
  onClose: () => {
    if (selected) {
      selected = books.find((book) => book.id === selected.id) || selected;
      showBook(selected);
    }
    renderBooks();
  },
});
$("#read-button").addEventListener("click", () => {
  if (selected) reader.open(selected);
});
document.addEventListener("keydown", (event) => {
  if (
    document.querySelector("dialog[open]") ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)
  )
    return;
  if (event.key === "/" && $("#reader").hidden) {
    event.preventDefault();
    $("#search").focus();
  }
  if (!$("#reader").hidden) {
    if (event.key === "ArrowRight") $("#next-page").click();
    if (event.key === "ArrowLeft") $("#prev-page").click();
    if (event.key === "Escape") reader.close();
  } else if (event.key === "Escape" && selected) closeInspector();
});
let resizeTimer = 0;
new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if ($("#reader").hidden && shelfColumns() !== lastColumns) renderBooks();
  }, 180);
}).observe($("#library-main"));
async function init() {
  try {
    status = await api("/api/status");
    if (status.recoveryMessage) toast(status.recoveryMessage, true);
    if (!status.calibreAvailable)
      throw new Error("calibre was not found. Open Library for details.");
    await refresh();
  } catch (err) {
    $("#connection-status").textContent = "Library connection unavailable";
    $("#result-line").textContent = err.message;
    toast(err.message, true);
  }
}
if (isDemo) {
  document.body.classList.add("demo-library");
  document.title = "The Den · A century on the shelf";
  $("#demo-notice").hidden = false;
  $(".local-label").textContent = "An open bookshelf";
  $("#add-button").textContent = "Use The Den ↗";
  $("#settings-button").textContent = "About";
  $("#settings-button").setAttribute("aria-label", "About this demo");
  $("#edit-button").hidden = true;
  $(".section-heading .eyebrow").textContent = "The nineteenth century";
  $(".section-heading h1").textContent = "A century on the shelf.";
  $("#refresh-button").setAttribute("aria-label", "Refresh sample collection");
  $("#reset-demo").addEventListener("click", async () => {
    const { resetDemoProgress } = await import("./demo-library.js");
    resetDemoProgress();
    await refresh();
    $("#demo-dialog").close();
    toast("Sample reading progress reset.");
  });
}
init();
