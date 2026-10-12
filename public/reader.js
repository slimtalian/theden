import { appURL, bookFileURL } from "./library-client.js";
import { createReaderTransition } from "./reader-transition.js";

export function setupReader({ api, getBooks, onClose, toast }) {
  const $ = (selector) => document.querySelector(selector);
  let book = null,
    frame = null,
    page = 1,
    total = 0,
    saveTimer,
    passwordPending = false,
    closing = false;
  let saveQueue = Promise.resolve();
  const sweep = createReaderTransition($("#reader"));
  let opening = false,
    closeAfterOpen = false,
    libraryScroll = 0;
  let mode = "scroll";
  try {
    if (localStorage.getItem("den-reader-mode") === "flip") mode = "flip";
  } catch {
    /* Reading still works if storage is unavailable. */
  }
  const post = (type, values = {}) =>
    frame?.contentWindow?.postMessage(
      { channel: "the-den-reader", type, ...values },
      location.origin,
    );

  function syncMode() {
    document.querySelectorAll("[data-reader-mode]").forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.readerMode === mode),
      );
      button.disabled = !total;
    });
    $("#reader-mode-hint").textContent =
      mode === "flip" ? "Click or tap a page edge" : "Scroll to read";
    if (frame && book)
      frame.title = `${book.title} — ${mode === "flip" ? "page-by-page" : "scrollable"} PDF`;
  }

  function savePosition() {
    if (!book || !total) return Promise.resolve();
    const currentBook = book,
      position = { page, totalPages: total };
    const save = async () => {
      if (book === currentBook)
        $("#reader-save-status").textContent = "Saving…";
      try {
        const result = await api(`/api/books/${currentBook.id}/progress`, {
          method: "PUT",
          body: position,
        });
        const item = getBooks().find((item) => item.id === currentBook.id);
        if (item) item.progress = result.progress;
        if (book === currentBook)
          $("#reader-save-status").textContent =
            result.persisted === false
              ? "Saved for this visit"
              : "Saved";
      } catch (error) {
        if (book === currentBook)
          $("#reader-save-status").textContent = "Position not saved";
        toast(error.message, true);
      }
    };
    saveQueue = saveQueue.then(save, save);
    return saveQueue;
  }

  function syncControls() {
    $("#page-number").value = page;
    $("#page-number").max = total || 1;
    $("#page-total").textContent = `of ${total || "…"}`;
    $("#prev-page").disabled = !total || page === 1;
    $("#next-page").disabled = !total || page === total;
    $("#page-number").disabled =
      $("#zoom").disabled =
      $("#rotate-page").disabled =
        !total;
    syncMode();
  }

  async function open(selected) {
    if (!selected.formats.includes("PDF")) {
      try {
        await api(`/api/books/${selected.id}/open`, {
          method: "POST",
          body: {
            format: selected.formats.includes("EPUB")
              ? "EPUB"
              : selected.formats[0],
          },
        });
        toast("Opening the book in calibre’s reader.");
      } catch (error) {
        toast(error.message, true);
      }
      return;
    }
    if (book || opening || closing) return;
    opening = true;
    libraryScroll = window.scrollY;
    book = selected;
    page = selected.progress?.page || 1;
    total = 0;
    $("#reader-title").textContent = book.title;
    $("#reader-save-status").textContent = "Opening…";
    $("#reader-error").hidden = true;
    $("#download-pdf").href = bookFileURL(book, "PDF", true);
    $("#zoom").value = mode === "flip" ? "page" : "fit";
    syncControls();
    await sweep(
      true,
      () => {
        $("#reader").hidden = false;
        frame = document.createElement("iframe");
        frame.id = "pdf-frame";
        syncMode();
        frame.src = appURL("reader-frame.html");
        $("#paper-area").replaceChildren(frame);
      },
      () => {
        document.body.classList.add("reading");
        $("#workspace").hidden = $(".toolbar").hidden = true;
      },
    );
    opening = false;
    if (closeAfterOpen) {
      closeAfterOpen = false;
      close();
    } else if (!passwordPending)
      $("#back-to-library").focus({ preventScroll: true });
  }

  async function close() {
    if (opening) {
      closeAfterOpen = true;
      return;
    }
    if (!book || closing) return;
    closing = true;
    clearTimeout(saveTimer);
    const saving = savePosition();
    passwordPending = false;
    if ($("#password-dialog").open) $("#password-dialog").close();
    await sweep(
      false,
      () => {
        $("#workspace").hidden = $(".toolbar").hidden = false;
        document.body.classList.remove("reading");
        window.scrollTo({ top: libraryScroll, behavior: "instant" });
      },
      () => {
        // Keep the rendered PDF visible until the ladder has passed, then release it.
        frame?.remove();
        frame = null;
        $("#reader").hidden = true;
      },
    );
    await saving;
    book = null;
    total = 0;
    onClose();
    $("#read-button").focus({ preventScroll: true });
    closing = false;
  }

  window.addEventListener("message", (event) => {
    if (
      !frame ||
      !book ||
      event.source !== frame.contentWindow ||
      event.origin !== location.origin ||
      event.data?.channel !== "the-den-reader"
    )
      return;
    const message = event.data;
    if (message.type === "ready")
      post("open", { id: book.id, url: bookFileURL(book), page, mode });
    if (message.type === "mode" && ["scroll", "flip"].includes(message.mode)) {
      mode = message.mode;
      syncMode();
      try {
        localStorage.setItem("den-reader-mode", mode);
      } catch {
        /* Keep the choice for this session. */
      }
    }
    if (
      message.type === "position" &&
      Number.isSafeInteger(message.page) &&
      Number.isSafeInteger(message.totalPages) &&
      message.page > 0 &&
      message.page <= message.totalPages
    ) {
      page = message.page;
      total = message.totalPages;
      syncControls();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(savePosition, 500);
    }
    if (message.type === "zoom") {
      const value = message.value;
      const select = $("#zoom");
      select.querySelector("[data-custom]")?.remove();
      if (![...select.options].some((option) => option.value === value)) {
        const option = new Option(`${Math.round(Number(value) * 100)}%`, value);
        option.dataset.custom = "";
        select.add(option);
      }
      select.value = value;
    }
    if (message.type === "password") {
      passwordPending = true;
      $("#password-message").textContent = message.incorrect
        ? "That password was not accepted. Try again."
        : "Enter the document password.";
      $("#pdf-password").value = "";
      if (!$("#password-dialog").open) $("#password-dialog").showModal();
    }
    if (message.type === "error") {
      $("#reader-error").textContent = message.message;
      $("#reader-error").hidden = false;
      $("#reader-save-status").textContent = "";
    }
    if (message.type === "close") close();
  });
  $("#password-form").addEventListener("submit", (event) => {
    event.preventDefault();
    passwordPending = false;
    post("password", { value: $("#pdf-password").value });
    $("#pdf-password").value = "";
    $("#password-dialog").close();
  });
  $("#password-dialog").addEventListener("close", () => {
    if (passwordPending) close();
  });
  $("#back-to-library").addEventListener("click", close);
  $("#prev-page").addEventListener("click", () =>
    post("page", { page: page - 1 }),
  );
  $("#next-page").addEventListener("click", () =>
    post("page", { page: page + 1 }),
  );
  $("#page-number").addEventListener("change", (event) =>
    post("page", { page: Math.round(Number(event.target.value) || 1) }),
  );
  $("#page-number").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      post("page", { page: Math.round(Number(event.target.value) || 1) });
    }
  });
  $("#zoom").addEventListener("change", (event) =>
    post("zoom", { value: event.target.value }),
  );
  $("#rotate-page").addEventListener("click", () => post("rotate"));
  document.querySelectorAll("[data-reader-mode]").forEach((button) => {
    button.addEventListener("click", () =>
      post("mode", { mode: button.dataset.readerMode }),
    );
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      clearTimeout(saveTimer);
      savePosition();
    }
  });
  return { open, close };
}
