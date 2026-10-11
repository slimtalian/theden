const STORAGE_KEY = "the-den:demo:reading:v1";
let cataloguePromise;
let memory = {};
let loaded = false;

export function validPosition(value) {
  return (
    value &&
    Number.isSafeInteger(value.page) &&
    Number.isSafeInteger(value.totalPages) &&
    value.page > 0 &&
    value.totalPages > 0 &&
    value.page <= value.totalPages
  );
}

function positions() {
  if (!loaded) {
    loaded = true;
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      if (value && typeof value === "object" && !Array.isArray(value))
        memory = Object.fromEntries(
          Object.entries(value).filter(([, position]) =>
            validPosition(position),
          ),
        );
    } catch {
      /* A fresh in-memory collection also works without browser storage. */
    }
  }
  return memory;
}

export function resetDemoProgress() {
  memory = {};
  loaded = true;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* In-memory reset is sufficient. */
  }
}

async function catalogue() {
  cataloguePromise ||= fetch(new URL("./demo/catalogue.json", import.meta.url))
    .then((response) => {
      if (!response.ok)
        throw new Error(
          "The sample collection could not load. Please refresh.",
        );
      return response.json();
    })
    .catch((error) => {
      cataloguePromise = null;
      throw error;
    });
  return cataloguePromise;
}

export async function demoRequest(route, { method = "GET", body } = {}) {
  const pathname = route.split("?")[0];
  if (pathname === "/api/status" && method === "GET")
    return { demo: true, calibreAvailable: true, pdfjsVersion: "6.4.299" };
  const books = await catalogue();
  if (pathname === "/api/books" && method === "GET")
    return {
      books: books.map((book) => ({
        ...book,
        progress: positions()[book.uuid] || null,
      })),
    };
  const match = /^\/api\/books\/(\d+)\/progress$/.exec(pathname);
  if (match && method === "PUT") {
    const book = books.find((book) => book.id === Number(match[1]));
    if (!book) throw new Error("This sample book is not available.");
    if (!validPosition(body) || body.totalPages !== book.pageCount)
      throw new Error("Invalid reading position.");
    const progress = { page: body.page, totalPages: body.totalPages };
    positions()[book.uuid] = progress;
    let persisted = true;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(memory));
    } catch {
      persisted = false;
    }
    return { progress, persisted };
  }
  throw new Error(
    "This is a sample library. Install The Den locally to add and manage your own books.",
  );
}
