"""Line-grouping helper over pdfbase.units (glyph-decoded, RTL aware)."""
import sys
import paths  # noqa: F401  (repo-relative sys.path setup)
import pdfbase


def page_lines(doc, pno, tol=6):
    us = pdfbase.units(doc, pno)
    rows = []
    for u in us:
        y, x0, x1, t = u
        if not t.strip():
            continue
        if rows and abs(rows[-1]['y'] - y) <= tol:
            rows[-1]['units'].append((x0, x1, t))
        else:
            rows.append({'y': y, 'units': [(x0, x1, t)]})
    for r in rows:
        r['units'].sort(key=lambda t: -t[1])
        r['text'] = ' '.join(t for _, _, t in r['units'])
    return rows


def doc_lines(path):
    import pymupdf
    doc = pymupdf.open(path)
    out = []
    for pno in range(len(doc)):
        out.append((pno, page_lines(doc, pno)))
    return out
