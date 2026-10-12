import * as pdfjs from "./vendor/pdfjs/build/pdf.mjs";
import { bindHorizontalDrag, swipePageDelta } from "./reader-gestures.js";

// Keep the upstream viewer's styles inside this document, away from the library.
const { PDFViewer, EventBus, PDFLinkService, ScrollMode } = await import(
  "./vendor/pdfjs/web/pdf_viewer.mjs"
);
pdfjs.GlobalWorkerOptions.workerSrc = "./vendor/pdfjs/build/pdf.worker.mjs";
const eventBus = new EventBus();
const container = document.querySelector("#viewerContainer");
const edges = document.querySelector("#page-edges");
const previousEdge = document.querySelector("#edge-previous");
const nextEdge = document.querySelector("#edge-next");
const linkService = new PDFLinkService({
  eventBus,
  externalLinkTarget: 2,
  externalLinkRel: "noopener noreferrer",
});
const viewer = new PDFViewer({
  container,
  eventBus,
  linkService,
  annotationMode: pdfjs.AnnotationMode.ENABLE,
  annotationEditorMode: pdfjs.AnnotationEditorType.NONE,
  imageResourcesPath: "./vendor/pdfjs/web/images/",
  maxCanvasPixels: 8 * 1024 * 1024,
});
linkService.setViewer(viewer);
let documentPDF,
  loadTask,
  initialPage = 1,
  ready = false,
  passwordCallback,
  mode = "scroll",
  changingMode = false,
  turnAnimation;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const send = (type, value = {}) =>
  parent.postMessage(
    { channel: "the-den-reader", type, ...value },
    location.origin,
  );
const position = () => {
  if (ready && !changingMode)
    send("position", {
      page: viewer.currentPageNumber,
      totalPages: documentPDF.numPages,
    });
};
const zoomValue = () =>
  viewer.currentScaleValue === "page-width"
    ? "fit"
    : viewer.currentScaleValue === "page-fit"
      ? "page"
      : String(viewer.currentScale);

function syncPan() {
  const page = container.querySelector(".page");
  const needsPan =
    page &&
    (page.clientWidth > container.clientWidth + 2 ||
      page.clientHeight > container.clientHeight + 2);
  container.classList.toggle("page-pannable", Boolean(needsPan));
  syncEdges();
}

function syncEdges() {
  edges.hidden = mode !== "flip" || !ready;
  if (edges.hidden) return;
  const page = viewer.getPageView(viewer.currentPageNumber - 1)?.div;
  if (!page) return;
  const bounds = page.getBoundingClientRect(),
    area = container.getBoundingClientRect();
  const top = Math.max(bounds.top, area.top),
    bottom = Math.min(bounds.bottom, area.bottom);
  previousEdge.disabled = viewer.currentPageNumber === 1;
  nextEdge.disabled = viewer.currentPageNumber === documentPDF.numPages;
  for (const [button, x, left] of [
    [previousEdge, bounds.left, true],
    [nextEdge, bounds.right, false],
  ]) {
    // Keep the controls attached to the actual paper edges. Panning a zoomed
    // page out of view hides that edge instead of covering its text with a button.
    button.hidden = bottom <= top || x < area.left - 1 || x > area.right + 1;
    button.style.top = `${top}px`;
    button.style.height = `${Math.max(0, bottom - top)}px`;
    button.style.left = `${Math.max(area.left, Math.min(area.right - 44, x - (left ? 32 : 12)))}px`;
  }
}
previousEdge.addEventListener("click", () =>
  goToPage(viewer.currentPageNumber - 1),
);
nextEdge.addEventListener("click", () =>
  goToPage(viewer.currentPageNumber + 1),
);
container.addEventListener("scroll", syncEdges, { passive: true });

function setMode(nextMode) {
  const currentPage = viewer.currentPageNumber;
  changingMode = true;
  turnAnimation?.cancel();
  viewer.scrollMode =
    nextMode === "flip" ? ScrollMode.PAGE : ScrollMode.VERTICAL;
  mode = viewer.scrollMode === ScrollMode.PAGE ? "flip" : "scroll";
  container.classList.toggle("page-flip", mode === "flip");
  container.setAttribute(
    "aria-label",
    mode === "flip"
      ? "PDF page — click the left or right edge to turn"
      : "PDF pages — scroll to read",
  );
  viewer.currentPageNumber = currentPage;
  viewer.currentScaleValue = mode === "flip" ? "page-fit" : "page-width";
  // Scaling can restore PDFViewer's previous scroll location. Anchor the saved
  // page after both layout and scale have changed, including landscape pages.
  viewer.scrollPageIntoView({ pageNumber: currentPage });
  viewer.update();
  changingMode = false;
  send("mode", { mode });
  send("zoom", { value: zoomValue() });
  position();
  requestAnimationFrame(syncPan);
}

function goToPage(page) {
  viewer.currentPageNumber = Math.max(1, Math.min(page, documentPDF.numPages));
}

eventBus.on("pagesinit", () => {
  viewer.currentPageNumber = Math.min(initialPage, documentPDF.numPages);
  setMode(mode);
  ready = true;
  position();
  syncEdges();
  container.focus({ preventScroll: true });
});
eventBus.on("pagechanging", ({ pageNumber, previous }) => {
  position();
  if (!ready || changingMode || mode !== "flip") return;
  // Wait for PDFViewer to attach the new page before animating its arrival.
  requestAnimationFrame(() => {
    if (mode !== "flip" || viewer.currentPageNumber !== pageNumber) return;
    if (viewer.currentScaleValue === "page-fit")
      viewer.currentScaleValue = "page-fit";
    syncPan();
    turnAnimation?.cancel();
    const page = container.querySelector(
      `.page[data-page-number="${pageNumber}"]`,
    );
    if (!page || reducedMotion.matches) return;
    const direction = pageNumber > previous ? 1 : -1;
    turnAnimation = page.animate(
      [
        {
          transform: `perspective(1200px) translateX(${direction * 28}px) rotateY(${direction * 3}deg)`,
          opacity: 0.6,
        },
        {
          transform: "perspective(1200px) translateX(0) rotateY(0)",
          opacity: 1,
        },
      ],
      { duration: 240, easing: "cubic-bezier(.2,.7,.2,1)" },
    );
    turnAnimation.finished.then(syncEdges, () => {});
  });
});
eventBus.on("pagerendered", ({ error }) => {
  if (error)
    send("error", {
      message: `This page could not be rendered: ${error.message}`,
    });
  syncEdges();
});
eventBus.on("scalechanging", ({ scale, presetValue }) => {
  if (ready && !changingMode)
    send("zoom", {
      value:
        presetValue === "page-width"
          ? "fit"
          : presetValue === "page-fit"
            ? "page"
            : String(scale),
    });
  requestAnimationFrame(syncPan);
});

window.addEventListener("message", async (event) => {
  if (
    event.source !== parent ||
    event.origin !== location.origin ||
    event.data?.channel !== "the-den-reader"
  )
    return;
  const message = event.data;
  if (
    message.type === "open" &&
    Number.isSafeInteger(message.id) &&
    message.id > 0 &&
    !loadTask
  ) {
    initialPage = Number.isSafeInteger(message.page)
      ? Math.max(1, message.page)
      : 1;
    mode = message.mode === "flip" ? "flip" : "scroll";
    try {
      loadTask = pdfjs.getDocument({
        url: (() => {
          const url = new URL(
            message.url || `./api/books/${message.id}/file?format=PDF`,
            location.href,
          );
          if (url.origin !== location.origin)
            throw new Error("Book files must come from this library.");
          return url.href;
        })(),
        cMapUrl: "./vendor/pdfjs/cmaps/",
        cMapPacked: true,
        standardFontDataUrl: "./vendor/pdfjs/standard_fonts/",
        wasmUrl: "./vendor/pdfjs/wasm/",
        isEvalSupported: false,
      });
      loadTask.onPassword = (callback, reason) => {
        passwordCallback = callback;
        send("password", {
          incorrect: reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD,
        });
      };
      documentPDF = await loadTask.promise;
      linkService.setDocument(documentPDF);
      viewer.setDocument(documentPDF);
      viewer.pagesPromise.catch((error) =>
        send("error", { message: error.message }),
      );
    } catch (error) {
      send("error", {
        message: `The PDF could not be opened. ${error.message}`,
      });
    }
  } else if (message.type === "password" && passwordCallback) {
    const callback = passwordCallback;
    passwordCallback = null;
    callback(String(message.value));
  } else if (ready) {
    if (message.type === "page" && Number.isSafeInteger(message.page))
      goToPage(message.page);
    if (
      message.type === "mode" &&
      ["scroll", "flip"].includes(message.mode) &&
      message.mode !== mode
    )
      setMode(message.mode);
    if (message.type === "zoom") {
      if (message.value === "fit") viewer.currentScaleValue = "page-width";
      else if (message.value === "page") viewer.currentScaleValue = "page-fit";
      else if (Number(message.value) >= 0.25 && Number(message.value) <= 5)
        viewer.currentScale = Number(message.value);
    }
    if (message.type === "rotate")
      viewer.pagesRotation = (viewer.pagesRotation + 90) % 360;
  }
});
document.addEventListener("keydown", (event) => {
  if (["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) return;
  if (event.key === "Escape") send("close");
  if (event.key === "ArrowRight" && ready) {
    event.preventDefault();
    goToPage(viewer.currentPageNumber + 1);
  }
  if (event.key === "ArrowLeft" && ready) {
    event.preventDefault();
    goToPage(viewer.currentPageNumber - 1);
  }
  if (mode === "flip" && ready && ["PageDown", "PageUp"].includes(event.key)) {
    event.preventDefault();
    goToPage(viewer.currentPageNumber + (event.key === "PageDown" ? 1 : -1));
  }
});

// Only fitted pages accept page-turn swipes. Zoomed pages retain native panning,
// and a second finger cancels the gesture so pinch zoom cannot turn a page.
let swipedPage;
function settlePage() {
  if (!swipedPage) return;
  const page = swipedPage, from = page.style.transform;
  page.style.removeProperty("transform");
  if (from && !reducedMotion.matches)
    turnAnimation = page.animate([{transform:from}, {transform:"none"}], {duration:180, easing:"ease-out"});
  swipedPage = null;
}
bindHorizontalDrag(container, {
  canStart:event => ready && mode === "flip" && !container.classList.contains("page-pannable")
    && !event.target.closest("a, input, textarea, select, button, .annotationLayer")
    && getSelection().isCollapsed,
  onStart:() => {
    turnAnimation?.cancel();
    swipedPage = viewer.getPageView(viewer.currentPageNumber - 1)?.div;
  },
  onMove:({dx}) => {
    if (swipedPage && !reducedMotion.matches)
      swipedPage.style.transform = `translateX(${Math.max(-70, Math.min(70, dx * .35))}px)`;
  },
  onEnd:({dx, dy, elapsed}) => {
    const delta = getSelection().isCollapsed ? swipePageDelta(dx, dy, elapsed) : 0;
    const next = viewer.currentPageNumber + delta;
    if (delta && next > 0 && next <= documentPDF.numPages) {
      swipedPage?.style.removeProperty("transform");
      swipedPage = null;
      goToPage(next);
    } else settlePage();
  },
  onCancel:settlePage,
});
let resizeTimer;
let lastWidth = container.clientWidth;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!ready) return;
    const widthChanged = container.clientWidth !== lastWidth;
    lastWidth = container.clientWidth;
    // Browser bars and the keyboard change height. They must not reset a
    // continuous reading position when the fitted paper width is unchanged.
    const scale = viewer.currentScaleValue;
    if (scale === "page-fit" || (scale === "page-width" && widthChanged)) {
      const page = viewer.getPageView(viewer.currentPageNumber - 1)?.div;
      const offset = page ? (container.scrollTop - page.offsetTop) / page.clientHeight : 0;
      viewer.currentScaleValue = scale;
      if (mode === "scroll" && page) container.scrollTop = page.offsetTop + offset * page.clientHeight;
    }
    viewer.update();
    syncPan();
  }, 100);
});
// PDFViewer renders nearby pages and evicts distant canvases from its cache.
send("ready");
