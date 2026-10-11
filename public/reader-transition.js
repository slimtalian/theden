// Keep both real views mounted while the ladder reveals or covers the reader.
// This also works in browsers without the View Transition API.
export function createReaderTransition(reader) {
  const overlay = document.createElement("div");
  overlay.id = "library-ladder";
  overlay.hidden = true;
  overlay.setAttribute("aria-hidden", "true");
  overlay.innerHTML =
    '<div class="ladder-traveller"><div class="ladder-body"><div class="ladder-rungs"></div><i class="ladder-wheel left"></i><i class="ladder-wheel right"></i></div></div>';
  document.body.append(overlay);
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
    reader.classList.add("reader-transition-layer");
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
        duration: 900,
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
        reader.classList.remove("reader-transition-layer");
        document.body.classList.remove("changing-room");
        app.inert = wasInert;
      }
    }
  };
}
