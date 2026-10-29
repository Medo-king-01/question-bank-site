import sys, re, json
import paths  # noqa: F401  (repo-relative sys.path setup)
import pymupdf
import layout
from files import ALL, ETH, INV, PRG, MAC, ACC, GOV
from pdfbase import build_maps, clean, split_markers

SP = re.compile(r'\s+')
LETTERS = 'أبجد'
GAPS = {'ethics': 8, 'invest': 8, 'prog': 2, 'macro': 8, 'acct': 6, 'gov': 8}


def norm(s):
    s = SP.sub(' ', s or '').strip()
    s = s.replace('( ', '(').replace(' )', ')')
    s = re.sub(r'\s+([،.:؟!])', r'\1', s)
    return s


def squash(s):
    return re.sub(r'[\s()\-–.:،\"\'؟]', '', s or '')


def get_lines(f, key):
    doc = pymupdf.open(f)
    out = []
    g = GAPS.get(key, 4)
    for pno in range(len(doc)):
        for t in layout.text_of(doc, pno, sep_gap=g):
            t = norm(t)
            if not t:
                continue
            if re.fullmatch(r'\d{1,3}', t) and pno is not None:
                # footer page number
                continue
            out.append((pno + 1, t))
    return out, doc


# ---------------------------------------------------------------- ETHICS
def parse_ethics():
    ls, doc = get_lines(ETH, 'ethics')
    mcq, tf = [], []
    mode = 'mcq'
    q = tfq = None
    last = tflast = 0
    for pno, t in ls:
        if 'الصح والخطأ' in t:
            mode = 'tf'
            continue
        if mode == 'mcq':
            started = False
            m = re.match(r'^(\d{1,3})\s*[-–.)]\s*(.*)$', t)
            if m:
                raw = m.group(1).replace(' ', '')
                for cand in (raw, raw[::-1]):
                    if cand.isdigit() and last < int(cand) <= last + 8:
                        last = int(cand)
                        q = {'q': m.group(2), 'opts': {}, 'page': pno}
                        mcq.append(q)
                        started = True
                        break
            if started:
                continue
            if q is None:
                continue
            for letter, body in split_markers(t):
                body = norm(body)
                if letter:
                    q['opts'][letter] = body
                elif body:
                    if not q['opts']:
                        q['q'] = norm(q['q'] + ' ' + body)
                    else:
                        k = list(q['opts'])[-1]
                        q['opts'][k] = norm(q['opts'][k] + ' ' + body)
        else:
            started = False
            m = re.match(r'^(\d{1,3})\s*[-–.)]\s*(.*)$', t)
            if m:
                raw = m.group(1).replace(' ', '')
                for cand in (raw, raw[::-1]):
                    if cand.isdigit() and tflast < int(cand) <= tflast + 8:
                        tflast = int(cand)
                        tfq = {'q': m.group(2), 'page': pno}
                        tf.append(tfq)
                        started = True
                        break
            if started:
                continue
            if tfq is None:
                continue
            tfq['q'] = norm(tfq['q'] + ' ' + t)
    for item in tf:
        s = item['q']
        ans = None
        if 'صح' in s:
            ans = True
        if 'خطأ' in s:
            ans = False
        item['ans'] = ans
        item['q'] = norm(re.sub(r'[\(\)]?\s*(صح|خطأ)\s*[\(\)]?', ' ', s)).strip()

    red = red_entries(doc)
    mcq_out = []
    for i, qq in enumerate(mcq):
        opts = [qq['opts'].get(k, '') for k in LETTERS]
        if not any(opts):
            continue
        a = red[i][0] if i < len(red) else None
        mcq_out.append({'q': qq['q'], 'options': opts,
                        'ans': LETTERS.index(a) if (a and a in LETTERS) else None,
                        'page': qq['page']})
    tf_out = [{'q': x['q'], 'ans': x['ans'], 'page': x['page']} for x in tf]
    return mcq_out, tf_out


def red_entries(doc):
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
                spans.append((round(sp['bbox'][1]), max(x for x, _ in chars), t))
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
            txt = norm(''.join(s[2] for s in g))
            m = re.match(r'^([أبجد])\s*[\(\)]\s*(.*)$', txt)
            if m:
                seq.append([m.group(1), m.group(2)])
            elif seq:
                seq[-1][1] = norm(seq[-1][1] + ' ' + txt)
    return seq


def match_answers(mcq, red):
    ans = {}
    i = 0
    for letter, text in red:
        key = squash(text)[:14]
        found = None
        for j in range(i, len(mcq)):
            for k, v in mcq[j]['opts'].items():
                sv = squash(v)
                if key and (key in sv or (len(sv) > 6 and sv[:10] == key[:10])):
                    found = (j, k)
                    break
            if found:
                i = j
                break
        if found:
            ans[found[0]] = found[1]
    return ans


# ---------------------------------------------------------------- INVEST
def parse_invest():
    ls, doc = get_lines(INV, 'invest')
    mcq, tf = [], []
    mode = 'mcq'
    q = None
    for pno, t in ls:
        if 'صح أو خطأ' in t or 'صح او خطأ' in t:
            mode = 'tf'
            continue
        if mode == 'mcq':
            m = re.match(r'^([أبجد])\s*\(', t)
            if m:
                letter = m.group(1)
                body = norm(re.sub(r'^[أبجد]\s*\(\s*', '', t))
                ans = '✅' in body
                body = norm(body.replace('✅', '').replace('❌', ''))
                if q is None:
                    q = {'q': body, 'opts': {}, 'page': pno}
                    mcq.append(q)
                else:
                    q['opts'][letter] = body
                if ans:
                    q['ans'] = LETTERS.index(letter)
                continue
            if q is not None and len(q['opts']) >= 4:
                q = None
            if q is None:
                q = {'q': norm(re.sub(r'^[^\u0621-\u064a]{0,6}[.،]?\s*', '', t)), 'opts': {}, 'page': pno}
                q['ans'] = None
                mcq.append(q)
            else:
                q['q'] = norm(q['q'] + ' ' + t)
        else:
            # true / false
            mark = None
            if '✅' in t:
                mark = True
            if '❌' in t:
                mark = False
            body = norm(t.replace('✅', '').replace('❌', ''))
            body = norm(re.sub(r'^[\d\s\.\-]{0,5}', '', body))
            if mark is not None:
                if tf and tf[-1].get('ans') is None and not tf[-1].get('closed'):
                    tf[-1]['q'] = norm(tf[-1]['q'] + ' ' + body)
                    tf[-1]['ans'] = mark
                    tf[-1]['closed'] = True
                else:
                    tf.append({'q': body, 'ans': mark, 'page': pno, 'closed': True})
            else:
                if tf and not tf[-1].get('closed'):
                    tf[-1]['q'] = norm(tf[-1]['q'] + ' ' + body)
                else:
                    tf.append({'q': body, 'ans': None, 'page': pno})
    out = []
    for qq in mcq:
        opts = [qq['opts'].get(k, '') for k in LETTERS]
        if not any(opts):
            continue
        out.append({'q': qq['q'], 'options': opts, 'ans': qq.get('ans'), 'page': qq['page']})
    tfo = [{'q': x['q'], 'ans': x['ans'], 'page': x['page']} for x in tf]
    return out, tfo


# ---------------------------------------------------------------- PROGRAMS
TF_RE = re.compile(r'[\\(]\s*(صواب|خطأ)\s*[\\)]|[\)]\s*(صواب|خطأ)\s*[\\(]')


TF_RE2 = re.compile(r'(?:^|[\s\.\)(])(صواب|خطأ)(?=[\s\.\)(]|$)')


def find_tf(body):
    body = re.sub(r'ص\s*و\s*ا\s*ب', 'صواب', body)
    body = re.sub(r'خ\s*ط\s*أ', 'خطأ', body)
    m = TF_RE.search(body)
    if not m:
        m = TF_RE2.search(body)
        if m:
            return (m.group(1) == 'صواب', body[m.end():], body[:m.start()])
        return None, '', body
    word = m.group(1) or m.group(2)
    note = body[m.end():]
    return word == 'صواب', note, body[:m.start()]


def parse_prog():
    ls, doc = get_lines(PRG, 'prog')
    items = []
    cur = None
    section = ''
    prev_ans_line = False
    for pno, t in ls:
        if re.search(r'المحاضرة|المجموعة|العام الدراسي|بنك أسئلة', t):
            if 'المحاضرة' in t:
                section = norm(re.sub(r'المحاضرة(.*?)المحاضرة', r'\1', t))
            prev_ans_line = False
            continue
        if re.match(r'^الإجا', t):
            mm = re.search(r'[\(\)]\s*([أابجد])\s*[\(\)]', t) or re.search(r'([أابجد])\s*[\(\)]', t)
            if mm:
                L = {'ا': 'أ', 'أ': 'أ', 'ب': 'ب', 'ج': 'ج', 'د': 'د'}.get(mm.group(1), mm.group(1))
                letters = [L]
            else:
                letters = [c for c in t[::-1] if c in LETTERS]
            if letters and cur is not None and cur.get('options'):
                cur['ans'] = LETTERS.index(letters[0])
                cur['closed'] = True
            else:
                prev_ans_line = True
            continue
        m = re.match(r'^(\d{1,2})\s*\(\s*(.*)$', t)
        if m:
            body = norm(m.group(2))
            ans, note, body = find_tf(body)
            note = norm(note).strip(' .()')
            cur = {'q': body, 'options': {}, 'ans': ans, 'note': note, 'section': section,
                   'page': pno, 'type': 'tf' if ans is not None else 'mcq'}
            items.append(cur)
            prev_ans_line = False
            continue
        mo = re.match(r'^([أبجد])\s*\(\s*(.*)$', t)
        if mo and cur is not None:
            body = norm(mo.group(2))
            body = re.sub(r'\s*\)\s*$', ')', body)
            cur['options'][mo.group(1)] = body
            prev_ans_line = False
            continue
        if prev_ans_line:
            letters = [c for c in t if c in LETTERS]
            if letters and cur is not None and cur.get('options'):
                cur['ans'] = LETTERS.index(letters[0])
                cur['closed'] = True
            prev_ans_line = False
            continue
        if cur is None:
            continue
        if cur['type'] == 'mcq' and cur['options']:
            k = list(cur['options'])[-1]
            cur['options'][k] = norm(cur['options'][k] + ' ' + t)
        else:
            if cur.get('ans') is not None:
                cur['note'] = norm(cur['note'] + ' ' + t).strip(' .()')
                continue
            a2, note2, rest = find_tf(t)
            if a2 is not None:
                cur['ans'] = a2
                cur['note'] = norm(cur['note'] + ' ' + note2).strip(' .()')
                cur['q'] = norm(cur['q'] + ' ' + rest)
            else:
                cur['q'] = norm(cur['q'] + ' ' + t)
    return items


# ---------------------------------------------------------------- MACRO
def parse_macro():
    ls, doc = get_lines(MAC, 'macro')
    mcq, tf = [], []
    mode = 'mcq'
    q = None
    lastq = 0
    tfbuf = None
    for pno, t in ls:
        if 'صحيفه ام خاطئة' in t or 'صحيحه ام خاطئة' in t or t.startswith('ثانيا'):
            mode = 'tf'
            continue
        if mode == 'mcq':
            m = re.match(r'^(\d{1,2})\s*-\s*(.*)$', t)
            if m:
                n = int(m.group(1))
                if q is not None and 1 <= n <= 4 and len(q['opts']) == n - 1:
                    q['opts'][LETTERS[n - 1]] = norm(m.group(2))
                    continue
                if n == lastq + 1:
                    lastq = n
                    q = {'q': m.group(2), 'opts': {}, 'page': pno}
                    mcq.append(q)
                    continue
                if q is not None and 0 < n <= 4 and n <= len(q['opts']):
                    continue
            if q is None:
                continue
            if re.fullmatch(r'[\d\s\-–.]+', t):
                continue
            if q['opts']:
                k = list(q['opts'])[-1]
                q['opts'][k] = norm(q['opts'][k] + ' ' + t)
            else:
                q['q'] = norm(q['q'] + ' ' + t)
        else:
            m = re.match(r'^(\d{1,2})\s*(.*)$', t)
            mark = None
            if '✓' in t:
                mark = True
            if '✗' in t:
                mark = False
            body = norm(t.replace('✓', '').replace('✗', ''))
            if m and (not tfbuf or mark is not None or '✓' in t or '✗' in t):
                body2 = norm(m.group(2))
                if tfbuf and tfbuf.get('ans') is None:
                    tf.append(tfbuf)
                tfbuf = {'q': body2, 'ans': mark, 'page': pno}
                continue
            if tfbuf is None:
                continue
            tfbuf['q'] = norm(tfbuf['q'] + ' ' + body)
            if mark is not None:
                tfbuf['ans'] = mark
    if tfbuf:
        tf.append(tfbuf)
    out = []
    for qq in mcq:
        opts = [qq['opts'].get(k, '') for k in LETTERS]
        if not any(opts):
            continue
        out.append({'q': qq['q'], 'options': opts, 'page': qq['page']})
    tfo = [{'q': x['q'], 'ans': x['ans'], 'page': x['page']} for x in tf]
    return out, tfo


# ---------------------------------------------------------------- word rows (for MAC)
MAC_FIX = [('اإل', 'الإ'), ('األ', 'الأ'), ('اآل', 'الآ'), ('اال', 'الا'), ('ألل', 'للأ'),
           ('استهالك', 'استهلاك'), ('الكالسيكية', 'الكلاسيكية'), ('عالقة', 'علاقة'),
           ('خالل', 'خلال'), ('متحصالت', 'متحصلات'), ('التحويالت', 'التحويلات'),
           ('معدالت', 'معدلات'), ('واآلالت', 'والآلات'), ('واألساليب', 'والأساليب'),
           ('لإلستهالك', 'للاستهلاك'), ('لالدخار', 'للادخار'), ('لالستثمار', 'للاستثمار'),
           ('لالستهالك', 'للاستهلاك'), ('الإل', 'الإ'), ('األصول', 'الأصول')]


def mac_fix(s):
    s = re.sub(r'[ \t]+', ' ', s or '').strip()
    for a, b in MAC_FIX:
        s = s.replace(a, b)
    return s


def word_rows(f, ybin=6):
    doc = pymupdf.open(f)
    out = []
    for pno in range(len(doc)):
        rows = {}
        for w in doc[pno].get_text('words'):
            y = round((w[1] + w[3]) / 2 / ybin)
            rows.setdefault(y, []).append(w)
        for y in sorted(rows):
            r = sorted(rows[y], key=lambda w: -w[2])
            txt = mac_fix(' '.join(w[4] for w in r))
            if txt:
                out.append((pno + 1, txt))
    return out, doc


def parse_macro2():
    ls, doc = word_rows(MAC)
    mcq, tf = [], []
    mode = 'mcq'
    q = None
    lastq = 0
    tfbuf = None
    for pno, t in ls:
        if 'خاطئة' in t or t.startswith('ثانيا'):
            mode = 'tf'
            continue
        if mode == 'mcq':
            m = re.match(r'^(\d{1,2})\s*-\s*(.*)$', t)
            if m:
                n = int(m.group(1))
                if q is not None and 1 <= n <= 4 and n == len(q['opts']) + 1:
                    q['opts'][LETTERS[n - 1]] = norm(m.group(2))
                    continue
                if n == lastq + 1:
                    lastq = n
                    q = {'q': m.group(2), 'opts': {}, 'page': pno}
                    mcq.append(q)
                    continue
            if q is None:
                continue
            if q['opts']:
                k = list(q['opts'])[-1]
                q['opts'][k] = norm(q['opts'][k] + ' ' + t)
            else:
                q['q'] = norm(q['q'] + ' ' + t)
        else:
            mark = None
            if '✓' in t:
                mark = True
            if '✗' in t:
                mark = False
            body = norm(t.replace('✓', '').replace('✗', ''))
            m = re.match(r'^(\d{1,2})\s*(.*)$', body)
            newitem = bool(m) and (int(m.group(1)) == (len(tf) + 1) or int(m.group(1)) == len(tf))
            if re.fullmatch(r'[✓✗\s]*', t) and tfbuf is not None:
                if mark is not None and tfbuf.get('ans') is None:
                    tfbuf['ans'] = mark
                continue
            if m and (newitem or (tfbuf and tfbuf.get('ans') is not None)):
                tfbuf = {'q': norm(m.group(2)), 'ans': mark, 'page': pno}
                tf.append(tfbuf)
                continue
            if tfbuf is None:
                continue
            tfbuf['q'] = norm(tfbuf['q'] + ' ' + body)
            if mark is not None and tfbuf.get('ans') is None:
                tfbuf['ans'] = mark
    out = []
    for qq in mcq:
        opts = [qq['opts'].get(k, '') for k in LETTERS]
        if not any(opts):
            continue
        out.append({'q': qq['q'], 'options': opts, 'page': qq['page']})
    tfo = [{'q': x['q'], 'ans': x['ans'], 'page': x['page']} for x in tf]
    return out, tfo


def mac_lines():
    doc = pymupdf.open(MAC)
    out = []
    for pno in range(len(doc)):
        raw = [x.strip() for x in doc[pno].get_text().split('\n') if x.strip()]
        rows = []
        i = 0
        while i < len(raw):
            t = raw[i]
            if re.fullmatch(r'\d{1,3}', t):
                j = i + 1
                if j < len(raw) and re.match(r'^[\.\-–]', raw[j]):
                    sep = raw[j][0]
                    if re.fullmatch(r'[\.\-–]{1,2}', raw[j]):
                        j += 1
                        txt = raw[j] if j < len(raw) else ''
                    else:
                        txt = re.sub(r'^[\.\-–]+\s*', '', raw[j])
                    rows.append(mac_fix((t + sep + ' ' + txt).strip()))
                    i = j + 1
                    continue
                i += 1
                continue
            rows.append(mac_fix(t))
            i += 1
        for r in rows:
            out.append((pno + 1, r))
    return out, doc


def parse_macro3():
    ls, doc = mac_lines()
    mcq, tf = [], []
    mode = 'mcq'
    q = None
    lastq = 0
    tfbuf = None
    for pno, t in ls:
        if 'خاطئة' in t or t.startswith('ثانيا'):
            mode = 'tf'
            continue
        if mode == 'mcq':
            m = re.match(r'^(\d{1,3})\s*[-–.]\s*(.*)$', t)
            if m:
                n = int(m.group(1))
                if q is not None and 1 <= n <= 4 and n == len(q['opts']) + 1:
                    q['opts'][LETTERS[n - 1]] = norm(m.group(2))
                    continue
                if n == lastq + 1:
                    lastq = n
                    q = {'q': m.group(2), 'opts': {}, 'page': pno}
                    mcq.append(q)
                    continue
            if q is None:
                continue
            if q['opts']:
                k = list(q['opts'])[-1]
                q['opts'][k] = norm(q['opts'][k] + ' ' + t)
            else:
                q['q'] = norm(q['q'] + ' ' + t)
        else:
            mark = None
            if '✓' in t:
                mark = True
            if '✗' in t:
                mark = False
            body = norm(t.replace('✓', '').replace('✗', ''))
            if re.fullmatch(r'[✓✗\s]*', t) and tfbuf is not None:
                if mark is not None and tfbuf.get('ans') is None:
                    tfbuf['ans'] = mark
                continue
            m = re.match(r'^(\d{1,2})\s*(.*)$', body)
            if m and (int(m.group(1)) in (len(tf) + 1, len(tf))) and (tfbuf is None or tfbuf.get('ans') is not None or len(body) > 20):
                tfbuf = {'q': norm(m.group(2)), 'ans': mark, 'page': pno}
                tf.append(tfbuf)
                continue
            if tfbuf is None:
                continue
            tfbuf['q'] = norm(tfbuf['q'] + ' ' + body)
            if mark is not None and tfbuf.get('ans') is None:
                tfbuf['ans'] = mark
    out = []
    for qq in mcq:
        opts = [qq['opts'].get(k, '') for k in LETTERS]
        if not any(opts):
            continue
        out.append({'q': qq['q'], 'options': opts, 'page': qq['page']})
    tfo = [{'q': x['q'], 'ans': x['ans'], 'page': x['page']} for x in tf]
    return out, tfo
