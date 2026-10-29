import sys, re, json
import paths  # noqa: F401  (repo-relative sys.path setup)
import pymupdf
import build as B
from pdfbase import units as raw_units, split_markers

LETTERS = 'أبجد'
SP = re.compile(r'\s+')


def norm(s):
    s = SP.sub(' ', s or '').strip()
    return s


# ---------------- ACC: MCQ via column assignment
def parse_acc_mcq():
    doc = pymupdf.open(B.ACC)
    qs = []
    cur = None
    last = 0
    started = False
    for pno in range(2, len(doc)):
        for y, xmin, xmax, text in raw_units(doc, pno):
            if re.match(r'^السؤال الثاني', text):
                started = True
                continue
            if not started:
                continue
            m = re.match(r'^(\d{1,2})\s*-\s*(.*)$', text)
            if m:
                raw = m.group(1)
                for cand in (raw, raw[::-1]):
                    if cand.isdigit() and last < int(cand) <= last + 3:
                        last = int(cand)
                        cur = {'q': m.group(2), 'opts': {}, 'page': pno + 1, 'anch': {}}
                        qs.append(cur)
                        break
                else:
                    m = None
                if m:
                    continue
            if cur is None:
                continue
            for letter, body in split_markers(text):
                body = re.sub(r'^[\(\)\-–\s]+', '', body.strip())
                if letter:
                    cur['opts'][letter] = [body] if body else []
                    cur['anch'][letter] = xmax
                elif body:
                    if not cur['opts']:
                        cur['q'] = norm(cur['q'] + ' ' + body)
                    else:
                        k = min(cur['anch'], key=lambda k: abs(cur['anch'][k] - xmax))
                        cur['opts'][k].append(body)
    out = []
    for q in qs:
        opts = [norm(' '.join(q['opts'].get(k, []))) for k in LETTERS]
        out.append({'q': norm(q['q']), 'options': opts, 'page': q['page']})
    return out


if __name__ == '__main__':
    acc = parse_acc_mcq()
    print('ACC MCQ', len(acc))
    for i, q in enumerate(acc, 1):
        print(i, '::', q['q'][:70])
        for j, o in enumerate(q['options']):
            print('    ', LETTERS[j], o)
