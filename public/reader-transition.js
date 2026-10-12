const scrollLocks = new Set();
let savedScroll;
export function lockLibraryScroll(owner) {
  if (!scrollLocks.size) {
    const body = document.body;
    const keys = ["position", "top", "left", "right", "width", "paddingRight"];
    savedScroll = {x:window.scrollX, y:window.scrollY, styles:Object.fromEntries(keys.map(key => [key, body.style[key]]))};
    const width = body.getBoundingClientRect().width;
    Object.assign(body.style, {position:"fixed", top:`${-savedScroll.y}px`, left:"0", right:"auto", width:`${width}px`});
  }
  scrollLocks.add(owner);
}
export function unlockLibraryScroll(owner) {
  if (!scrollLocks.delete(owner) || scrollLocks.size || !savedScroll) return;
  Object.assign(document.body.style, savedScroll.styles);
  window.scrollTo({left:savedScroll.x, top:savedScroll.y, behavior:"instant"});
  savedScroll = null;
}

// Keep both real views mounted while the ladder reveals a book or its reader.
// This also works in browsers without the View Transition API.
export function createReaderTransition(reader) {
  const overlay = document.getElementById("library-ladder") || document.createElement("div");
  overlay.id = "library-ladder";
  overlay.hidden = true;
  overlay.setAttribute("aria-hidden", "true");
  if (!overlay.isConnected) {
    overlay.innerHTML =
      '<div class="ladder-traveller"><div class="ladder-body"><div class="ladder-rungs"></div><i class="ladder-wheel left"></i><i class="ladder-wheel right"></i></div></div>';
    document.body.append(overlay);
  }
  const ladder = overlay.querySelector(".ladder-traveller");
  const app = document.querySelector(".app");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

  return async function sweep(opening, prepare, complete) {
    if (
      reducedMotion.matches ||
      document.body.classList.contains("still") ||
      !reader.animate
    ) {
      prepare();
      complete();
      return;
    }
    const wasInert = app.inert;
    let reveal, travel;
    reader.classList.add("room-transition-layer");
    reader.style.clipPath = opening ? "inset(0 100% 0 0)" : "inset(0)";
    document.body.classList.add("changing-room");
    app.inert = true;
    overlay.hidden = false;
    try {
      prepare();
      const width = document.documentElement.clientWidth,
        half = ladder.offsetWidth / 2;
      const start = -180,
        end = width + 180;
      const edge = (x) => `polygon(0 0, ${x}px 0, ${x}px 100%, 0 100%)`;
      const positions = opening ? [start, end] : [end, start];
      const timing = {
        duration: matchMedia("(max-width: 680px)").matches ? 560 : 780,
        easing: "cubic-bezier(.4,0,.2,1)",
        fill: "both",
      };
      reveal = reader.animate(
        positions.map((x) => ({ clipPath: edge(x) })),
        timing,
      );
      travel = ladder.animate(
        positions.map((x) => ({ transform: `translateX(${x - half}px)` })),
        timing,
      );
      await Promise.all([reveal.finished, travel.finished]);
    } catch (error) {
      // Interrupted animations should never strand the reader behind an overlay.
      if (error.name !== "AbortError")
        console.warn("Reader transition skipped:", error);
    } finally {
      try {
        complete();
      } finally {
        reveal?.cancel();
        travel?.cancel();
        overlay.hidden = true;
        reader.style.removeProperty("clip-path");
        reader.classList.remove("room-transition-layer");
        document.body.classList.remove("changing-room");
        app.inert = wasInert;
      }
    }
  };
}
