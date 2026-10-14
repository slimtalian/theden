#!/usr/bin/env python3
"""Build The Den's original demo PDFs and SVG covers from demo/books.json.

Requires Python 3 and ReportLab: python -m pip install reportlab
Run from any directory: python scripts/generate-demo-books.py
All paths are relative to this repository. No external images or fonts are used.
The original text and artwork follow the repository's MIT license.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph


ROOT = Path(__file__).resolve().parents[1]
WIDTH, HEIGHT = 420, 595
MARGIN = 44
PAPER = "#f5efdf"
INK = "#30362f"
BRASS = "#d8bb80"
MUTED = "#737567"
RULE = "#d5cbb6"




def hexcolor(value):
    return colors.HexColor(value)


def icon_shapes(number):
    """Return simple vector primitives in a 120 x 120, top-left coordinate space."""
    if number == 1:
        return [("circle", 60, 60, 23), ("circle", 50, 52, 2),
                ("line", 37, 61, 20, 66), ("line", 60, 83, 53, 103),
                ("line", 65, 83, 72, 103), ("line", 69, 60, 103, 85)]
    if number == 2:
        return [("rect", 25, 36, 65, 43), ("circle", 31, 43, 22),
                ("circle", 94, 55, 15), ("line", 27, 79, 27, 104),
                ("line", 78, 79, 78, 104), ("line", 99, 40, 107, 28)]
    if number == 3:
        return [("rect", 23, 20, 74, 80), ("line", 37, 38, 83, 38),
                ("line", 60, 38, 60, 85), ("line", 44, 85, 76, 85)]
    if number == 4:
        return [("circle", 60, 60, 33), ("circle", 60, 60, 18),
                ("line", 23, 100, 97, 100), ("line", 60, 93, 60, 100)]
    if number == 5:
        return [("rect", 20, 20, 80, 80), ("line", 46, 20, 46, 100),
                ("line", 73, 20, 73, 100), ("line", 20, 52, 100, 52),
                ("line", 20, 77, 100, 77)]
    if number == 6:
        return [("line", 20, 20, 20, 100), ("line", 100, 20, 100, 100),
                ("line", 20, 44, 64, 44), ("line", 56, 77, 100, 77),
                ("line", 60, 10, 60, 110)]
    raise ValueError("Unknown demo icon")


def svg_icon(number):
    parts = []
    for shape in icon_shapes(number):
        kind, *v = shape
        if kind == "line":
            parts.append(f'<line x1="{v[0]}" y1="{v[1]}" x2="{v[2]}" y2="{v[3]}"/>')
        elif kind == "circle":
            parts.append(f'<circle cx="{v[0]}" cy="{v[1]}" r="{v[2]}"/>')
        else:
            parts.append(f'<rect x="{v[0]}" y="{v[1]}" width="{v[2]}" height="{v[3]}"/>')
    return "\n".join(parts)


def make_svg(book, path):
    title = escape(book["title"])
    lines = book["titleLines"]
    title_svg = "\n".join(
        f'<text x="218" y="{162 + i * 46}" font-size="39">{escape(line)}</text>'
        for i, line in enumerate(lines)
    )
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {WIDTH} {HEIGHT}" role="img" aria-labelledby="title desc">
<title id="title">{title}</title>
<desc id="desc">Original demo cover. The Den Editions. A modern sample essay about animals, inventions, and geography.</desc>
<rect width="420" height="595" fill="{book['color']}"/>
<path d="M0 0H15V595H0Z" fill="#000" opacity=".16"/>
<path d="M20 0V595" stroke="{BRASS}" opacity=".3"/>
<rect x="35" y="30" width="355" height="533" rx="1" fill="none" stroke="{BRASS}" stroke-opacity=".55"/>
<path d="M47 74H378 M47 500H378" stroke="{BRASS}" stroke-opacity=".55"/>
<g fill="{PAPER}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif">
<text x="218" y="59" font-family="Arial, sans-serif" font-size="9" letter-spacing="3">HISTORIES OF OUR WORLD</text>
{title_svg}
<text x="218" y="414" font-family="Arial, sans-serif" font-size="9" letter-spacing="2">{escape(book['tags'][0].upper())}</text>
<text x="218" y="451" font-size="18">The Den Editions</text>
<text x="218" y="528" font-family="Arial, sans-serif" font-size="9" letter-spacing="2">ORIGINAL SAMPLE ESSAY</text>
</g>
<g transform="translate(158, 261)" fill="none" stroke="{BRASS}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">{svg_icon(book['id'])}</g>
<circle cx="218" cy="477" r="2" fill="{BRASS}"/>
</svg>
'''
    path.write_text(svg, encoding="utf-8")


def draw_icon(pdf, number, x, top):
    pdf.saveState()
    pdf.setStrokeColor(hexcolor(BRASS))
    pdf.setLineWidth(1.6)
    pdf.setLineCap(1)
    for shape in icon_shapes(number):
        kind, *v = shape
        if kind == "line":
            pdf.line(x + v[0], top - v[1], x + v[2], top - v[3])
        elif kind == "circle":
            pdf.circle(x + v[0], top - v[1], v[2], stroke=1, fill=0)
        else:
            pdf.rect(x + v[0], top - v[1] - v[3], v[2], v[3], stroke=1, fill=0)
    pdf.restoreState()


def centered(pdf, text, y, font="Helvetica", size=9, color=PAPER):
    pdf.setFillColor(hexcolor(color))
    pdf.setFont(font, size)
    pdf.drawCentredString(218, y, text)


def draw_cover(pdf, book):
    pdf.setFillColor(hexcolor(book["color"]))
    pdf.rect(0, 0, WIDTH, HEIGHT, fill=1, stroke=0)
    pdf.setFillColor(colors.Color(0, 0, 0, alpha=.16))
    pdf.rect(0, 0, 15, HEIGHT, fill=1, stroke=0)
    pdf.setStrokeColor(hexcolor(BRASS))
    pdf.setLineWidth(.5)
    pdf.rect(35, 32, 355, 533, stroke=1, fill=0)
    pdf.line(47, HEIGHT - 74, 378, HEIGHT - 74)
    pdf.line(47, HEIGHT - 500, 378, HEIGHT - 500)
    centered(pdf, "HISTORIES OF OUR WORLD", HEIGHT - 59, size=10)
    for i, line in enumerate(book["titleLines"]):
        centered(pdf, line, HEIGHT - 162 - i * 46, "Times-Roman", 39)
    draw_icon(pdf, book["id"], 158, HEIGHT - 261)
    centered(pdf, book["tags"][0].upper(), HEIGHT - 414, size=9)
    centered(pdf, "The Den Editions", HEIGHT - 451, "Times-Roman", 18)
    centered(pdf, "ORIGINAL SAMPLE ESSAY", HEIGHT - 528, size=9)
    pdf.setFillColor(hexcolor(BRASS))
    pdf.circle(218, HEIGHT - 477, 2, fill=1, stroke=0)
    pdf.showPage()


def paper_page(pdf, book, page_number):
    pdf.setFillColor(hexcolor(PAPER))
    pdf.rect(0, 0, WIDTH, HEIGHT, stroke=0, fill=1)
    pdf.setFillColor(hexcolor(MUTED))
    pdf.setFont("Helvetica", 8)
    pdf.drawString(MARGIN, HEIGHT - 35, "THE DEN EDITIONS")
    pdf.drawRightString(WIDTH - MARGIN, HEIGHT - 35, f"NO. {book['id']:02d}")
    pdf.setStrokeColor(hexcolor(RULE))
    pdf.setLineWidth(.5)
    pdf.line(MARGIN, 49, WIDTH - MARGIN, 49)
    pdf.setFont("Helvetica", 7.5)
    pdf.drawString(MARGIN, 33, "MODERN ORIGINAL / DEMO COLLECTION")
    pdf.drawRightString(WIDTH - MARGIN, 33, f"{page_number} / 4")


def paragraph(pdf, text, y, style, width=WIDTH - 2 * MARGIN):
    item = Paragraph(text, style)
    _, height = item.wrap(width, HEIGHT)
    if y - height < 66:
        raise ValueError(f"Content would overlap footer: {text[:70]}")
    item.drawOn(pdf, MARGIN, y - height)
    return y - height


def make_pdf(book, path):
    pdf = canvas.Canvas(str(path), pagesize=(WIDTH, HEIGHT), pageCompression=1, invariant=1)
    pdf.setTitle(book["title"])
    pdf.setAuthor("The Den Editions")
    pdf.setCreator("The Den demo book generator")
    pdf.setSubject("Modern original sample essay about animals, inventions, and geography; not a historical original.")
    pdf.setKeywords("The Den, demo, history, original sample essay")
    heading = ParagraphStyle("heading", fontName="Times-Roman", fontSize=27, leading=31,
                             textColor=hexcolor(INK), spaceAfter=0)
    body = ParagraphStyle("body", fontName="Times-Roman", fontSize=11.5, leading=17.2,
                          textColor=hexcolor(INK), splitLongWords=True)
    small = ParagraphStyle("small", parent=body, fontName="Helvetica", fontSize=9, leading=13.5)
    url = ParagraphStyle("url", parent=small, fontSize=7.5, leading=10.5,
                         textColor=hexcolor(MUTED), splitLongWords=True, uriWasteReduce=0)
    draw_cover(pdf, book)
    for i, section in enumerate(book["sections"]):
        paper_page(pdf, book, i + 2)
        pdf.setFillColor(hexcolor(book["color"]))
        pdf.setFont("Helvetica", 9)
        pdf.drawString(MARGIN, HEIGHT - 81, f"{i + 1:02d}  /  {book['tags'][0].upper()}")
        y = paragraph(pdf, escape(section["title"]), HEIGHT - 102, heading) - 23
        for text in section["paragraphs"]:
            y = paragraph(pdf, escape(text), y, body) - 13
        pdf.showPage()
    paper_page(pdf, book, 4)
    y = paragraph(pdf, "About this edition", HEIGHT - 83, heading) - 23
    y = paragraph(pdf, "This is a modern original sample essay created for The Den's public demo. "
                  "It is not a historical original or a transcription of a historical document. "
                  "The prose and geometric cover artwork were created for this collection.", y, small) - 19
    y = paragraph(pdf, "<b>Sources and further reading</b><br/>These museum and library pages informed "
                  "the historical details. Follow the links to explore their fuller accounts and collections.", y, small) - 18
    for source in book["sources"]:
        link = escape(source["url"], {'"': '&quot;'})
        y = paragraph(pdf, f'<link href="{link}" color="{INK}">{escape(source["title"])}</link>', y, small) - 5
        y = paragraph(pdf, f'<link href="{link}">{escape(source["url"])}</link>', y, url) - 16
    y = paragraph(pdf, "<b>Reuse</b><br/>The original sample text and artwork follow the repository's MIT license. "
                  "Linked sources remain the work of their respective authors and institutions. "
                  "No external illustrations have been reproduced.", y, small)
    pdf.showPage()
    pdf.save()


def main():
    books = json.loads((ROOT / "demo" / "books.json").read_text(encoding="utf-8"))
    for book in books:
        if len(book["sections"]) != 2:
            raise ValueError("Each demo book must have two essay sections.")
        pdf_path = ROOT / "public" / book["file"].removeprefix("./")
        svg_path = ROOT / "public" / book["cover"].removeprefix("./")
        for path in (pdf_path, svg_path):
            if not path.resolve().is_relative_to(ROOT / "public" / "demo"):
                raise ValueError("Demo output must remain inside public/demo.")
            path.parent.mkdir(parents=True, exist_ok=True)
        make_pdf(book, pdf_path)
        make_svg(book, svg_path)
        print(f"Created {pdf_path.relative_to(ROOT)} and {svg_path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
