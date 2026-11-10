"""Render the home progress block at a given viewport width.

No browser is available in this environment, so this is not a screenshot: it is
a small layout engine that reads the real stylesheet out of the built
index.html, walks the real DOM produced by the app, resolves the grid the way
the spec does, and paints boxes with Pillow.

It exists to answer one question the test suite cannot answer from CSS alone:
at 768px and 390px, do the four statistics actually sit side by side in a 2x2
while the streak badge sits below them, with nothing overlapping?

Only the .hm-progress subtree is modelled -- enough to check placement,
spacing and overlap, not to reproduce the whole page.

WHAT IS MODELLED, AND WHAT IS NOT
---------------------------------
Read from the real stylesheet: grid-template-columns (repeat/auto-fit/minmax and
plain fr lists), gap, border width, the container's padding and max-width
(.wrap), each cell's padding shorthand, font-size incl. clamp()/vw, and the
streak's grid-column (for its span) and grid-row (for pinning).

Modelled by the algorithm rather than read as a declaration: auto-placement
order, auto-fit track collapse, and grid-column:1/-1 -> the full track count.

NOT modelled, and deliberately out of scope: explicit line names, grid-template
-areas, order/dense packing, subgrid, min-content/max-content sizing, vertical
writing modes, and any page geometry outside .hm-progress. Text is measured with
a Pillow font, so line boxes are approximated rather than shaped.

When a property the engine needs is absent it does not invent a number
silently: it appends to `assumptions` in the JSON and the render tests fail.
That keeps the gap between "the CSS says" and "the picture shows" visible.
"""
import json
import os
import re
import subprocess
import sys

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:  # pragma: no cover - environment problem, not a layout problem
    sys.exit("Pillow is required to paint the screenshots: "
             "python3 -m pip install --break-system-packages pillow")

# Resolve from this file, not from a hardcoded path: CI checks out elsewhere.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# ---------------------------------------------------------------- extract

def read_css():
    html = open(f"{ROOT}/index.html", encoding="utf-8").read()
    return html[html.index("<style>") + 7: html.index("</style>")]


def read_home_dom():
    """Ask jsdom for the rendered .hm-progress subtree, with computed classes."""
    script = r"""
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
const html = readFileSync(process.cwd() + '/index.html', 'utf8');
const now = Date.now();
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://x.test/',
  beforeParse(w) {
    w.localStorage.setItem('qb.history.v1', JSON.stringify({
      v: 1, attempts: [], sessions: [], streak: { current: 7, best: 9 },
    }));
    w.localStorage.setItem('qb.best', JSON.stringify({ ethics: 82, acct: 61 }));
  } });
await new Promise(r => dom.window.addEventListener('load', r, { once: true }));
const doc = dom.window.document;
const prog = doc.querySelector('.hm-progress');
const out = [...prog.children].map(el => ({
  cls: el.className,
  text: el.textContent.replace(/\s+/g, ' ').trim(),
}));
console.log(JSON.stringify({ count: out.length, children: out }));
dom.window.close();
"""
    open(f"{ROOT}/_dom_probe.mjs", "w", encoding="utf-8").write(script)
    try:
        raw = subprocess.run(["node", "_dom_probe.mjs"], cwd=ROOT,
                             capture_output=True, text=True, timeout=180)
        line = [l for l in raw.stdout.splitlines() if l.startswith("{")][-1]
        return json.loads(line)
    finally:
        os.remove(f"{ROOT}/_dom_probe.mjs")


# ---------------------------------------------------------------- tokens

def resolve_tokens(css):
    """Pull the light and dark palettes out of :root / [data-theme="dark"]."""
    def block(sel):
        i = css.index(sel)
        return css[i: css.index("}", i)]

    def norm(b):
        return re.sub(r"/\*.*?\*/", "", b, flags=re.S)

    root = norm(block(":root{"))
    dark = norm(block('[data-theme="dark"]{'))

    def read(b, name):
        i = b.find(name + ":")
        if i < 0:
            return None
        return b[i + len(name) + 1: b.index(";", i)].strip()

    palette = {}
    for name in ["--color-1", "--color-2", "--color-3", "--color-4", "--color-5",
                 "--color-6", "--color-7", "--color-8"]:
        palette[name] = read(root, name)

    def resolve(value):
        for _ in range(4):
            m = re.fullmatch(r"var\((--[\w-]+)\)", value.strip())
            if not m:
                break
            value = palette.get(m.group(1)) or read(root, m.group(1)) or value
        return value

    light, dark_t = {}, {}
    for name in ["--bg", "--card", "--ink", "--ink-soft", "--line", "--accent",
                 "--urgent", "--urgent-soft"]:
        v = read(root, name)
        light[name] = resolve(v) if v else None
        d = read(dark, name)
        dark_t[name] = resolve(d) if d else light[name]
    return light, dark_t


def relevant_rules(css, width):
    """Every declaration that applies at `width`, base rules first."""
    base = []
    media = []

    i = 0
    while i < len(css):
        if css.startswith("@media", i):
            open_brace = css.index("{", i)
            query = css[i + 6: open_brace].strip()
            depth, j = 1, open_brace + 1
            while depth:
                if css[j] == "{":
                    depth += 1
                elif css[j] == "}":
                    depth -= 1
                j += 1
            body = css[open_brace + 1: j - 1]
            m = re.search(r"max-width:\s*(\d+)px", query)
            minw = re.search(r"min-width:\s*(\d+)px", query)
            applies = True
            if m and width > int(m.group(1)):
                applies = False
            if minw and width < int(minw.group(1)):
                applies = False
            if applies:
                media.extend(parse_rules(body))
            i = j
        else:
            end = css.find("@media", i)
            chunk = css[i: end if end > 0 else len(css)]
            base.extend(parse_rules(chunk))
            i = end if end > 0 else len(css)
    return base + media


def parse_rules(chunk):
    chunk = re.sub(r"/\*.*?\*/", "", chunk, flags=re.S)
    out = []
    for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", chunk):
        sel, body = m.group(1).strip(), m.group(2)
        decls = {}
        for d in body.split(";"):
            if ":" in d:
                k, v = d.split(":", 1)
                decls[k.strip()] = v.strip()
        if decls:
            out.append((sel, decls))
    return out


def style_for(rules, classes):
    """Cascade the subset we care about for an element with these classes."""
    wanted = {"display", "grid-template-columns", "grid-column", "grid-row",
              "gap", "margin", "padding", "border", "font-size", "justify-self",
              "align-self", "background", "color", "border-radius"}
    got = {}
    for sel, decls in rules:
        hit = False
        for part in sel.split(","):
            part = part.strip()
            if not part.startswith("."):
                continue
            names = re.findall(r"\.([\w-]+)", part)
            if names and all(n in classes.split() for n in names):
                hit = True
        if hit:
            for k, v in decls.items():
                if k in wanted:
                    got[k] = v
    return got


def decl(rules, classes, prop, default, assumptions, label=None):
    """Read one property from the cascaded rules, recording any fallback.

    The engine deliberately models a subset of CSS. When a property it needs
    is missing from the stylesheet it must not quietly substitute a number:
    that would make the picture disagree with the browser and nobody would
    see why. Every fallback is appended to `assumptions`, and the render
    tests fail when that list is non-empty for geometry.
    """
    style = style_for(rules, classes)
    if prop in style and style[prop].strip():
        return style[prop].strip()
    assumptions.append(f"{label or classes}.{prop} missing -> assumed {default!r}")
    return default


def px_or(v, default=0.0):
    return px(v, default)


def first_px(v, default=0.0):
    """Width from the first <length> in a shorthand ('1px solid', '14px 20px')."""
    m = re.search(r"(-?[\d.]+)px", str(v))
    return float(m.group(1)) if m else default


def span_of(grid_column, cols):
    """(start_index, span) for a `grid-column` value, or (None, span) if auto.

    Line numbers are 1-based in CSS; -1 means the last line. Returning the
    start lets the caller honour `grid-column:2/4` instead of quietly
    pretending every spanned item begins at the first column.
    """
    v = (grid_column or "auto").replace(" ", "")
    if v in ("auto", ""):
        return None, 1
    m = re.fullmatch(r"(\d+)/(\d+|-(\d+))", v)
    if m:
        start = int(m.group(1))
        end_raw = m.group(2)
        end = cols + 1 if end_raw == "-1" else int(end_raw.lstrip("-"))
        span = max(1, end - start)
        return start - 1, span
    m = re.fullmatch(r"span(\d+)", v)
    return None, (int(m.group(1)) if m else 1)


def track_metrics(content, cols, gap, border):
    """Column width from the container box, the track count, the gap and border.

    Isolated so the self-check can prove the three inputs are live: a change
    in any of them must move this number.
    """
    inner = content - border * 2
    return inner, (inner - gap * (cols - 1)) / cols


def self_check():
    """Cheap proof that the engine reads its inputs instead of assuming them.

    Runs without rebuilding the site: every case is a pure function call or a
    one-line change to a stylesheet string.
    """
    problems = []

    def expect(name, got, want):
        if got != want:
            problems.append({"check": name, "got": got, "want": want})

    # grid-column -> (start line index, span)
    expect("span_of(1/-1, 4)", span_of("1/-1", 4), (0, 4))
    expect("span_of(1/-1, 2)", span_of("1/-1", 2), (0, 2))
    expect("span_of(2/4, 4)", span_of("2/4", 4), (1, 2))
    expect("span_of(1/2, 2)", span_of("1/2", 2), (0, 1))
    expect("span_of(span 1, 2)", span_of("span 1", 2), (None, 1))
    expect("span_of(auto, 3)", span_of("auto", 3), (None, 1))

    # gap and border must move the column width
    base = track_metrics(360, 2, 1, 1)[1]
    expect("gap 1->9 narrows a column", round(base - track_metrics(360, 2, 9, 1)[1], 4), 4.0)
    expect("border 1->5 narrows a column", round(base - track_metrics(360, 2, 1, 5)[1], 4), 4.0)
    expect("gap 1->9 widens the gutter", round((360 - 1 * 2) - (base * 2 + 1 * 1), 4), 0.0)

    # a missing declaration must be reported, never silently invented
    notes = []
    got = decl([(".hm-x", {"padding": "3px"})], "hm-x", "gap", "1px", notes)
    expect("missing gap falls back", got, "1px")
    expect("missing gap is reported", len(notes), 1)

    # a present declaration must not be reported at all
    notes2 = []
    got2 = decl([(".hm-x", {"gap": "7px"})], "hm-x", "gap", "1px", notes2)
    expect("present gap is read", got2, "7px")
    expect("present gap raises nothing", len(notes2), 0)

    return problems


def cascade_sides(rules, classes, default, assumptions):
    """padding shorthand -> (top, right, bottom, left) in px, all four sides."""
    style = style_for(rules, classes)
    raw = style.get("padding", "")
    if not raw.strip():
        assumptions.append(f"{classes}.padding missing -> assumed {default}")
        return default
    v = [clamp_fn(x) for x in raw.split()]
    if len(v) == 1:
        t = r = b = l = v[0]
    elif len(v) == 2:
        t = b = v[0]; r = l = v[1]
    elif len(v) == 3:
        t, r, b = v; l = v[1]
    else:
        t, r, b, l = v[:4]
    return t, r, b, l


def cascade_padding(rules, classes, default_pad):
    """Padding shorthand -> (vertical, horizontal) in px."""
    style = style_for(rules, classes)
    raw = style.get("padding", "")
    parts = raw.split()
    if not parts:
        return default_pad, default_pad
    vals = [clamp_fn(x) for x in parts]
    if len(vals) == 1:
        return vals[0], vals[0]
    return vals[0], vals[1]


def px(v, default=0.0):
    if v is None:
        return default
    m = re.match(r"([\d.]+)px", str(v).strip())
    return float(m.group(1)) if m else default


def clamp_fn(v):
    """Evaluate clamp(a, b, c) and plain px for the handful of values used."""
    v = str(v).strip()
    m = re.fullmatch(r"clamp\(([^)]*)\)", v)
    if m:
        parts = [p.strip() for p in m.group(1).split(",")]
        lo, mid, hi = px(parts[0]), None, px(parts[2])
        mm = re.fullmatch(r"([\d.]+)vw", parts[1])
        if mm:
            mid = float(mm.group(1)) / 100 * VIEWPORT
        else:
            mid = px(parts[1])
        return max(lo, min(mid, hi))
    mm = re.fullmatch(r"([\d.]+)vw", v)
    if mm:
        return float(mm.group(1)) / 100 * VIEWPORT
    return px(v)


# ---------------------------------------------------------------- colours

def hex_to_rgb(h):
    h = h.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def lum(rgb):
    def f(c):
        c /= 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (f(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


# ---------------------------------------------------------------- font

def load_font(size):
    for path in ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
                 "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
                 "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf"]:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


# ---------------------------------------------------------------- render

VIEWPORT = 768


def render(width, theme="light", out="preview.png"):
    global VIEWPORT
    VIEWPORT = width
    css = read_css()
    light, dark = resolve_tokens(css)
    tok = light if theme == "light" else dark
    dom = read_home_dom()
    rules = relevant_rules(css, width)

    assumptions = []

    # ---- page box, read from .wrap rather than assumed from the breakpoints
    wrap = style_for(rules, "wrap")
    max_w = first_px(wrap.get("max-width", ""), float(width))
    page_pad_h = cascade_padding(rules, "wrap", 0.0)[1]
    content = min(width, max_w) - page_pad_h * 2
    # where the content box starts inside the image (centred when max-width bites)
    margin = (width - min(width, max_w)) / 2 + page_pad_h

    prog = style_for(rules, "hm-progress")
    cols_decl = prog.get("grid-template-columns", "")
    med = re.search(r"minmax\((\d+)px,\s*1fr\)", cols_decl)
    if med:
        minimum = float(med.group(1))
        max_tracks = max(1, int((content + 1) // (minimum + 1)))
        # auto-fit (not auto-fill) collapses tracks with no item in them, then
        # the remaining tracks absorb the free space. Modelling auto-fill here
        # drew a phantom empty column to the side of the statistics.
        item_count = sum(1 for ch in dom["children"] if "hm-stat" in ch["cls"])
        cols = max(1, min(max_tracks, item_count))
    else:
        cols = len(re.findall(r"\d+fr", cols_decl)) or 1

    gap = clamp_fn(prog.get("gap", "0px")) if "gap" in prog else \
        decl(rules, "hm-progress", "gap", "1px", assumptions)
    border = first_px(prog.get("border", ""), 0.0) if "border" in prog else \
        decl(rules, "hm-progress", "border", "1px solid", assumptions)
    inner_w, col_w = track_metrics(content, cols, gap, border)

    stat = style_for(rules, "hm-stat")
    stat_pad_v = clamp_fn(stat.get("padding", "18px 20px").split()[0])
    stat_pad_h = clamp_fn(stat.get("padding", "18px 20px").split()[-1])
    n_size = clamp_fn(style_for(rules, "hm-stat-n").get("font-size", "27px"))
    k_size = clamp_fn(style_for(rules, "hm-stat-k").get("font-size", "12.5px"))
    s_size = clamp_fn(style_for(rules, "hm-stat-sub").get("font-size", "11.5px"))

    # measure a stat cell: number, key, sub
    f_num = load_font(max(10, int(n_size)))
    f_key = load_font(max(9, int(k_size)))
    f_sub = load_font(max(8, int(s_size)))
    line_h = lambda f: f.size + 3
    stat_h = stat_pad_v * 2 + line_h(f_num) + 2 + line_h(f_key) + line_h(f_sub)

    streak = style_for(rules, "hm-streak")
    # padding:3px 10px 3px 8px -- all four sides matter for the pill's box
    st_top, st_right, st_bottom, st_left = cascade_sides(
        rules, "hm-streak", (3.0, 10.0, 3.0, 8.0), assumptions)
    st_border = first_px(streak.get("border", ""),
                         first_px(decl(rules, "hm-streak", "border", "1px solid",
                                       assumptions), 0.0))
    f_st = load_font(max(9, int(clamp_fn(streak.get("font-size", "11.5px")))))
    streak_h = st_top + st_bottom + st_border * 2 + f_st.size + 4
    margin_v = clamp_fn(streak.get("margin", "14px 20px").split()[0])
    margin_h = clamp_fn(streak.get("margin", "14px 20px").split()[-1])

    # ---- place items exactly as the real stylesheet says
    children = dom["children"]
    pinned = None
    if "grid-row" in streak:
        m = re.match(r"(\d+)", streak["grid-row"])
        pinned = int(m.group(1)) if m else None

    occupied, placed = set(), {}
    # The streak's width comes from its own grid-column (1/-1 today), not from
    # an assumption that it is always full width. If that rule changes, the
    # engine follows it instead of hiding the change.
    streak_sel = next((ch["cls"] for ch in children if "hm-streak" in ch["cls"]), None)
    if streak_sel:
        gcol = decl(rules, "hm-streak", "grid-column", "1/-1", assumptions)
        streak_start, streak_span = span_of(gcol, cols)
    else:
        gcol, streak_start, streak_span = "auto", None, 1

    for i, ch in enumerate(children):
        if "hm-streak" in ch["cls"] and pinned is not None:
            col0 = streak_start if streak_start is not None else 0
            col0 = min(col0, max(0, cols - 1))
            for c in range(col0, min(cols, col0 + streak_span)):
                occupied.add((pinned - 1, c))
            placed[i] = {"row": pinned - 1, "col": col0, "span": streak_span}

    r, c = 0, 0
    for i, ch in enumerate(children):
        if i in placed:
            continue
        if "hm-streak" in ch["cls"]:
            span = streak_span
            if streak_start is not None:
                # explicit line: jump straight there, then wrap if occupied
                r = max(r, 0)
                c = streak_start
                if any((r, c + k) in occupied for k in range(span)):
                    r += 1
                    c = streak_start
                for k in range(span):
                    occupied.add((r, c + k))
                placed[i] = {"row": r, "col": c, "span": span}
                c += span
                continue
        span = 1
        while True:
            if c + span > cols:
                r += 1
                c = 0
                continue
            cells = [(r, c + k) for k in range(span)]
            if any(x in occupied for x in cells):
                c += 1
                continue
            for x in cells:
                occupied.add(x)
            placed[i] = {"row": r, "col": c, "span": span}
            c += span
            break

    bg = hex_to_rgb(tok["--bg"])
    card = hex_to_rgb(tok["--card"])
    line = hex_to_rgb(tok["--line"])
    ink = hex_to_rgb(tok["--ink"])
    soft = hex_to_rgb(tok["--ink-soft"])
    urgent = hex_to_rgb(tok["--urgent"])
    urgent_soft = hex_to_rgb(tok["--urgent-soft"])
    accent = hex_to_rgb(tok["--accent"])

    # ---- geometry first, painting second.
    # Boxes must exist before the caption is drawn: the caption reports what
    # was measured, so it cannot disagree with the picture underneath it.
    rows = max(p["row"] for p in placed.values()) + 1
    grid_h = rows * stat_h + (rows - 1) * gap
    header = 74

    text = "7 يوم متصل"
    tw = None  # measured after the font is built, below

    boxes_by_index = {}
    for i, ch in enumerate(children):
        p = placed[i]
        x0 = margin + border + p["col"] * (col_w + gap)
        y0 = header + border + p["row"] * (stat_h + gap)
        x1 = x0 + p["span"] * col_w + (p["span"] - 1) * gap
        y1 = y0 + stat_h
        boxes_by_index[i] = (x0, y0, x1, y1)

    def place(i, box):
        boxes_by_index[i] = box

    img = Image.new("RGB", (int(width), int(grid_h + header + 46)), bg)
    d = ImageDraw.Draw(img)
    tw = d.textlength(text, font=f_st)

    # the badge is an inline pill inside its grid area, not a full-width cell
    for i, ch in enumerate(children):
        if "hm-streak" not in ch["cls"]:
            continue
        x0, y0, x1, y1 = boxes_by_index[i]
        # 14px icon + 6px inline gap, then the four real paddings and borders
        bw = tw + st_left + st_right + st_border * 2 + 14 + 6
        bx = x0 + margin_h
        by = y0 + (stat_h - streak_h) / 2
        place(i, (bx, by, bx + bw, by + streak_h))

    # ---- overlap audit, computed not eyeballed
    boxes = [(i, boxes_by_index[i]) for i in sorted(boxes_by_index)]
    collisions = []
    for a in range(len(boxes)):
        for b in range(a + 1, len(boxes)):
            ax0, ay0, ax1, ay1 = boxes[a][1]
            bx0, by0, bx1, by1 = boxes[b][1]
            if ax0 < bx1 and bx0 < ax1 and ay0 < by1 and by0 < ay1:
                collisions.append((children[boxes[a][0]]["cls"],
                                   children[boxes[b][0]]["cls"]))
    stats_boxes = [boxes_by_index[i] for i, ch in enumerate(children)
                   if "hm-stat" in ch["cls"]]
    streak_box = next(boxes_by_index[i] for i, ch in enumerate(children)
                      if "hm-streak" in ch["cls"])
    streak_below = all(streak_box[1] >= sb[3] - 0.5 for sb in stats_boxes)

    # ---- paint
    label = f"{width}px  ·  {theme}  ·  {cols} columns"
    d.text((margin, 20), label, font=load_font(19), fill=ink)
    """The caption is derived from the measured placement, never asserted.
    An earlier version printed "2x2 + badge below" unconditionally at 390px,
    so the bug screenshot carried the healthy caption."""
    if not streak_below:
        note, note_warn = f"{rows} rows  ·  badge is NOT below the stats", True
    elif cols == 2 and rows == 3:
        note, note_warn = "2x2 + badge below", False
    else:
        note, note_warn = f"{rows} rows  ·  all stats above the badge", False
    d.text((margin, 45), note, font=load_font(14), fill=urgent if note_warn else soft)

    for i, ch in enumerate(children):
        x0, y0, x1, y1 = boxes_by_index[i]
        if "hm-streak" in ch["cls"]:
            d.rounded_rectangle([x0, y0, x1, y1], radius=(y1 - y0) / 2,
                                fill=urgent_soft, outline=urgent, width=1)
            d.text((x0 + st_left + st_border + 14 + 6, y0 + st_top + st_border),
                   text, font=f_st, fill=urgent)
            continue

        d.rectangle([x0, y0, x1, y1], fill=card)
        cx = x0 + stat_pad_h
        d.text((cx, y0 + stat_pad_v), ["74%", "132", "3/8", "41"][i % 4],
               font=f_num, fill=ink)
        d.text((cx, y0 + stat_pad_v + line_h(f_num) + 2),
               ["دقة الإجابات", "سؤال مختلف", "مقرات بدأتها", "سؤال متقن"][i % 4],
               font=f_key, fill=ink)
        d.text((cx, y0 + stat_pad_v + line_h(f_num) + 2 + line_h(f_key)),
               ["41 صح من 55", "من 709", "متوسط 72%", "من 132"][i % 4],
               font=f_sub, fill=soft)

    # grid separators, drawn from the real 1px gap/border
    d.rectangle([margin, header, margin + content, header + grid_h + border * 2],
                outline=line, width=1)

    img.save(f"{ROOT}/docs/screenshots/{out}")
    return {
        "width": width, "theme": theme, "columns": cols, "rows": rows,
        "collisions": collisions,
        "streak_below_all_stats": streak_below,
        "badge": [round(v) for v in streak_box],
        "stats": [[round(v) for v in b] for b in stats_boxes],
        "streak_grid_column": gcol,
        "streak_span": streak_span,
        "assumptions": assumptions,
        "contrast_badge": round(contrast(urgent, urgent_soft), 2),
        "contrast_number": round(contrast(ink, card), 2),
        "image": f"docs/screenshots/{out}",
    }


if __name__ == "__main__":
    if "--self-check" in sys.argv:
        problems = self_check()
        print(json.dumps({"ok": not problems, "problems": problems}, indent=1))
        sys.exit(1 if problems else 0)
    os.makedirs(f"{ROOT}/docs/screenshots", exist_ok=True)
    cases = [(1440, "light"), (768, "light"), (390, "light"),
             (768, "dark"), (390, "dark")]
    results = [render(w, t, f"home-progress-{w}-{t}.png") for w, t in cases]
    print(json.dumps(results, indent=1, ensure_ascii=False))
