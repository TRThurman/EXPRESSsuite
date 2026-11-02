#!/usr/bin/env python3
"""Assemble docs/expresssuite-capabilities.pptx from the Beamer PDF.

Each PDF page becomes one 4:3 slide (10 x 7.5 in) holding the page rendered at
200 dpi, with the page's text in the speaker notes so the deck stays searchable
and readable without the pictures. The .tex is the editable source; this script
is a one-way export. Needs python-pptx, pdftoppm and pdftotext (poppler).

Usage: python3 build-capabilities-pptx.py [expresssuite-capabilities.pdf]
"""
import subprocess
import sys
import tempfile
from pathlib import Path

from pptx import Presentation
from pptx.util import Inches

here = Path(__file__).resolve().parent
pdf = Path(sys.argv[1]) if len(sys.argv) > 1 else here / "expresssuite-capabilities.pdf"
out = pdf.with_suffix(".pptx")

with tempfile.TemporaryDirectory() as tmp:
    subprocess.run(["pdftoppm", "-png", "-r", "200", str(pdf), f"{tmp}/page"], check=True)
    pages = sorted(Path(tmp).glob("page-*.png"))
    prs = Presentation()
    prs.slide_width = Inches(10)
    prs.slide_height = Inches(7.5)
    blank = prs.slide_layouts[6]
    for index, png in enumerate(pages, start=1):
        slide = prs.slides.add_slide(blank)
        slide.shapes.add_picture(str(png), 0, 0, width=prs.slide_width, height=prs.slide_height)
        text = subprocess.run(
            ["pdftotext", "-layout", "-f", str(index), "-l", str(index), str(pdf), "-"],
            check=True, capture_output=True, text=True,
        ).stdout.strip()
        slide.notes_slide.notes_text_frame.text = text
    prs.save(out)
print(f"{out.name}: {len(prs.slides)} slides, {out.stat().st_size // 1024} KB")
