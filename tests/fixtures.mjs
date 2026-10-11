export function samplePDF() {
  const objects = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push("<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>");
  const page = (contents) =>
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents ${contents} 0 R >>`;
  const stream = (text) =>
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`;
  objects.push(page(4));
  objects.push(
    stream(
      "BT /F1 26 Tf 62 695 Td (The Den - reader check) Tj 0 -50 Td /F1 14 Tf (Page one. An original test document.) Tj 0 -28 Td (Import, turn the page, and reopen to verify your position.) Tj ET",
    ),
  );
  objects.push(page(6));
  objects.push(
    stream(
      "BT /F1 26 Tf 62 695 Td (A place to return to) Tj 0 -50 Td /F1 14 Tf (Page two. The reading position should be saved here.) Tj 0 -28 Td (This document lives only in the isolated test library.) Tj ET",
    ),
  );
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  objects.push(
    "<< /Title (The Den reader check) /Author (The Den verification) >>",
  );
  let content = "%PDF-1.4\n",
    offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(content));
    content += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(content);
  content += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1))
    content += `${String(offset).padStart(10, "0")} 00000 n \n`;
  content += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 8 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(content);
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++)
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function sampleEPUB() {
  const files = [
    ["mimetype", "application/epub+zip"],
    [
      "META-INF/container.xml",
      '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    ],
    [
      "content.opf",
      '<?xml version="1.0"?><package version="3.0" unique-identifier="id" xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:uuid:53137a67-a1a4-44a0-b3cd-d3d8b5724fa9</dc:identifier><dc:title>The Den EPUB check</dc:title><dc:creator>The Den verification</dc:creator><dc:language>en</dc:language><meta property="dcterms:modified">2026-10-11T00:00:00Z</meta></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="chapter"/></spine></package>',
    ],
    [
      "chapter.xhtml",
      '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>The Den EPUB check</title></head><body><h1>A local EPUB</h1><p>This is an original test fixture.</p></body></html>',
    ],
    [
      "nav.xhtml",
      '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">A local EPUB</a></li></ol></nav></body></html>',
    ],
  ];
  const locals = [],
    directory = [];
  let offset = 0;
  for (const [name, text] of files) {
    const file = Buffer.from(text),
      filename = Buffer.from(name),
      crc = crc32(file),
      header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(file.length, 18);
    header.writeUInt32LE(file.length, 22);
    header.writeUInt16LE(filename.length, 26);
    locals.push(header, filename, file);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(file.length, 20);
    central.writeUInt32LE(file.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, filename);
    offset += 30 + filename.length + file.length;
  }
  const dir = Buffer.concat(directory),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}
