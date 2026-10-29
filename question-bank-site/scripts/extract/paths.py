# -*- coding: utf-8 -*-
"""Project paths shared by the extraction scripts (all relative to the repo)."""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))          # scripts/extract
ROOT = os.path.dirname(os.path.dirname(HERE))              # repo root
PDFS = os.path.join(ROOT, 'pdfs')                          # source PDFs (not committed)
SRC = os.path.join(ROOT, 'src')                            # app_template.html + data.json + figures
DATA = os.path.join(SRC, 'data.json')

for p in (ROOT, HERE):
    if p not in sys.path:
        sys.path.insert(0, p)
