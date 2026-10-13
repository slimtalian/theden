import test from "node:test";
import assert from "node:assert/strict";

test("a slow progress save does not trap the reader and reopening keeps the latest page", async () => {
  const names = ["document", "window", "location", "localStorage", "matchMedia"];
  const originals = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  const elements = new Map(), frames = [], messages = [], listeners = new Map();
  function element() {
    const classes = new Set();
    return {
      hidden:true, open:false, inert:false, isConnected:true, style:{}, dataset:{},
      classList:{add:(...values) => values.forEach(value => classes.add(value)),
        remove:(...values) => values.forEach(value => classes.delete(value)),
        contains:value => classes.has(value),
        toggle:(value, enabled) => enabled ? classes.add(value) : classes.delete(value)},
      setAttribute() {}, addEventListener() {}, focus() {}, remove() {}, replaceChildren() {},
      getBoundingClientRect:() => ({width:390}),
      querySelector:selector => get(selector),
    };
  }
  function get(selector) {
    if (!elements.has(selector)) elements.set(selector, element());
    return elements.get(selector);
  }
  const body = element();
  Object.assign(globalThis, {
    document:{body, baseURI:"http://localhost/", documentElement:{dataset:{mode:"local"}},
      querySelector:get, querySelectorAll:() => [], getElementById:id => get(`#${id}`),
      addEventListener() {},
      createElement:tag => {
        const node = element();
        if (tag === "iframe") { node.contentWindow = {postMessage:value => messages.push(value)}; frames.push(node); }
        return node;
      }},
    window:{scrollX:0,scrollY:0,scrollTo() {},addEventListener:(name, fn) => listeners.set(name, fn)},
    location:{origin:"http://localhost"},
    matchMedia:() => ({matches:true}),
  });
  Object.defineProperty(globalThis, "localStorage", {configurable:true,value:{getItem:() => null,setItem() {}}});
  const book = {id:1,title:"A test book",authors:"Test author",formats:["PDF"]};
  let resolveSave, closes = 0, saves = 0, reader, timeout;
  const pendingSave = new Promise(resolve => { resolveSave = resolve; });
  try {
    const {setupReader} = await import("../public/reader.js");
    reader = setupReader({api:(_route, options) => saves++ === 0 ? pendingSave : Promise.resolve({progress:options.body}),getBooks:() => [book],onClose:() => closes++,toast() {}});
    const message = data => listeners.get("message")({source:frames.at(-1).contentWindow,
      origin:location.origin,data:{channel:"the-den-reader",...data}});
    await reader.open(book);
    message({type:"position",page:19,totalPages:32});
    await Promise.race([reader.close(),new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error("Closing waited for the network save")), 1000);
    })]);
    clearTimeout(timeout);
    assert.equal(closes, 1);
    assert.equal(book.progress.page, 19);
    await reader.open(book);
    message({type:"ready"});
    assert.equal(messages.at(-1).page, 19);
    message({type:"position",page:21,totalPages:32});
    await reader.close();
    resolveSave({progress:{page:19,totalPages:32}});
    await Promise.resolve(); await Promise.resolve();
    assert.equal(book.progress.page, 21, "an old save response cannot replace a newer page");
    assert.equal(body.style.position, undefined);
  } finally {
    clearTimeout(timeout);
    resolveSave({progress:{page:21,totalPages:32}});
    if (reader) await reader.close();
    // Let queued saves finish before restoring this test's browser environment.
    await new Promise(resolve => setImmediate(resolve));
    names.forEach((name, index) => originals[index]
      ? Object.defineProperty(globalThis, name, originals[index]) : delete globalThis[name]);
  }
});
