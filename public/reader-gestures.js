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

// Direction-lock before taking a pointer: vertical scrolling and pinch zoom
// remain native. A drag must never also click the book underneath the finger.
export function bindHorizontalDrag(element, {
  allowMouse = false, canStart = () => true, onPress = () => {},
  onStart = () => {}, onMove = () => {}, onEnd = () => {}, onCancel = () => {},
} = {}) {
  const pointers = new Set();
  let start = null, suppressUntil = 0;
  const release = () => {
    if (start && element.hasPointerCapture?.(start.id)) element.releasePointerCapture(start.id);
  };
  function cancel() {
    if (!start) return;
    release();
    start = null;
    onCancel();
  }
  element.addEventListener("pointerdown", event => {
    if (event.button !== 0 || (event.pointerType === "mouse" && !allowMouse)) return;
    pointers.add(event.pointerId);
    if (pointers.size > 1) { suppressUntil = event.timeStamp + 600; cancel(); return; }
    if (!canStart(event)) return;
    start = {id:event.pointerId, x:event.clientX, y:event.clientY, time:event.timeStamp,
      lastX:event.clientX, lastTime:event.timeStamp, velocityX:0, claimed:false};
    if (event.pointerType === "mouse") element.setPointerCapture(event.pointerId);
    onPress(event);
  });
  element.addEventListener("pointermove", event => {
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    if (!start.claimed) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return;
      if (Math.abs(dx) < Math.abs(dy) * 1.35) { cancel(); return; }
      start.claimed = true;
      element.setPointerCapture(event.pointerId);
      onStart(event);
    }
    const dt = event.timeStamp - start.lastTime;
    if (dt > 0) start.velocityX = .6 * (event.clientX - start.lastX) / dt + .4 * start.velocityX;
    start.lastX = event.clientX;
    start.lastTime = event.timeStamp;
    suppressUntil = event.timeStamp + 600;
    onMove({dx, dy, velocityX:start.velocityX}, event);
  });
  element.addEventListener("pointerup", event => {
    pointers.delete(event.pointerId);
    if (!start || start.id !== event.pointerId) return;
    const ended = start;
    release();
    start = null;
    if (!ended.claimed) { onCancel(); return; }
    suppressUntil = event.timeStamp + 600;
    onEnd({dx:event.clientX - ended.x, dy:event.clientY - ended.y,
      elapsed:event.timeStamp - ended.time,
      velocityX:event.timeStamp - ended.lastTime < 80 ? ended.velocityX : 0}, event);
  });
  element.addEventListener("pointercancel", event => {
    pointers.delete(event.pointerId);
    if (start?.id === event.pointerId) cancel();
  });
  element.addEventListener("lostpointercapture", event => {
    pointers.delete(event.pointerId);
    if (start?.id === event.pointerId) cancel();
  });
  element.addEventListener("click", event => {
    if (event.detail && event.timeStamp < suppressUntil) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);
  return cancel;
}
