// A leftward swipe advances; short taps, vertical scrolling and long holds do not.
export function swipePageDelta(deltaX, deltaY, elapsed) {
  if (
    elapsed > 700 ||
    Math.abs(deltaX) < 50 ||
    Math.abs(deltaX) < Math.abs(deltaY) * 1.6
  )
    return 0;
  return deltaX < 0 ? 1 : -1;
}
