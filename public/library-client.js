export const isDemo = document.documentElement.dataset.mode === "demo";

// Keep every application URL relative to its installation, including /theden/.
export const appURL = (route) =>
  new URL(route.replace(/^\//, ""), document.baseURI).href;
export function bookFileURL(book, format = "PDF", download = false) {
  return book.file
    ? appURL(book.file)
    : appURL(
        `api/books/${book.id}/file?format=${encodeURIComponent(format)}${download ? "&download=1" : ""}`,
      );
}

export async function libraryRequest(
  route,
  { method = "GET", body, headers = {} } = {},
  token = "",
) {
  if (isDemo)
    return (await import("./demo-library.js")).demoRequest(route, {
      method,
      body,
    });
  const init = { method, headers: { ...headers } };
  if (method !== "GET") {
    init.headers["X-Den-Token"] = token;
    if (body !== undefined) {
      if (body instanceof Blob) init.body = body;
      else {
        init.body = JSON.stringify(body);
        init.headers["Content-Type"] = "application/json";
      }
    }
  }
  const response = await fetch(appURL(route), init);
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error(
      "The library could not respond. Check that the local server is running, then refresh.",
    );
  }
  if (!response.ok) throw new Error(result.error || "The request failed.");
  return result;
}
