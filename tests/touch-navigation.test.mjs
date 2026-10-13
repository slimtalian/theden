import test from "node:test";
import assert from "node:assert/strict";
import {bindHorizontalDrag, swipePageDelta} from "../public/reader-gestures.js";
import {lockLibraryScroll, unlockLibraryScroll} from "../public/reader-transition.js";

class Surface {
  handlers = new Map(); captured = new Set();
  addEventListener(type, fn) { this.handlers.set(type, fn); }
  setPointerCapture(id) { this.captured.add(id); }
  hasPointerCapture(id) { return this.captured.has(id); }
  releasePointerCapture(id) { this.captured.delete(id); }
  emit(type, values = {}) {
    const event = {pointerId:1, pointerType:"touch", button:0, clientX:200,
      clientY:200, timeStamp:0, detail:1, prevented:false, stopped:false,
      preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...values};
    this.handlers.get(type)?.(event);
    return event;
  }
}
function gesture() {
  const surface = new Surface(), moves = [], ends = [];
  bindHorizontalDrag(surface, {onMove:value => moves.push(value), onEnd:value => ends.push(value)});
  return {surface, moves, ends};
}
test("a shelf swipe turns once and cannot also open a book", () => {
  const {surface, moves, ends} = gesture();
  surface.emit("pointerdown");
  surface.emit("pointermove", {clientX:190,timeStamp:30});
  surface.emit("pointermove", {clientX:100,clientY:210,timeStamp:180});
  surface.emit("pointerup", {clientX:80,clientY:210,timeStamp:220});
  assert.equal(moves.length, 2);
  assert.equal(ends.length, 1);
  assert.equal(swipePageDelta(ends[0].dx,ends[0].dy,ends[0].elapsed), 1);
  assert.equal(surface.emit("click", {timeStamp:221}).stopped, true);
  assert.equal(surface.emit("click", {timeStamp:222,detail:0}).prevented, false, "keyboard activation remains available");
  assert.equal(surface.captured.size, 0);
});
test("vertical scroll, taps and pinch gestures do not navigate", () => {
  for (const kind of ["vertical", "tap", "pinch", "cancel"]) {
    const {surface, ends} = gesture();
    surface.emit("pointerdown");
    if (kind === "vertical") surface.emit("pointermove", {clientX:203,clientY:230,timeStamp:50});
    if (kind === "pinch") surface.emit("pointerdown", {pointerId:2,clientX:230,timeStamp:30});
    if (kind === "cancel") surface.emit("pointercancel", {timeStamp:50});
    surface.emit("pointermove", {clientX:kind === "tap" ? 201 : 100,timeStamp:100});
    surface.emit("pointerup", {clientX:kind === "tap" ? 201 : 80,timeStamp:150});
    assert.equal(ends.length, 0, kind);
    if (kind === "tap") assert.equal(surface.emit("click",{timeStamp:151}).prevented, false);
  }
});
test("cancelled drags recover and pausing before release does not fling", () => {
  const {surface, ends} = gesture();
  surface.emit("pointerdown");
  surface.emit("pointermove", {clientX:170,timeStamp:30});
  surface.emit("pointercancel", {timeStamp:40});
  surface.emit("pointerdown", {timeStamp:500});
  surface.emit("pointermove", {clientX:100,timeStamp:600});
  surface.emit("pointerup", {clientX:100,timeStamp:800});
  assert.equal(ends.length, 1);
  assert.equal(ends[0].velocityX, 0);
});
test("losing capture without a pointer-up cannot disable later touch gestures", () => {
  const {surface, ends} = gesture();
  surface.emit("pointerdown");
  surface.emit("pointermove", {clientX:170,timeStamp:30});
  surface.emit("lostpointercapture", {timeStamp:40});
  // The first finger was released outside this surface. A new touch gets a new id.
  surface.emit("pointerdown", {pointerId:2,timeStamp:500});
  surface.emit("pointermove", {pointerId:2,clientX:100,timeStamp:600});
  surface.emit("pointerup", {pointerId:2,clientX:80,timeStamp:650});
  assert.equal(ends.length, 1);
  assert.equal(swipePageDelta(ends[0].dx, ends[0].dy, ends[0].elapsed), 1);
});
test("nested book and reader views restore the original library scroll only on final return", () => {
  const globals = ["document", "window", "getComputedStyle"];
  const originals = globals.map(key => Object.getOwnPropertyDescriptor(globalThis,key));
  const style = {position:"",top:"",left:"",right:"",width:"",paddingRight:""};
  const scrolls = [];
  globalThis.document = {body:{style,getBoundingClientRect:() => ({width:375})}, documentElement:{clientWidth:375}};
  globalThis.window = {scrollX:0,scrollY:625,innerWidth:390,scrollTo:value => scrolls.push(value)};
  globalThis.getComputedStyle = () => ({scrollbarGutter:"auto"});
  try {
    lockLibraryScroll("book");
    assert.equal(style.top, "-625px");
    assert.equal(style.width, "375px", "scrollbar changes cannot reflow the underlying shelves");
    globalThis.window.scrollY = 0;
    lockLibraryScroll("reader");
    unlockLibraryScroll("reader");
    assert.equal(scrolls.length, 0);
    assert.equal(style.position, "fixed");
    unlockLibraryScroll("book");
    assert.equal(style.position, "");
    assert.deepEqual(scrolls, [{left:0,top:625,behavior:"instant"}]);
  } finally {
    unlockLibraryScroll("reader"); unlockLibraryScroll("book");
    globals.forEach((key,index) => originals[index] ? Object.defineProperty(globalThis,key,originals[index]) : delete globalThis[key]);
  }
});
