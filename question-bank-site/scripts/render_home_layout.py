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

    # page box: .wrap max-width 1080, padding 18/14/11 by breakpoint
    pad = 11 if width <= 380 else 14 if width <= 620 else 18
    content = min(width, 1080) - pad * 2

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

    gap = 1.0
    border = 1.0
    inner_w = content - border * 2
    col_w = (inner_w - gap * (cols - 1)) / cols

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
    st_pad_v = 3.0
    st_pad_h = 8.0
    f_st = load_font(max(9, int(clamp_fn(streak.get("font-size", "11.5px")))))
    streak_h = st_pad_v * 2 + f_st.size + 4
    margin_v = clamp_fn(streak.get("margin", "14px 20px").split()[0])
    margin_h = clamp_fn(streak.get("margin", "14px 20px").split()[-1])

    # ---- place items exactly as the real stylesheet says
    children = dom["children"]
    pinned = None
    if "grid-row" in streak:
        m = re.match(r"(\d+)", streak["grid-row"])
        pinned = int(m.group(1)) if m else None

    occupied, placed = set(), {}
    for i, ch in enumerate(children):
        if "hm-streak" in ch["cls"] and pinned is not None:
            for c in range(cols):
                occupied.add((pinned - 1, c))
            placed[i] = {"row": pinned - 1, "col": 0, "span": cols}

    r, c = 0, 0
    for i, ch in enumerate(children):
        if i in placed:
            continue
        span = cols if "hm-streak" in ch["cls"] else 1
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

    # ---- paint
    bg = hex_to_rgb(tok["--bg"])
    card = hex_to_rgb(tok["--card"])
    line = hex_to_rgb(tok["--line"])
    ink = hex_to_rgb(tok["--ink"])
    soft = hex_to_rgb(tok["--ink-soft"])
    urgent = hex_to_rgb(tok["--urgent"])
    urgent_soft = hex_to_rgb(tok["--urgent-soft"])
    accent = hex_to_rgb(tok["--accent"])

    rows = max(p["row"] for p in placed.values()) + 1
    grid_h = rows * stat_h + (rows - 1) * gap
    header = 74
    img = Image.new("RGB", (int(width), int(grid_h + header + 46)), bg)
    d = ImageDraw.Draw(img)

    label = f"{width}px  ·  {theme}  ·  {cols} columns"
    d.text((pad, 20), label, font=load_font(19), fill=ink)
    note = ("2x2 + badge below" if cols == 2 and rows == 3 else f"{rows} rows")
    d.text((pad, 45), note, font=load_font(14), fill=soft)

    top = header
    for i, ch in enumerate(children):
        p = placed[i]
        x0 = pad + border + p["col"] * (col_w + gap)
        y0 = top + border + p["row"] * (stat_h + gap)
        x1 = x0 + p["span"] * col_w + (p["span"] - 1) * gap
        y1 = y0 + stat_h

        if "hm-streak" in ch["cls"]:
            # the badge is an inline pill inside its grid area, not a full cell
            text = "7 يوم متصل"
            tw = d.textlength(text, font=f_st)
            bw = tw + st_pad_h * 2 + 14 + 6
            bx = x0 + margin_h if cols == 2 else x0 + margin_h
            by = y0 + (stat_h - streak_h) / 2
            d.rounded_rectangle([bx, by, bx + bw, by + streak_h], radius=streak_h / 2,
                                fill=urgent_soft, outline=urgent, width=1)
            d.text((bx + st_pad_h + 12, by + st_pad_v), text, font=f_st, fill=urgent)
            placed[i]["box"] = (bx, by, bx + bw, by + streak_h)
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
        placed[i]["box"] = (x0, y0, x1, y1)

    # grid separators, drawn from the real 1px gap/border
    d.rectangle([pad, top, pad + content, top + grid_h + border * 2], outline=line, width=1)

    # ---- overlap audit, computed not eyeballed
    boxes = [(i, placed[i]["box"]) for i in placed]
    collisions = []
    for a in range(len(boxes)):
        for b in range(a + 1, len(boxes)):
            ax0, ay0, ax1, ay1 = boxes[a][1]
            bx0, by0, bx1, by1 = boxes[b][1]
            if ax0 < bx1 and bx0 < ax1 and ay0 < by1 and by0 < ay1:
                collisions.append((children[boxes[a][0]]["cls"],
                                   children[boxes[b][0]]["cls"]))
    stats_boxes = [placed[i]["box"] for i, ch in enumerate(children)
                   if "hm-stat" in ch["cls"]]
    streak_box = next(placed[i]["box"] for i, ch in enumerate(children)
                      if "hm-streak" in ch["cls"])
    streak_below = all(streak_box[1] >= sb[3] - 0.5 for sb in stats_boxes)

    img.save(f"{ROOT}/docs/screenshots/{out}")
    return {
        "width": width, "theme": theme, "columns": cols, "rows": rows,
        "collisions": collisions,
        "streak_below_all_stats": streak_below,
        "badge": [round(v) for v in streak_box],
        "stats": [[round(v) for v in b] for b in stats_boxes],
        "contrast_badge": round(contrast(urgent, urgent_soft), 2),
        "contrast_number": round(contrast(ink, card), 2),
        "image": f"docs/screenshots/{out}",
    }


if __name__ == "__main__":
    os.makedirs(f"{ROOT}/docs/screenshots", exist_ok=True)
    cases = [(1440, "light"), (768, "light"), (390, "light"),
             (768, "dark"), (390, "dark")]
    results = [render(w, t, f"home-progress-{w}-{t}.png") for w, t in cases]
    print(json.dumps(results, indent=1, ensure_ascii=False))
