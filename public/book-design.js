// One binding, on the shelf and in your hands. Jackets never alter the source file.
const palette = ["#465c49", "#675a3f", "#6c4c3d", "#3f5959", "#615c42", "#674849", "#3f4d60"];
const escape = (value) => String(value ?? "").replace(/[&<>"']/g, character =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]);

export function bookDesign(book) {
  const hash = [...String(book.uuid || book.id || book.title)].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7);
  return {
    seed: hash,
    color: /^#[\da-f]{6}$/i.test(book.color || "") ? book.color : palette[hash % palette.length],
    height: 208 + hash % 17,
    depth: 35 + hash % 12,
    motif: hash % 3,
  };
}

function lines(text, length, maximum) {
  const words = String(text || "Untitled").trim().split(/\s+/);
  const result = [];
  let line = "";
  for (let word of words) {
    while (word.length > length) {
      if (line) { result.push(line); line = ""; }
      result.push(word.slice(0, length - 1) + "–");
      word = word.slice(length - 1);
    }
    if (line && (line + " " + word).length > length) { result.push(line); line = ""; }
    line += (line ? " " : "") + word;
  }
  if (line) result.push(line);
  const visible = result.slice(0, maximum);
  if (result.length > maximum) visible[maximum - 1] = visible[maximum - 1].slice(0, length - 1) + "…";
  return visible;
}

export function jacketSVG(book) {
  const design = bookDesign(book);
  const title = lines(book.title, 24, 4);
  const author = book.authors?.trim() ? lines(book.authors, 31, 2) : [];
  const motifs = [
    '<circle r="40"/><circle r="25"/><ellipse rx="58" ry="19" transform="rotate(-35)"/><path d="M-62 0H62M0-62V62"/><circle cx="39" cy="-28" r="4" fill="#cdbb87"/>',
    '<path d="M0 60V-58M0 30C-45 28-50-7 0 12M0 7C42 5 49-30 0-12M0-17C-36-19-39-46 0-36M0-36C24-43 24-56 0-65M0 51C32 43 41 17 0 33"/><circle cy="-73" r="3"/>',
    '<path d="M-43 56V-16a43 43 0 0 1 86 0V56M-29 56V-16a29 29 0 0 1 58 0V56M-15 56V-16a15 15 0 0 1 30 0V56M-57 56H57M-50 64H50M0-72V-61M-65-7H-54M54-7H65"/>',
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="448" viewBox="0 0 320 448">
    <defs><pattern id="cloth" width="4" height="4" patternUnits="userSpaceOnUse"><path d="M0 0H4M0 0V4" stroke="#fff" stroke-opacity=".045"/><path d="M2 0V4" stroke="#000" stroke-opacity=".08"/></pattern><linearGradient id="light"><stop stop-color="#000" stop-opacity=".25"/><stop offset=".15" stop-color="#fff" stop-opacity=".045"/><stop offset="1" stop-color="#000" stop-opacity=".12"/></linearGradient></defs>
    <rect width="320" height="448" fill="${design.color}"/><rect width="320" height="448" fill="url(#cloth)"/><rect width="320" height="448" fill="url(#light)"/>
    <g fill="none" stroke="#cdbb87" stroke-opacity=".65"><rect x="26" y="22" width="268" height="404"/><path d="M33 48V29H52M268 29H287V48M33 400V419H52M268 419H287V400"/></g>
    <g transform="translate(164 282)" fill="none" stroke="#cdbb87" stroke-width="1.3" stroke-opacity=".8">${motifs[design.motif]}</g>
    <text x="163" y="62" text-anchor="middle" font-family="Georgia,serif" font-size="9" letter-spacing="4" fill="#d4c595">${escape((book.tags?.[0] || "PRIVATE LIBRARY").slice(0, 26).toUpperCase())}</text>
    <g text-anchor="middle" font-family="Georgia,serif" fill="#efe3c5">${title.map((line, index) => `<text x="164" y="${105 + index * 26}" font-size="22">${escape(line)}</text>`).join("")}</g>
    <path d="M141 369H187" stroke="#cdbb87" stroke-opacity=".7"/>
    <g text-anchor="middle" font-family="Georgia,serif" fill="#d4c595">${author.map((line, index) => `<text x="164" y="${393 + index * 14}" font-size="11">${escape(line)}</text>`).join("")}</g>
  </svg>`;
}

export const jacketURL = book => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(jacketSVG(book));

export function makeBookObject(book, { jacket = false } = {}) {
  const design = bookDesign(book);
  const object = document.createElement("span");
  object.className = "book-object";
  object.setAttribute("aria-hidden", "true");
  object.style.setProperty("--cover", design.color);
  object.style.setProperty("--book-height", `${design.height}px`);
  object.style.setProperty("--depth", `${design.depth}px`);
  object.style.setProperty("--jacket", `url("${jacketURL(book)}")`);
  object.innerHTML = `<span class="face front jacket-front"></span>
    <span class="face back"><span class="back-title">${escape(book.title)}</span><span class="back-author">${escape(book.authors)}</span><span class="back-mark">❧</span></span>
    <span class="face spine"><span class="spine-name">${escape(book.title)}</span><small class="spine-format">${escape(book.formats?.[0] || "BOOK")}</small></span>
    <span class="face pages"></span><span class="face top"></span><span class="face bottom"></span>
    <span class="board-edge front-top"></span><span class="board-edge front-bottom"></span><span class="board-edge front-fore"></span>
    <span class="board-edge back-top"></span><span class="board-edge back-bottom"></span><span class="board-edge back-fore"></span>`;
  if (book.cover && !jacket) {
    const image = new Image();
    image.className = "cover-art";
    image.alt = "";
    image.decoding = "async";
    image.onload = () => object.style.setProperty("--book-width", `${Math.round(design.height * Math.max(.58, Math.min(.88, image.naturalWidth / image.naturalHeight)))}px`);
    image.onerror = () => image.remove();
    image.src = book.cover;
    object.querySelector(".front").append(image);
  }
  return object;
}

export function makeCatalogueCover(book, { jacket = false } = {}) {
  const image = new Image();
  image.className = "catalogue-cover";
  image.alt = "";
  image.loading = "lazy";
  image.onerror = () => { image.onerror = null; image.src = jacketURL(book); };
  image.src = book.cover && !jacket ? book.cover : jacketURL(book);
  return image;
}
