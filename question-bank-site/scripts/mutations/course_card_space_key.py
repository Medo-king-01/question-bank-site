"""Regress the course card so Space navigates but does not cancel scrolling.

The bug this guards against: a card that answers the Space key but forgets
preventDefault(). It still opens the course, so every DOM assertion passes --
the damage is that the browser also scrolls the page, leaving the student
halfway down the course screen. Only a test that inspects defaultPrevented on
the dispatched event can catch it.

The test suite must fail on this.
"""
from pathlib import Path

path = Path("src/app_template.html")
src = path.read_text(encoding="utf-8")

GOOD = """      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        openCourse(card.dataset.course);"""

BAD = """      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        openCourse(card.dataset.course);"""

if GOOD not in src:
    raise SystemExit("course-card keydown handler changed; update this mutation")

path.write_text(src.replace(GOOD, BAD, 1), encoding="utf-8")
print("course card no longer cancels the Space key default")
