import re, json, sys
import pymupdf
from pdfbase import units, build_maps, clean, split_markers

QPAT = re.compile(r'^(\d{1,3})\s*[-–.)]\s*(.*)$')
MPAT = re.compile(r'^([أبجد])\s*[\(\)\-–]\s*(.*)$')


def red_letter_sequence(doc, letters='أبجد'):
    seq = []
    for pno in range(len(doc)):
        maps = build_maps(doc, pno)
        spans = []
        for sp in doc[pno].get_texttrace():
            if sp['color'] != (1.0, 0.0, 0.0):
                continue
            mm = maps.get(sp['font'], {})
            chars = [(o[0], mm.get(g, ch if isinstance(ch, str) else '')) for ch, g, o, b in sp['chars']]
            if not chars:
                continue
            chars.sort(key=lambda t: -t[0])
            t = clean(''.join(c for _, c in chars))
            if t.strip():
                y = round((sp['bbox'][1] + sp['bbox'][3]) / 2)
                spans.append((y, max(x for x, _ in chars), t))
        groups, cur, cy = [], [], None
        for s in sorted(spans, key=lambda s: s[0]):
            if cy is None or abs(s[0] - cy) <= 5:
                cur.append(s); cy = s[0] if cy is None else cy
            else:
                groups.append(cur); cur = [s]; cy = s[0]
        if cur:
            groups.append(cur)
        for g in groups:
            g.sort(key=lambda s: -s[1])
            txt = re.sub(r'\s+', ' ', ''.join(s[2] for s in g)).strip()
            m = MPAT.match(txt)
            if m:
                seq.append([pno + 1, m.group(1), m.group(2)])
            elif seq:
                seq[-1][2] += ' ' + txt
    return seq


def parse_ethics(path):
    doc = pymupdf.open(path)
    qs = []
    cur = None
    last = 0
    for pno in range(len(doc)):
        for y, xmin, xmax, text in units(doc, pno):
            m = QPAT.match(text)
            if m:
                raw = m.group(1)
                cands = set()
                for v in (raw, raw[::-1]):
                    if v.isdigit():
                        cands.add(int(v))
                good = sorted(c for c in cands if last < c <= last + 6)
                if good:
                    last = min(good, key=lambda c: abs(c - (last + 1)))
                    cur = {'n': len(qs) + 1, 'q': m.group(2), 'opts': {}, 'page': pno + 1}
                    qs.append(cur)
                    continue
            if cur is None:
                continue
            for letter, body in split_markers(text):
                body = re.sub(r'\s+', ' ', body).strip()
                if letter:
                    cur['opts'][letter] = [body] if body else []
                else:
                    if not body:
                        continue
                    if not cur['opts']:
                        cur['q'] = (cur['q'] + ' ' + body).strip()
                    else:
                        k = list(cur['opts'])[-1]
                        cur['opts'][k].append(body)
    red = red_letter_sequence(doc)
    return qs, red


if __name__ == '__main__':
    qs, red = parse_ethics(paths.PDFS + '/بنك أسئلة الميدتيرم أخلاقيات الأعمال  والحوكمة .pdf')
    print('Q:', len(qs), 'red:', len(red))
    for q, r in zip(qs, red):
        print(f"{q['n']} [ans={r[1]}] {q['q']}")
        for k, v in q['opts'].items():
            print('     ', k, '→', ' '.join(v))
