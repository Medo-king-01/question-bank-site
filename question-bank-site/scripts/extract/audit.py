# -*- coding: utf-8 -*-
"""Sanity audit for src/data.json -- run after make_data.py.

    python3 scripts/extract/audit.py

Prints one line per problem class; a clean run ends with "OK".
"""
import json
import re

import paths

PATH = paths.DATA
data = json.load(open(PATH, encoding='utf-8'))

problems = []


def add(kind, where, detail):
    problems.append((kind, where, detail))


total = 0
for c in data:
    for s in c['sections']:
        for i, q in enumerate(s['questions'], 1):
            total += 1
            where = '%s/%s#%d' % (c['id'], s['id'], i)
            stem = q.get('q') or ''
            opts = q.get('options') or []
            note = q.get('note') or ''

            if not stem.strip():
                add('EMPTY_STEM', where, '')
            if q.get('ans') is None:
                add('NO_ANS', where, stem[:50])
            if s['type'] == 'mcq':
                if len(opts) < 2:
                    add('FEW_OPTS', where, stem[:50])
                if any(not o.strip() for o in opts):
                    add('EMPTY_OPT', where, stem[:50])
                if len(set(opts)) != len(opts):
                    add('DUP_OPT', where, ' | '.join(opts))
                if q['ans'] is not None and not (0 <= q['ans'] < len(opts)):
                    add('ANS_RANGE', where, stem[:50])
            else:
                if len(opts):
                    add('TF_WITH_OPTS', where, '')
            for txt in [stem] + opts + [note]:
                if txt.count('(') != txt.count(')'):
                    add('PAREN', where, txt[:70])
                if re.search(r'(?<![\u0621-\u064a])ال (?=[\u0621-\u064a])', txt):
                    add('AL_SPLIT', where, txt[:70])
                if re.search(r'شكل\s*\(?\d\s*\.$', txt):
                    add('FIG_JUNK', where, txt[:70])
                if re.search(r'\s\d{1,2}\s\d{1,4}\s', txt) and s['type'] == 'tf':
                    add('DOUBLE_NUM', where, txt[:70])

print('courses :', len(data))
print('questions:', total)
for c in data:
    n = sum(len(s['questions']) for s in c['sections'])
    print('   %-8s %-28s %4d  (%d sections)' % (c['id'], c['title'], n, len(c['sections'])))

if problems:
    for kind in sorted({p[0] for p in problems}):
        rows = [p for p in problems if p[0] == kind]
        print('\n== %s (%d)' % (kind, len(rows)))
        for k, where, detail in rows[:10]:
            print('   %-24s %s' % (where, detail))
else:
    print('\nOK — no structural problems found')
