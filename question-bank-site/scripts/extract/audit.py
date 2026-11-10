# -*- coding: utf-8 -*-
"""Quality audit for src/data.json -- run after make_data.py (or after hand edits).

    python3 scripts/extract/audit.py              # report + exit 1 on problems
    python3 scripts/extract/audit.py --strict     # also enable advisory checks

Prints one line per problem class; a clean run ends with "OK".

Exit codes: 0 = clean, 1 = problems found.
"""
import argparse
import html
import json
import re
import sys

import paths

PATH = paths.DATA

# --------------------------------------------------------------------------- #
# Limits. Structural checks are errors; length/format ones are warnings.
# --------------------------------------------------------------------------- #
MAX_STEM_LEN = 600
MAX_OPT_LEN = 300
MAX_NOTE_LEN = 1200
MAX_OPTIONS = 6
MIN_OPTIONS = 2

# Arabic block + common punctuation + digits + latin + math/technical symbols
# that legitimately appear in the question bank.
ALLOWED_CONTROL = set('\n\r\t')

# A real markup tag: '<' + optional '/' + name + optional attributes + '>'.
# Requiring the closing '>' keeps mathematical comparisons such as
# "طالما 10 < i" from being flagged as markup.
TAG_RE = re.compile(r'<\s*/?\s*([a-zA-Z][a-zA-Z0-9]*)\b[^<>]*>')
HTML_ENTITY_RE = re.compile(r'&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);')
DANGEROUS_TAG_RE = re.compile(r'<\s*(script|iframe|object|embed|style|link|meta|form|input|svg)\b', re.I)


def load(path):
    with open(path, encoding='utf-8') as fh:
        return json.load(fh)


def main(argv=None):
    parser = argparse.ArgumentParser(description='Audit the question bank data')
    parser.add_argument('--strict', action='store_true',
                        help='treat advisory warnings as failures too')
    args = parser.parse_args(argv)

    data = load(PATH)

    problems = []   # structural: always fail
    warnings = []   # advisory: fail only with --strict

    def add(kind, where, detail):
        problems.append((kind, where, detail))

    def warn(kind, where, detail):
        warnings.append((kind, where, detail))

    # ------------------------------------------------------------------ #
    # Top-level shape
    # ------------------------------------------------------------------ #
    if not isinstance(data, list):
        add('BAD_ROOT', '-', 'data.json root must be a list of courses')
        return report(data, problems, warnings, args.strict)

    if not data:
        add('EMPTY_ROOT', '-', 'no courses found')

    course_ids = set()
    section_ids = set()          # course/section global uniqueness
    total = 0
    seen_ids = {}
    counts = {'mcq': 0, 'tf': 0, 'note': 0, 'fig': 0}

    for ci, c in enumerate(data):
        cwhere = 'course[%d]' % ci
        if not isinstance(c, dict):
            add('BAD_COURSE', cwhere, 'course must be an object')
            continue
        for field in ('id', 'title'):
            if not isinstance(c.get(field), str) or not c[field].strip():
                add('MISSING_FIELD', cwhere, 'course.%s' % field)
        cid = c.get('id')
        if isinstance(cid, str):
            if cid in course_ids:
                add('DUPLICATE_COURSE_ID', cid, '')
            course_ids.add(cid)

        sections = c.get('sections')
        if not isinstance(sections, list) or not sections:
            add('NO_SECTIONS', cid or cwhere, '')
            continue

        for si, s in enumerate(sections):
            swhere = '%s/section[%d]' % (cid, si)
            if not isinstance(s, dict):
                add('BAD_SECTION', swhere, 'section must be an object')
                continue
            for field in ('id', 'title', 'type'):
                if not isinstance(s.get(field), str) or not s[field].strip():
                    add('MISSING_FIELD', swhere, 'section.%s' % field)
            stype = s.get('type')
            if stype not in ('mcq', 'tf'):
                add('BAD_TYPE', swhere, 'type=%r (expected "mcq" or "tf")' % (stype,))
            sid = s.get('id')
            if isinstance(sid, str):
                key = '%s/%s' % (cid, sid)
                if key in section_ids:
                    add('DUPLICATE_SECTION_ID', key, '')
                section_ids.add(key)
            expected_sec_prefix = '%s-%s-' % (cid, sid)
            questions = s.get('questions')
            if not isinstance(questions, list):
                add('NO_QUESTIONS', swhere, 'questions must be a list')
                continue
            if not questions:
                add('EMPTY_SECTION', swhere, 'section has no questions')

            for qi, q in enumerate(questions, 1):
                total += 1
                qwhere = '%s/%s#%d' % (cid, sid, qi)
                if not isinstance(q, dict):
                    add('BAD_QUESTION', qwhere, 'question must be an object')
                    continue

                stem = q.get('q')
                stem = stem if isinstance(stem, str) else ''
                note = q.get('note') or ''
                note = note if isinstance(note, str) else ''
                opts = q.get('options') or []
                ans = q.get('ans')

                # ---------------- id ----------------
                qid = q.get('id')
                if not isinstance(qid, str) or not qid.strip():
                    add('MISSING_ID', qwhere, stem[:50])
                else:
                    if qid in seen_ids:
                        add('DUPLICATE_ID', qwhere, '%s (also at %s)' % (qid, seen_ids[qid]))
                    else:
                        seen_ids[qid] = qwhere
                    if not qid.startswith(expected_sec_prefix):
                        warn('ID_PREFIX', qwhere, '%s (expected prefix %r)' % (qid, expected_sec_prefix))

                # ---------------- stem ----------------
                if not stem.strip():
                    add('EMPTY_STEM', qwhere, '')
                elif len(stem) > MAX_STEM_LEN:
                    warn('LONG_STEM', qwhere, '%d chars' % len(stem))

                # ---------------- answer ----------------
                if ans is None:
                    add('NO_ANS', qwhere, stem[:50])

                # ---------------- per-type ----------------
                if stype == 'mcq':
                    counts['mcq'] += 1
                    if not isinstance(opts, list):
                        add('BAD_OPTIONS', qwhere, 'options must be a list')
                        opts = []
                    if len(opts) < MIN_OPTIONS:
                        add('FEW_OPTS', qwhere, '%d options' % len(opts))
                    if len(opts) > MAX_OPTIONS:
                        warn('MANY_OPTS', qwhere, '%d options' % len(opts))
                    if any(not isinstance(o, str) or not o.strip() for o in opts):
                        add('EMPTY_OPT', qwhere, stem[:50])
                    strs = [o for o in opts if isinstance(o, str)]
                    if len(set(o.strip() for o in strs)) != len(strs):
                        add('DUP_OPT', qwhere, ' | '.join(o[:40] for o in strs))
                    if any(len(o) > MAX_OPT_LEN for o in strs):
                        warn('LONG_OPT', qwhere, stem[:50])
                    # answer must be an int in range
                    if ans is not None:
                        if not isinstance(ans, int) or isinstance(ans, bool):
                            add('ANS_TYPE', qwhere, 'mcq ans must be int, got %r' % (ans,))
                        elif not (0 <= ans < len(opts)):
                            add('ANS_RANGE', qwhere, 'ans=%r options=%d' % (ans, len(opts)))
                elif stype == 'tf':
                    counts['tf'] += 1
                    if opts:
                        add('TF_WITH_OPTS', qwhere, '%d options' % len(opts))
                    if ans is not None and not isinstance(ans, bool):
                        add('TF_ANS_TYPE', qwhere, 'tf ans must be bool, got %r' % (ans,))

                # ---------------- note / fig ----------------
                if note.strip():
                    counts['note'] += 1
                    if len(note) > MAX_NOTE_LEN:
                        warn('LONG_NOTE', qwhere, '%d chars' % len(note))
                fig = q.get('fig')
                if fig:
                    counts['fig'] += 1
                    if not isinstance(fig, str):
                        add('BAD_FIG', qwhere, 'fig must be a string key, got %r' % (fig,))

                # ---------------- text safety / hygiene ----------------
                texts = [('stem', stem)] + \
                        [('opt%d' % (n + 1), o) for n, o in enumerate(opts) if isinstance(o, str)] + \
                        [('note', note)]
                for label, txt in texts:
                    check_text(txt, label, qwhere, add, warn)

    return report(data, problems, warnings, args.strict,
                  total=total, counts=counts)


def check_text(txt, label, where, add, warn):
    """Untrusted-content checks. These guard the innerHTML rendering path."""
    if not txt:
        return

    # 1) Anything that looks like a markup tag.
    for m in TAG_RE.finditer(txt):
        add('HTML_TAG', where, '%s: <%s> in %r' % (label, m.group(1), txt[:60]))
        break

    # 2) Dangerous raw openings even without a closing '>'.
    if DANGEROUS_TAG_RE.search(txt):
        add('HTML_DANGEROUS', where, '%s: %r' % (label, txt[:60]))

    # 3) HTML entities that would be double-escaped or silently decoded.
    for m in HTML_ENTITY_RE.finditer(txt):
        add('HTML_ENTITY', where, '%s: &%s; in %r' % (label, m.group(1), txt[:60]))
        break

    # 4) Control characters (except tab/newline).
    bad_ctrl = [ch for ch in txt if ord(ch) < 32 and ch not in ALLOWED_CONTROL]
    if bad_ctrl:
        add('CTRL_CHAR', where, '%s: %r' % (label, [hex(ord(ch)) for ch in bad_ctrl[:3]]))

    # 5) Bidi control characters -- these can visually reorder text and are a
    #    classic spoofing vector. Data comes from PDFs so it is worth checking.
    bidi = [ch for ch in txt if ch in '\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069\u200e\u200f']
    if bidi:
        warn('BIDI_CHAR', where, '%s: %r' % (label, [hex(ord(ch)) for ch in bidi[:3]]))

    # 6) Existing hygiene checks.
    if txt.count('(') != txt.count(')'):
        add('PAREN', where, '%s: %r' % (label, txt[:70]))
    if re.search(r'(?<![\u0621-\u064a])ال (?=[\u0621-\u064a])', txt):
        add('AL_SPLIT', where, '%s: %r' % (label, txt[:70]))
    if re.search(r'شكل\s*\(?\d\s*\.$', txt):
        add('FIG_JUNK', where, '%s: %r' % (label, txt[:70]))
    if re.search(r'\s\d{1,2}\s\d{1,4}\s', txt):
        warn('DOUBLE_NUM', where, '%s: %r' % (label, txt[:70]))


def report(data, problems, warnings, strict=False, total=0, counts=None):
    counts = counts or {}
    print('courses :', len(data) if isinstance(data, list) else '?')
    print('questions:', total)
    if isinstance(data, list):
        for c in data:
            if not isinstance(c, dict):
                continue
            n = sum(len(s.get('questions') or [])
                    for s in (c.get('sections') or []) if isinstance(s, dict))
            print('   %-8s %-28s %4d  (%d sections)'
                  % (c.get('id', '?'), c.get('title', '?'), n, len(c.get('sections') or [])))
    if counts:
        print('types    : mcq=%(mcq)d tf=%(tf)d  note=%(note)d  fig=%(fig)d' % counts)

    for title, bucket in (('ERROR', problems), ('WARNING', warnings)):
        if not bucket:
            continue
        print()
        for kind in sorted({p[0] for p in bucket}):
            rows = [p for p in bucket if p[0] == kind]
            print('== %s %s (%d)' % (title, kind, len(rows)))
            for _, where, detail in rows[:10]:
                print('   %-24s %s' % (where, detail))
            if len(rows) > 10:
                print('   ... and %d more' % (len(rows) - 10))

    if problems:
        print('\nFAIL — %d structural problem(s), %d warning(s)' % (len(problems), len(warnings)))
        return 1
    if warnings and strict:
        print('\nFAIL (--strict) — %d warning(s)' % len(warnings))
        return 1
    suffix = ' (%d advisory warning(s) ignored; use --strict)' % len(warnings) if warnings else ''
    print('\nOK — no structural problems found' + suffix)
    return 0


if __name__ == '__main__':
    sys.exit(main())
