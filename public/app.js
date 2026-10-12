import {
  isDemo,
  appURL,
  bookFileURL,
  libraryRequest,
} from "./library-client.js";
import { createReaderTransition } from "./reader-transition.js";
import { setupReader } from "./reader.js";
import { bookDesign, makeBookObject, makeCatalogueCover, coverKey, usesClothJacket } from "./book-design.js";
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
let originalCovers = new Set();
try {
  const saved = JSON.parse(localStorage.getItem("the-den-original-covers") || "[]");
  if (Array.isArray(saved)) originalCovers = new Set(saved.filter(value => typeof value === "string"));
} catch {}
const usesJacket = book => usesClothJacket(book, originalCovers);
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

const seed = (b) => bookDesign(b).seed;
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
  const previousScroll = $("#categories").scrollLeft;
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
        `<button type="button" data-category="${escapeHTML(name)}" aria-pressed="${name === category}" aria-label="${escapeHTML(name)}, ${count} ${count === 1 ? "book" : "books"}"><span>${escapeHTML(name)}</span><span class="category-count" aria-hidden="true">${count}</span></button>`,
    )
    .join("");
  $("#categories").scrollLeft = category === "All books" ? 0 : previousScroll;
  $("#category-rail").hidden = !books.length;
  requestAnimationFrame(updateCategoryRail);
}
function updateCategoryRail() {
  const rail = $("#categories");
  const overflow = rail.scrollWidth > rail.clientWidth + 2;
  $("#category-rail").classList.toggle("has-overflow", overflow);
  $("#categories-previous").disabled = rail.scrollLeft < 2;
  $("#categories-next").disabled = rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 2;
}
let lastColumns = 0;
function shelfColumns() {
  const width = $("#shelves").clientWidth;
  const capacity = Math.max(1, Math.min(16, Math.floor((width - 54) / 59)));
  const count = filtered().length;
  return count ? Math.ceil(count / Math.ceil(count / capacity)) : capacity;
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
  const hasFilters = Boolean(query.trim() || category !== "All books");
  $("#filter-status").hidden = !hasFilters;
  $("#result-line").textContent = hasFilters
    ? [category === "All books" ? "" : category, `${list.length} ${list.length === 1 ? "book" : "books"}`].filter(Boolean).join(" · ") : "";
  $("#shelves").hidden = view !== "shelves" || (!empty && !list.length);
  $("#catalogue").hidden = view !== "catalogue" || empty || !list.length;
  $$("[data-view]").forEach((b) =>
    b.setAttribute("aria-pressed", b.dataset.view === view),
  );
  $("#shelves").innerHTML = "";
  const columns = shelfColumns();
  lastColumns = columns;
  const rows = Math.max(1, Math.ceil(list.length / columns));
  for (let r = 0; r < rows; r++) {
    const shelf = document.createElement("div");
    shelf.className = "shelf";
    const row = document.createElement("div");
    row.className = "shelf-books";
    for (const book of list.slice(r * columns, (r + 1) * columns)) {
      const design = bookDesign(book), button = document.createElement("button");
      button.className = "volume" + (query ? " matched" : "");
      button.dataset.book = book.id;
      button.type = "button";
      button.setAttribute(
        "aria-label",
        `Hold ${book.title} by ${book.authors}`,
      );
      button.setAttribute("aria-pressed", String(book.id === selected?.id));
      button.title = `${book.title} — ${book.authors}`;
      button.style.setProperty("--volume-height", `${design.height}px`);
      button.style.setProperty("--volume-width", `${design.depth + 8}px`);
      button.append(makeBookObject(book, {jacket:usesJacket(book)}));
      if (book.progress) button.insertAdjacentHTML("beforeend", '<span class="ribbon" aria-hidden="true"></span>');
      row.append(button);
    }
    shelf.append(row);
    $("#shelves").append(shelf);
  }
  $("#catalogue").replaceChildren(...list.map(book => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "catalogue-item";
    button.dataset.book = book.id;
    button.setAttribute("aria-pressed", String(selected?.id === book.id));
    button.innerHTML = `<span><span class="catalogue-title">${escapeHTML(book.title)}</span><span class="catalogue-author">${escapeHTML(book.authors)}${book.tags.length ? " · " + escapeHTML(book.tags.join(", ")) : ""}</span></span><span class="catalogue-format">${escapeHTML(book.formats.join(" · "))}</span>`;
    button.prepend(makeCatalogueCover(book, {jacket:usesJacket(book)}));
    return button;
  }));
}
async function refresh() {
  const result = await api("/api/books?refresh=1");
  books = result.books;
  loaded = true;
  renderCategories();
  if (selected) {
    selected = books.find((b) => b.id === selected.id) || null;
    if (selected) showBook(selected, false);
    else await closeInspector();
  }
  renderBooks();
  $("#connection-status").innerHTML =
    '<span class="status-dot"></span>' +
    (isDemo
      ? "Demo · browser storage"
      : "Local library");
}
function showBook(book, redraw = true) {
  if (selected?.id !== book.id) $("#book-details").open = false;
  selected = book;
  $("#workspace").classList.add("has-selection");
  $("#inspector").hidden = false;
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
    ? `Page ${book.progress.page} of ${book.progress.totalPages}`
    : "";
  const hasPDF = book.formats.includes("PDF");
  $("#read-button").textContent = hasPDF
    ? book.progress
      ? "Continue reading"
      : "Read"
    : "Open in calibre";
  $("#read-button").disabled = !book.formats.length;
  $("#downloads").innerHTML = book.formats
    .map(
      (fmt) =>
        `<a href="${escapeHTML(bookFileURL(book, fmt, true))}" download>Download ${escapeHTML(fmt)}</a>`,
    )
    .join("");
  const object = makeBookObject(book, {jacket:usesJacket(book)});
  object.id = "book-object";
  $("#book-object").replaceWith(object);
  $("#cloth-jacket").checked = !book.cover || usesJacket(book);
  $("#cloth-jacket").disabled = !book.cover;
  targetY = Math.round(angleY / 360) * 360 - 26;
  targetX = -8;
  animateBook();
  if (redraw) renderBooks();
}
const bookSweep = createReaderTransition($("#inspector"));
let changingBook = false;
let shelfScroll = 0;
function setBookRoom(active) {
  document.body.classList.toggle("viewing-book", active);
  $("#workspace").inert = $(".header").inert = active;
}
async function openInspector(book) {
  if (changingBook || !$("#reader").hidden) return;
  changingBook = true;
  shelfScroll = window.scrollY;
  try {
    await bookSweep(true, () => { showBook(book); $("#inspector").scrollTop = 0; }, () => setBookRoom(true));
  } finally { changingBook = false; }
  $("#close-inspector").focus({preventScroll:true});
}
async function closeInspector() {
  if (changingBook || $("#inspector").hidden) return;
  changingBook = true;
  const id = selected?.id;
  try {
    await bookSweep(false, () => {
      setBookRoom(false);
      window.scrollTo({top:shelfScroll, behavior:"instant"});
    }, () => {
      $("#inspector").hidden = true;
      $("#workspace").classList.remove("has-selection");
      selected = null;
      renderBooks();
    });
  } finally { changingBook = false; }
  const target = document.querySelector(`#${view === "shelves" ? "shelves" : "catalogue"} [data-book="${id}"]`);
  (target || $("#search")).focus({preventScroll:true});
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
    $$("[data-category]").forEach(item => item.setAttribute("aria-pressed", String(item.dataset.category === category)));
    renderBooks();
    button.scrollIntoView({block:"nearest",inline:"nearest",behavior:motion ? "smooth" : "instant"});
    if (motion) (view === "shelves" ? $("#shelves") : $("#catalogue")).animate([{opacity:.25,transform:"translateY(8px)"},{opacity:1,transform:"none"}], {duration:280,easing:"ease-out"});
  }
});
$("#categories").addEventListener("scroll", updateCategoryRail, {passive:true});
$("#categories").addEventListener("keydown", event => {
  const items = $$("#categories button");
  let index = items.indexOf(document.activeElement);
  if (index < 0) return;
  if (event.key === "ArrowRight") index = Math.min(items.length - 1, index + 1);
  else if (event.key === "ArrowLeft") index = Math.max(0, index - 1);
  else if (event.key === "Home") index = 0;
  else if (event.key === "End") index = items.length - 1;
  else return;
  event.preventDefault();
  items[index].focus({preventScroll:true});
  items[index].scrollIntoView({block:"nearest",inline:"nearest",behavior:motion ? "smooth" : "instant"});
});
for (const [id, direction] of [["categories-previous", -1], ["categories-next", 1]]) {
  $(`#${id}`).addEventListener("click", () => $("#categories").scrollBy({left:direction * $("#categories").clientWidth * .7,behavior:motion ? "smooth" : "instant"}));
}
new ResizeObserver(updateCategoryRail).observe($("#categories"));
$("#cloth-jacket").addEventListener("change", event => {
  if (!selected) return;
  const key = coverKey(selected);
  event.target.checked ? originalCovers.delete(key) : originalCovers.add(key);
  try { localStorage.setItem("the-den-original-covers", JSON.stringify([...originalCovers])); } catch {}
  showBook(selected);
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
      openInspector(book);
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
      "Library refreshed.",
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
      if (book && !errors.length) { $("#import-dialog").close(); await openInspector(book); }
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
  $("#library-path").textContent = status?.libraryPath || "Unavailable";
  $("#calibre-version").textContent = status?.calibreVersion || "Unavailable";
  $("#pdfjs-version").textContent = status?.pdfjsVersion || "";
  $("#settings-dialog").showModal();
});
// Native dialogs keep keyboard focus contained; clicking the backdrop dismisses them.
document.querySelectorAll("dialog").forEach(dialog => {
  dialog.addEventListener("click", event => {
    if (event.target !== dialog || (importing && dialog.id === "import-dialog")) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
  });
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
  if (selected && !changingBook) reader.open(selected);
});
document.addEventListener("keydown", (event) => {
  if (
    changingBook ||
    document.querySelector("dialog[open]") ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)
  )
    return;
  if (event.key === "/" && $("#reader").hidden && !selected) {
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
    $("#filter-status").hidden = false;
    $("#result-line").textContent = err.message;
    toast(err.message, true);
  }
}
if (isDemo) {
  document.body.classList.add("demo-library");
  document.title = "The Den · A century on the shelf";
  $("#local-settings").hidden = true;
  $("#demo-settings").hidden = false;
  $("#add-button").setAttribute("aria-label", "Add your own books");
  $("#edit-button").hidden = true;
  $("#reset-demo").addEventListener("click", async () => {
    const { resetDemoProgress } = await import("./demo-library.js");
    resetDemoProgress();
    await refresh();
    $("#settings-dialog").close();
    toast("Reading progress reset.");
  });
}
init();
