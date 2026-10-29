import pymupdf, io, re, json, sys, unicodedata
from fontTools.ttLib import TTFont

AR_DIGITS = str.maketrans('٠١٢٣٤٥٦٧٨٩', '0123456789')
TR = str.maketrans({'\u06cc': '\u064a', '\u06be': '\u0647', '\u06a9': '\u0643'})
LAT = re.compile(r'[A-Za-z0-9][A-Za-z0-9.,:_/\-+%=()\[\]"\']*[A-Za-z0-9)]|[A-Za-z0-9]')
LAMALEF = [('اال', 'الا'), ('اأ', 'الأ'), ('اإ', 'الإ'), ('اآ', 'الآ')]


def build_maps(doc, pno):
    fonts = []
    for xref, ext, typ, base, name, enc in doc.get_page_fonts(pno):
        if ext != 'ttf':
            continue
        try:
            fn, extn, typn, buf = doc.extract_font(xref)
            f = TTFont(io.BytesIO(buf)); cm = f.getBestCmap() or {}; order = f.getGlyphOrder()
        except Exception:
            continue
        g2u = {}
        for u, g in cm.items():
            g2u.setdefault(order.index(g), chr(u))
        fonts.append((re.sub(r'^[A-Z]{6}\+', '', base), g2u))
    maps = {}
    for base, g2u in sorted(fonts, key=lambda t: -len(t[1])):
        m = maps.setdefault(base, {})
        for gid, c in g2u.items():
            m.setdefault(gid, c)
    return maps


def clean(s):
    s = unicodedata.normalize('NFKC', s)
    s = s.translate(AR_DIGITS)
    s = LAT.sub(lambda m: m.group(0)[::-1], s)
    s = s.translate(TR)
    for a, b in LAMALEF:
        s = s.replace(a, b)
    s = re.sub(r'[ \t]+', ' ', s).strip()
    return s


def units(doc, pno, merge_gap=8.5):
    """chunks (y, xmin, xmax, text) - words merged - in reading order (y asc, xmax desc)."""
    maps = build_maps(doc, pno)
    spans = []
    for sp in doc[pno].get_texttrace():
        mm = maps.get(sp['font'], {})
        chars = []
        for ch, g, origin, bbox in sp['chars']:
            c = mm.get(g)
            if c is None:
                c = ch if isinstance(ch, str) else ''
            chars.append((origin[0], c))
        if not chars:
            continue
        xs = [x for x, _ in chars]
        chars.sort(key=lambda t: -t[0])
        txt = ''.join(c for _, c in chars)
        if not txt.strip():
            continue
        y = round((sp['bbox'][1] + sp['bbox'][3]) / 2)
        spans.append((y, min(xs), max(xs), txt))
    spans.sort(key=lambda s: (s[0], -s[2]))
    lines, cur, cy = [], [], None
    for s in spans:
        if cy is None or abs(s[0] - cy) <= 5:
            cur.append(s); cy = s[0] if cy is None else cy
        else:
            lines.append(cur); cur = [s]; cy = s[0]
    if cur:
        lines.append(cur)
    out = []
    for ln in lines:
        ln.sort(key=lambda s: -s[2])
        bufs, curw = [], None
        for y, xmin, xmax, t in ln:
            if curw is None:
                curw = [y, xmin, xmax, t]
            elif curw[1] - xmax <= merge_gap:
                curw = [y, min(curw[1], xmin), xmax, curw[3] + t]
            else:
                bufs.append(curw); curw = [y, xmin, xmax, t]
        if curw:
            bufs.append(curw)
        for w in bufs:
            w[3] = clean(w[3])
            if not w[3]:
                continue
            # drop page-number / tiny artifacts in the footer band
            if w[0] > doc[pno].rect.height * 0.93 and re.fullmatch(r'[\d\s\-–.]+', w[3]):
                continue
            out.append(tuple(w))
    out.sort(key=lambda u: (u[0], -u[2]))
    return out


def split_markers(text, letters='أبجد', brackets='()(-'):
    """Split a chunk that contains embedded option markers."""
    pat = r'(?=([' + letters + r'])\s*[\(\)\-–]\s*)'
    parts = re.split(pat, text)
    if len(parts) == 1:
        return [(None, text)]
    res = []
    cur = None
    buf = []
    for p in parts:
        if p is None or p == '':
            continue
        if len(p) == 1 and p in letters:
            if buf:
                res.append((cur, ''.join(buf)))
            cur = p
            buf = []
        else:
            buf.append(p)
    if buf:
        res.append((cur, ''.join(buf)))
    fixed = []
    for letter, body in res:
        body = re.sub(r'^\s*[' + letters + r']?\s*[\(\)\-–]\s*', '', body) if letter else body
        fixed.append((letter, body))
    return fixed


def dump_units(f, pages=None):
    doc = pymupdf.open(f)
    for i in (pages or range(len(doc))):
        print(f'===PAGE {i+1}===')
        for y, xmin, xmax, t in units(doc, i):
            print(f'{y:4d} {xmin:6.0f}-{xmax:6.0f} | {t}')


if __name__ == '__main__':
    dump_units(sys.argv[1], [int(p) - 1 for p in sys.argv[2].split(',')] if len(sys.argv) > 2 else None)
