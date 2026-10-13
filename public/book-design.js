// One binding, on the shelf and in your hands. Jackets never alter the source file.
const palette = ["#465c49", "#675a3f", "#6c4c3d", "#3f5959", "#615c42", "#674849", "#3f4d60"];
const escape = (value) => String(value ?? "").replace(/[&<>"']/g, character =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]);

export const coverKey = book => String(book.uuid || book.id);
export const usesClothJacket = (book, originalCovers = new Set()) => !book.cover || !originalCovers.has(coverKey(book));

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

// Wrap across the binding before reducing the type. Keep every character,
// including long unbroken names, instead of clipping the distinguishing suffix.
export function spineLayout(title, design, measure) {
  const text = String(title || "Untitled").trim().replace(/\s+/g, " ") || "Untitled";
  const width = design.height - 52, height = design.depth - 8;
  const wrap = size => {
    const output = [];
    let line = "";
    for (const word of text.split(" ")) {
      if (line && measure(`${line} ${word}`, size) <= width - 4) { line += ` ${word}`; continue; }
      if (line) { output.push(line); line = ""; }
      for (const character of Array.from(word)) {
        if (line && measure(line + character, size) > width - 4) { output.push(line); line = ""; }
        line += character;
      }
    }
    if (line) output.push(line);
    return output;
  };
  let low = .25, high = 13;
  for (let i = 0; i < 12; i++) {
    const size = (low + high) / 2;
    if (wrap(size).length * size * 1.15 <= height - 2) low = size;
    else high = size;
  }
  const size = Math.floor(low * 100) / 100;
  const lines = wrap(size);
  // Avoid a lonely volume number or one short word on the second line.
  if (text.split(" ").every(word => measure(word, size) <= width - 4)) {
    for (let index = lines.length - 2; index >= 0; index--) {
      let split;
      while ((split = lines[index].lastIndexOf(" ")) > 0) {
        const first = lines[index].slice(0, split);
        const next = lines[index].slice(split + 1) + " " + lines[index + 1];
        const before = Math.abs(measure(lines[index], size) - measure(lines[index + 1], size));
        if (measure(next, size) > width - 4 || Math.abs(measure(first, size) - measure(next, size)) >= before) break;
        lines[index] = first; lines[index + 1] = next;
      }
    }
  }
  return {width, height, size, lines};
}

let spineCanvas;
const spineCache = new Map();
function spineSVG(book, design) {
  const key = JSON.stringify([book.title, design.height, design.depth]);
  if (spineCache.has(key)) return spineCache.get(key);
  spineCanvas ||= document.createElement("canvas").getContext("2d");
  spineCanvas.font = "100px Georgia, serif";
  const widths = new Map();
  const measure = (text, size) => {
    if (!widths.has(text)) widths.set(text, spineCanvas.measureText(text).width / 100);
    return widths.get(text) * size;
  };
  const {width, height, size, lines} = spineLayout(book.title, design, measure);
  const first = height / 2 - (lines.length - 1) * size * 1.15 / 2 + size * .32;
  const svg = `<svg class="spine-name" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" aria-hidden="true"><text text-anchor="middle" font-family="Georgia,serif" font-size="${size}" fill="currentColor">${lines.map((line, index) => `<tspan x="${width / 2}" y="${first + index * size * 1.15}">${escape(line)}</tspan>`).join("")}</text></svg>`;
  if (spineCache.size >= 500) spineCache.delete(spineCache.keys().next().value);
  spineCache.set(key, svg);
  return svg;
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
  const titleText = String(book.title || "").toLowerCase();
  const topic = `${titleText} ${(book.tags || []).join(" ")}`.toLowerCase();
  let ornament = motifs[design.motif];
  // Small original engravings share the binding's brass and cloth palette.
  if (/steam|railway|iron/.test(titleText))
    ornament = '<circle r="48"/><circle r="36"/><circle r="9"/><path d="M0-36V-9M0 9V36M-36 0H-9M9 0H36M-25-25L-6-6M6 6L25 25M25-25L6-6M-6 6L-25 25M-60 58H60M-48 66H48"/><path d="M-54-30L-62-34M54-30L62-34M0-55V-64"/>';
  else if (/silver|photograph|camera/.test(titleText))
    ornament = '<rect x="-49" y="-29" width="98" height="65" rx="3"/><circle r="23"/><circle r="15"/><path d="M-25-29L-18-42H18L25-29M-39-19H-29M-30 36L-44 60M30 36L44 60M0 36V67M0-69V-58M-35-61L-30-51M35-61L30-51"/>';
  else if (/letter|ocean|correspondence/.test(titleText))
    ornament = '<rect x="-51" y="-26" width="102" height="64" rx="2"/><path d="M-51-26L0 12L51-26M-51 38L-16 0M51 38L16 0M-44 56Q-22 46 0 56T44 56M-44 65Q-22 55 0 65T44 65"/><circle cx="25" cy="-50" r="12"/><path d="M-39-52H4M-33-45H4"/>';
  else if (/garden|botan|nature|plant/.test(topic))
    ornament = motifs[1];
  else if (/city|street|urban/.test(titleText))
    ornament = '<path d="M0 61V-40M-19-40H19L14-12H-14ZM-24-40L0-59L24-40M-8 61H8M-59 61H59M-56 61V15H-30V61M30 61V-2H55V61M-51 27H-36M-51 40H-36M35 11H50M35 25H50M35 39H50"/><path d="M-33-33H-44M33-33H44M-25-54L-33-62M25-54L33-62"/>';
  else if (/vote|voice|suffrage|democra/.test(titleText))
    ornament = '<path d="M-42-4H42V56H-42ZM-49-4L-35-19H35L49-4M-17-11H17M-19-58H13L25-46V-21H-19ZM13-58V-46H25M-9-38L-2-31L11-44M-50 64H50"/><circle cy="25" r="14"/><path d="M-5 25L-1 30L7 20"/>';
  else if (/cmmc|ccp|security|cyber|controlled|nist/.test(topic))
    ornament = '<path d="M0-61L45-43V-4Q45 33 0 61Q-45 33-45-4V-43ZM0-49L34-35V-4Q34 23 0 46Q-34 23-34-4V-35Z"/><rect x="-14" y="-6" width="28" height="24" rx="2"/><path d="M-9-6V-16a9 9 0 0 1 18 0V-6M0 3V10M-58-21H-49M49-21H58M0-75V-66"/>';
  else if (/comptia|comput|network|technology/.test(topic))
    ornament = '<rect x="-27" y="-27" width="54" height="54" rx="3"/><rect x="-17" y="-17" width="34" height="34"/><path d="M-16-27V-48M0-27V-59M16-27V-48M-16 27V48M0 27V59M16 27V48M-27-16H-48M-27 0H-59M-27 16H-48M27-16H48M27 0H59M27 16H48"/><circle cy="-64" r="4"/><circle cy="64" r="4"/><circle cx="-64" r="4"/><circle cx="64" r="4"/>';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="448" viewBox="0 0 320 448">
    <defs><pattern id="cloth" width="4" height="4" patternUnits="userSpaceOnUse"><path d="M0 0H4M0 0V4" stroke="#fff" stroke-opacity=".045"/><path d="M2 0V4" stroke="#000" stroke-opacity=".08"/></pattern><linearGradient id="light"><stop stop-color="#000" stop-opacity=".25"/><stop offset=".15" stop-color="#fff" stop-opacity=".045"/><stop offset="1" stop-color="#000" stop-opacity=".12"/></linearGradient></defs>
    <rect width="320" height="448" fill="${design.color}"/><rect width="320" height="448" fill="url(#cloth)"/><rect width="320" height="448" fill="url(#light)"/>
    <g fill="none" stroke="#cdbb87" stroke-opacity=".65"><rect x="26" y="22" width="268" height="404"/><path d="M33 48V29H52M268 29H287V48M33 400V419H52M268 419H287V400"/></g>
    <g transform="translate(164 282)" fill="none" stroke="#cdbb87" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" stroke-opacity=".8">${ornament}</g>
    <text x="163" y="62" text-anchor="middle" font-family="Georgia,serif" font-size="9" letter-spacing="4" fill="#d4c595">${escape((book.tags?.[0] || "PRIVATE LIBRARY").slice(0, 26).toUpperCase())}</text>
    <g text-anchor="middle" font-family="Georgia,serif" fill="#efe3c5">${title.map((line, index) => `<text x="164" y="${105 + index * 26}" font-size="22">${escape(line)}</text>`).join("")}</g>
    <path d="M141 369H187" stroke="#cdbb87" stroke-opacity=".7"/>
    <g text-anchor="middle" font-family="Georgia,serif" fill="#d4c595">${author.map((line, index) => `<text x="164" y="${393 + index * 14}" font-size="11">${escape(line)}</text>`).join("")}</g>
  </svg>`;
}

export const jacketURL = book => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(jacketSVG(book));

export function makeBookObject(book, { jacket = true } = {}) {
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
    <span class="face spine">${spineSVG(book, design)}<small class="spine-format">${escape(book.formats?.[0] || "BOOK")}</small></span>
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

export function makeCatalogueCover(book, { jacket = true } = {}) {
  const image = new Image();
  image.className = "catalogue-cover";
  image.alt = "";
  image.loading = "lazy";
  image.onerror = () => { image.onerror = null; image.src = jacketURL(book); };
  image.src = book.cover && !jacket ? book.cover : jacketURL(book);
  return image;
}
