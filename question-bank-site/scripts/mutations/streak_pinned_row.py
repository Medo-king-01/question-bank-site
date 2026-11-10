"""Pin the streak badge back to row 2 so the 2x2 progress block breaks.

The bug this guards against is subtle and only shows up at two columns:

    .hm-streak{grid-column:1/-1;grid-row:2}

An explicitly positioned grid item is placed *before* auto-placement runs, so
the streak claims all of row 2. The four statistics then fill row 1, and the
third one cannot complete the 2x2, so it spills to row 3 on its own. The page
still looks plausible -- which is why nothing but a layout assertion catches it.

The test suite must fail on this.
"""
from pathlib import Path

path = Path("src/app_template.html")
src = path.read_text(encoding="utf-8")

GOOD = ".hm-streak{\n  grid-column:1/-1;\n"
BAD = ".hm-streak{\n  grid-column:1/-1;grid-row:2;\n"

if GOOD not in src:
    raise SystemExit("the .hm-streak rule changed; update this mutation")

path.write_text(src.replace(GOOD, BAD, 1), encoding="utf-8")
print("streak pinned back to row 2")
