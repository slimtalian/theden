// Original 32-page fixture, including a landscape page, for continuous-reader QA.
// Only the isolated browser library on 4322 is an allowed import destination.
import { promises as fs } from "node:fs";
import path from "node:path";
import { PROJECT } from "../server.mjs";
const count = 32,
  font = 3 + count * 2,
  info = font + 1;
const objects = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  `<< /Type /Pages /Kids [${Array.from({ length: count }, (_, i) => `${3 + i * 2} 0 R`).join(" ")}] /Count ${count} >>`,
];
for (let i = 0; i < count; i++) {
  const landscape = i === 15,
    width = landscape ? 792 : 612,
    height = landscape ? 612 : 792;
  objects.push(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${4 + i * 2} 0 R >>`,
  );
  const content =
    i === 0
      ? `0.16 0.23 0.19 rg 0 0 612 792 re f
0.72 0.65 0.44 RG 1 w 34 34 544 724 re S 42 42 528 708 re S
0.82 0.77 0.61 rg BT /F1 12 Tf 223 678 Td (THE DEN / FIELD NOTES) Tj ET
BT /F1 48 Tf 133 481 Td (The Quiet Field) Tj ET
BT /F1 16 Tf 147 440 Td (A study in looking a little closer) Tj ET
0.72 0.65 0.44 RG 306 220 m 306 345 l S 306 280 m 270 310 l 306 310 l S 306 255 m 345 290 l 306 290 l S
BT /F1 13 Tf 189 113 Td (An original reading-test edition) Tj ET`
      : `0.16 0.23 0.19 rg BT /F1 27 Tf 60 ${height - 80} Td (The Quiet Field - page ${i + 1}) Tj ET
BT /F1 13 Tf 60 ${height - 128} Td (An original test document for The Den.) Tj 0 -28 Td (Scroll naturally from one page to the next.) Tj 0 -28 Td (Return to the library and reopen to check the saved page.) Tj ET
0.75 0.71 0.6 RG 60 65 m ${width - 60} 65 l S
BT /F1 11 Tf 60 43 Td (PAGE ${i + 1} / ${count}${landscape ? " - LANDSCAPE" : ""}) Tj ET`;
  objects.push(
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  );
}
objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
objects.push("<< /Title (The Quiet Field) /Author (The Den test edition) >>");
let output = "%PDF-1.4\n",
  offsets = [0];
for (let i = 0; i < objects.length; i++) {
  offsets.push(Buffer.byteLength(output));
  output += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
}
const xref = Buffer.byteLength(output);
output +=
  `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
  offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
const bytes = Buffer.from(output),
  base = "http://127.0.0.1:4322";
const status = await (await fetch(base + "/api/status")).json();
if (
  status.app !== "the-den" ||
  status.libraryPath !== path.join(PROJECT, ".test-runs", "browser", "lib")
)
  throw new Error(
    "Refusing to import outside the isolated browser test library.",
  );
await fs.writeFile(
  path.join(PROJECT, ".test-runs", "browser", "scroll-check.pdf"),
  bytes,
);
const response = await fetch(
  base + "/api/import?name=scroll-check.pdf&tags=Verification",
  { method: "POST", headers: { "X-Den-Token": status.token }, body: bytes },
);
if (!response.ok) throw new Error(await response.text());
const result = await response.json();
console.log(
  JSON.stringify({
    id: result.id,
    added: result.added,
    duplicate: result.duplicate,
    pages: count,
  }),
);
