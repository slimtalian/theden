import test from "node:test";
import assert from "node:assert/strict";
import { bookDesign, jacketSVG, jacketURL } from "../public/book-design.js";

test("a book keeps its binding when its metadata changes", () => {
  const book = {uuid:"sample-volume", title:"A First Title", authors:"A Writer", tags:[]};
  assert.deepEqual(bookDesign(book), bookDesign({...book,title:"An Edited Title"}));
  assert.equal(jacketSVG(book), jacketSVG({...book}));
  assert.match(jacketSVG(book), /A First Title/);
  assert.equal(decodeURIComponent(jacketURL(book).split(",").slice(1).join(",")), jacketSVG(book));
});

test("generated jackets bound long metadata and escape SVG content", () => {
  const svg = jacketSVG({uuid:"sample",title:'<script>alert("x")</script> ' + "W".repeat(1500), authors:'A & B <img>',tags:['<foreignObject>'],color:'red" onload="alert(1)'});
  assert.doesNotMatch(svg, /<script|<img|<foreignObject|onload=/);
  assert.match(svg, /&amp;/);
  assert.match(svg, /…/);
  assert.ok(svg.length < 5000);
});
