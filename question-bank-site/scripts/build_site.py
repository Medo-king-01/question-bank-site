"""Build the self-contained single-file site:  <repo>/index.html

Reads  src/data.json  +  src/figures/fig{1,2,3,db1}_s.png , injects them into
src/app_template.html (as __DATA__ / __FIGS__) and writes index.html at the repo root.

    python3 scripts/build_site.py          # from anywhere
"""
import base64
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, 'src')
FIGS = os.path.join(SITE, 'figures')
OUT = os.path.join(ROOT, 'index.html')


def main():
    data = json.load(open(os.path.join(SITE, 'data.json'), encoding='utf-8'))
    n = 0
    for c in data:
        for s in c['sections']:
            for q in s['questions']:
                n += 1
                if s['type'] == 'mcq':
                    assert q.get('options') and q.get('ans') is not None, q
                    assert 0 <= q['ans'] < len(q['options']), q
                else:
                    assert q.get('ans') is not None, q
    figs = {}
    for k in ('1', '2', '3', 'db1'):
        p = os.path.join(FIGS, 'fig%s_s.png' % k)
        figs[k] = 'data:image/png;base64,' + base64.b64encode(open(p, 'rb').read()).decode()

    tpl = open(os.path.join(SITE, 'app_template.html'), encoding='utf-8').read()
    html = tpl.replace('__DATA__', json.dumps(data, ensure_ascii=False)).replace('__FIGS__', json.dumps(figs))
    out = OUT
    with open(out, 'w', encoding='utf-8') as f:
        f.write(html)
    print('wrote %s (%.0f KB) — %d courses, %d questions' % (out, os.path.getsize(out) / 1024, len(data), n))


if __name__ == '__main__':
    main()
