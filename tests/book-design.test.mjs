import test from "node:test";
import assert from "node:assert/strict";
import { bookDesign, jacketSVG, jacketURL, usesClothJacket, spineLayout } from "../public/book-design.js";

test("every book gets a cloth cover unless its original artwork is explicitly selected", () => {
  const book = {uuid:"sample-volume",cover:"./cover.svg"};
  assert.equal(usesClothJacket(book), true);
  const originals = new Set([book.uuid]);
  assert.equal(usesClothJacket(book, originals), false);
  assert.equal(usesClothJacket({...book,uuid:"new-volume"}, originals), true);
  assert.equal(usesClothJacket({...book,cover:null}, originals), true);
});

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

test("spines retain complete titles and distinguishing endings within their binding", () => {
  const measure = (text, size) => Array.from(text).reduce((sum, character) => sum + (/[MW]/.test(character) ? .9 : .52) * size, 0);
  for (const title of ["A Short Book", "A Complete Handbook of Architecture, Volume 12", "The Collected Letters of a Nineteenth-Century Traveller: Second Edition", "WWWW".repeat(125), "日本語の本と歴史の研究", "   "]) {
    for (const design of [{height:208,depth:35}, {height:224,depth:46}]) {
      const layout = spineLayout(title, design, measure);
      assert.equal(layout.lines.join("").replace(/\s/g, ""), (title.trim() || "Untitled").replace(/\s/g, ""));
      assert.ok(layout.lines.every(line => measure(line, layout.size) <= layout.width - 4 + .01));
      assert.ok(layout.lines.length * layout.size * 1.15 <= layout.height - 2 + .01);
      assert.doesNotMatch(layout.lines.join(""), /…/);
    }
  }
});
