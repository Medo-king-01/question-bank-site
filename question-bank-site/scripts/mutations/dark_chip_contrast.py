"""Regress the dark-mode answer chip to the classic unreadable pair.

The bug this guards against: a pale fill with a near-white label. In light mode
the chip is a dark green / dark brick with off-white text, which is fine — but
if someone later lightens the fill for dark mode (as the old indigo theme did)
without flipping the text token too, the ✓ / ✕ label drops to roughly 1.1:1 and
effectively disappears. Nothing about the DOM would look wrong; only a contrast
check catches it.

The test suite must fail on this.
"""
from pathlib import Path

path = Path("src/app_template.html")
src = path.read_text(encoding="utf-8")

GOOD = "  --ok:#62c99a;   --ok-soft:#1e3329;   --ok-ink:var(--color-4);"
BAD = "  --ok:#e8f8f1;   --ok-soft:#1e3329;   --ok-ink:var(--color-5);"

if GOOD not in src:
    raise SystemExit("dark-mode --ok declaration not found; update this mutation")

path.write_text(src.replace(GOOD, BAD, 1), encoding="utf-8")
print("dark-mode answer chip regressed to a pale fill with a light label")
