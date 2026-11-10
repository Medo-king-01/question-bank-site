"""Build the self-contained single-file site:  <repo>/index.html

Reads  src/data.json  +  src/figures/fig{1,2,3,db1}_s.png , injects them into
src/app_template.html (as __DATA__ / __FIGS__) and writes index.html at the repo root.

    python3 scripts/build_site.py          # from anywhere
"""
import base64
import hashlib
import json
import os
import shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, 'src')
FIGS = os.path.join(SITE, 'figures')
OUT = os.path.join(ROOT, 'index.html')
PWA = os.path.join(SITE, 'pwa')
MANIFEST = os.path.join(ROOT, 'manifest.json')
SW = os.path.join(ROOT, 'sw.js')


def main():
    data = json.load(open(os.path.join(SITE, 'data.json'), encoding='utf-8'))
    n = 0
    seen_ids = set()
    for c in data:
        for s in c['sections']:
            for q in s['questions']:
                qid = q.get('id')
                assert isinstance(qid, str) and qid and qid not in seen_ids, ('missing/duplicate question id', c['id'], s['id'], q.get('q', '')[:60])
                seen_ids.add(qid)
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
    html = tpl.replace('__DATA__', json.dumps(data, ensure_ascii=False, separators=(',', ':'))).replace('__FIGS__', json.dumps(figs, separators=(',', ':')))
    out = OUT
    with open(out, 'w', encoding='utf-8') as f:
        f.write(html)
    print('wrote %s (%.0f KB) — %d courses, %d questions' % (out, os.path.getsize(out) / 1024, len(data), n))

    # --- PWA: manifest + service worker must sit NEXT TO index.html ----------
    # A service worker only controls pages inside its own directory, so sw.js
    # cannot live under src/. The manifest lives at the root too, and its icon
    # paths point back into src/pwa/ which Pages already publishes.
    man = json.load(open(os.path.join(PWA, 'manifest.json'), encoding='utf-8'))
    for icon in man['icons']:
        assert os.path.exists(os.path.join(SITE, '..', icon['src'])), ('manifest icon missing', icon['src'])
    shutil.copyfile(os.path.join(PWA, 'manifest.json'), MANIFEST)

    # The cache name is derived from the *content* of the build, so editing a
    # question or the app shell produces a new cache and the old one is dropped
    # on activate. Same input -> same id, which keeps the build deterministic.
    build_id = hashlib.sha256(html.encode('utf-8')).hexdigest()[:12]
    sw = open(os.path.join(PWA, 'sw.js'), encoding='utf-8').read()
    assert sw.count('__BUILD_ID__') == 1, 'sw.js must contain exactly one __BUILD_ID__ placeholder'
    with open(SW, 'w', encoding='utf-8') as f:
        f.write(sw.replace('__BUILD_ID__', build_id))
    print('copied manifest.json + sw.js (build id %s)' % build_id)


if __name__ == '__main__':
    main()
