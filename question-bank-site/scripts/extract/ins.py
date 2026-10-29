"""Parsers for the two extra banks: التأمين (insurance) and قواعد البيانات (databases).

Insurance PDF quirks:
  * body text needs glyph decoding (pdfbase.units / lines.page_lines) — get_text() is mojibake;
  * MCQ answers are vector ellipses: green-outlined bubbles under each option,
    the correct one filled red (1,0,0) or orange (0.929,0.49,0.192);
  * TF answers are the marks √ / × (later sections use )صواب( / )خطأ( ),
    usually followed by the corrected wording inside ]...[ or after "التصحيح:".
Databases PDF: text layer is clean.  MCQ option letters أ) ب) ج) د) and
  '(الإجابة X)'; TF uses (صواب)/(خطأ) with an optional '.. correction'.
"""
import re
import sys

import paths  # noqa: F401  (repo-relative sys.path setup)

import pymupdf
import lines as L

SLOTS = [428, 322, 201, 98]          # bubble x centres, right -> left == slots 0..3
GREEN = (0.4390000104904175, 0.6779999732971191, 0.27799999713897705)
CORRECT_FILLS = [(1.0, 0.0, 0.0), (0.9290000200271606, 0.49000000953674316, 0.19200000166893005)]

# ---------------------------------------------------------------- text repair
FIX = [
    ('اأ', 'الأ'), ('اإ', 'الإ'), ('اآ', 'الآ'), ('اال', 'الا'),
    ('هيئات التأمينالحكومي', 'هيئات التأمين الحكومي'),
    ('هيئات التأمينالتبادلي', 'هيئات التأمين التبادلي'),
    ('هيئات التأمينالذاتي', 'هيئات التأمين الذاتي'),
    ('المستأمنفي', 'المستأمن في'),
    ('ومستأمنفي', 'ومستأمن في'),
    ('مسببالخطر', 'مسبب الخطر'),
    ('هوالظاهرة', 'هو الظاهرة'),
    ('مسبباتاألخطار', 'مسببات الأخطار'),
    ('مسبباتالأخطار', 'مسببات الأخطار'),
    ('غيراإلقتصادية', 'غير الإقتصادية'),
    ('الشئ', 'الشيء'),
    ('جزءء', 'جزء'),
    ('التييتمتحليلها', 'التي يتم تحليلها'),
    ('المستخدمينيفضلونالواجهاتالرسومية', 'المستخدمين يفضلون الواجهات الرسومية'),
    ('منقاعدة الهرمإلىقمته', 'من قاعدة الهرم إلى قمته'),
    ('المعرفة ثمالمعلومات،ثمالبيانات،ثم الحكمة', 'المعرفة ثم المعلومات، ثم البيانات، ثم الحكمة'),
    ('لتخزينالبيانات', 'لتخزين البيانات'),
    ('لايمكن', 'لا يمكن'),
    ('لاينتج', 'لا ينتج'),
    ('هوالخطر', 'هو الخطر'),
    ('الأخطارالإقتصادية', 'الأخطار الإقتصادية'),
    ('الأخطارالمعنوية', 'الأخطار المعنوية'),
    ('الأخطارالعامة', 'الأخطار العامة'),
    ('الأخطارالخاصة', 'الأخطار الخاصة'),
    ('أخطار المسئوليةالمدنية', 'أخطار المسئولية المدنية'),
    ('المسئوليةالمدنية', 'المسئولية المدنية'),
    ('التأمينللأخطار', 'التأمين للأخطار'),
    ('المختلفةمن', 'المختلفة من'),
    ('السبب القريبمن', 'السبب القريب من'),
    ('بسوءنية', 'بسوء نية'),
    ('بحسن نيةو', 'بحسن نية و'),
    ('إخفاءبيانات', 'إخفاء بيانات'),
    ('الصحيتختص', 'الصحي تختص'),
    ('التبادلينجاحاً', 'التبادلي نجاحاً'),
    ('كبيرة الحجمو', 'كبيرة الحجم و'),
    ('الإجاة', 'الإجابة'),
    ('الولت', 'الوقت'),
    ('المانونية', 'القانونية'),
    ('المانوني', 'القانوني'),
    ('تمك', 'تحقيق'),
    ('تحمك', 'تحقيق'),
    ('الممدمة', 'المقدمة'),
    ('ولوع', 'وقوع'),
    ('المستمبل', 'المستقبل'),
    ('الممبل', 'المستقبل'),
    ('الفمرات', 'الفقرات'),
    ('سبك', 'سبق'),
    ('الش يء', 'الشيء'),
    ('وعليهأجب', 'وعليه أجب'),
    ('الوثيقةتخضعلقاعدة', 'الوثيقة تخضع لقاعدة'),
    ('لاتخضعلقاعدة', 'لا تخضع لقاعدة'),
    ('النسبيةيكون', 'النسبية يكون'),
    ('الكفايةيكون', 'الكفاية يكون'),
    ('سياسةتجميع', 'سياسة تجميع'),
    ('اليهالإذا', 'اليه إذا'),
    ('الخاصةلشخص', 'الخاصة لشخص'),
    ('المعنويةحسب', 'المعنوية حسب'),
    ('الذاتينجاحاً', 'الذاتي نجاحاً'),
    ('الأخطارالإقتصادية', 'الأخطار الإقتصادية'),
    ('مبدأالخسارة', 'مبدأ الخسارة'),
    ('مبدأالسبب', 'مبدأ السبب'),
    ('أحدالمبادئ', 'أحد المبادئ'),
    ('أنواعأخطار', 'أنواع أخطار'),
    ('الممتلكاتالإقتصادية', 'الممتلكات الإقتصادية'),
    ('العامةتكون', 'العامة تكون'),
    ('مباشرةلشخص', 'مباشرة لشخص'),
    ('غيرمستقلة', 'غير مستقلة'),
    ('التأمينالصحي', 'التأمين الصحي'),
    ('التأمينالحكومي', 'التأمين الحكومي'),
    ('الخطرمركزاً', 'الخطر مركزاً'),
    ('ورائها', 'ورائها'),
    ('جزء منه', 'جزء منه'),

    ('المصلحةالتأمينية', 'المصلحة التأمينية'),
    ('الخسارةالمالية', 'الخسارة المالية'),
    ('أخطارالمسئولية', 'أخطار المسئولية'),
    ('غيرالإقتصادية', 'غير الإقتصادية'),
    ('للتأمينالقيام', 'للتأمين القيام'),
    ('سياسةالإدخار', 'سياسة الإدخار'),
    ('الحدثالمتسبب', 'الحدث المتسبب'),
    ('مبدأالتعويض', 'مبدأ التعويض'),
    ('قيمةالخسارة', 'قيمة الخسارة'),
    ('منالمبادئ', 'من المبادئ'),
    ('الشخصنفسه', 'الشخص نفسه'),
    ('المعرضللخطر', 'المعرض للخطر'),
    ('إمكانيةإثبات', 'إمكانية إثبات'),
    ('سهولةتحديد', 'سهولة تحديد'),
    ('مسب ب الخطر', 'مسبب الخطر'),
('عاما يهو', 'عاماً هو'),
    ('عمدا يمن', 'عمداً من'),
    ('الحكومييعتبر', 'الحكومي يعتبر'),
    ('خاطئةبسوء', 'خاطئة بسوء'),
    ('الأخطاريضع', 'الأخطار يضع'),
    ('عدم توفرمبدأ', 'عدم توفر مبدأ'),
]


AR = '\u0621-\u064a'
DIAC = '\u064b\u064c\u064d'          # ً ٌ ٍ  (used by this font for ي)
KEEP_ALONE = {'ف', 'ي'}


def _fix_ya(s):
    """this font prints ي as a tanween-like glyph; put it back"""
    # single letter + diacritic + letters  ->  one word   (غ ٌر -> غير)
    s = re.sub(r'(?<![%s])([%s]) ([%s])(?=[%s])' % (AR, AR, DIAC, AR),
               lambda m: m.group(1) + 'ي', s)
    # single letter + diacritic at word end             (ف ً  -> في)
    s = re.sub(r'(?<![%s])([%s]) ([%s])(?=\s|$)' % (AR, AR, DIAC),
               lambda m: m.group(1) + 'ي', s)
    # diacritic before letters inside a word            (قد ٌحدث -> قد يحدث / ٌحدث -> يحدث)
    s = re.sub(r' ([%s])(?=[%s])' % (DIAC, AR), ' ي', s)
    s = re.sub(r'([%s])(?=[%s])' % (DIAC, AR), 'ي', s)
    return s


def _merge_single_letters(s):
    toks = s.split(' ')
    out = []
    for t in toks:
        if (len(t) == 1 and re.fullmatch('[' + AR + ']', t) and t not in KEEP_ALONE
                and out and out[-1] and re.fullmatch('[' + AR + ']', out[-1][-1])
                and len(out[-1]) >= 2):
            out[-1] += t
            continue
        out.append(t)
    return ' '.join(out)


def fix(s):
    s = re.sub(r'\s+', ' ', s or '').strip()
    s = re.sub(r'\u0640{3,}', ' ........ ', s)          # the PDF prints blanks as tatweel
    s = re.sub(r'[\u064b\u064c\u064d]?\s*\u0640{1,2}\s*', ' ', s)
    s = _fix_ya(s)
    s = _merge_single_letters(s)
    for a, b in sorted(FIX, key=lambda t: -len(t[0])):
        s = s.replace(a, b)
    s = re.sub(r'(?<=[' + AR + ']) (?=[' + AR + '] )(?![' + AR + '] )', '', s)
    s = re.sub(r'(?<=[%s])\s+([%s])(?=\s|$)' % (AR, DIAC), r'\1', s)
    s = re.sub(r'\s+([،.:؟!])', r'\1', s)
    s = re.sub(r'\s*\(\s*', ' (', s)
    s = re.sub(r'\s*\)\s*', ') ', s)
    # a whole parenthetical printed with reversed brackets: ") بحد أقصى ... (" -> " (بحد أقصى ...) "
    s = re.sub(r'\)\s*([^()\d.\s][^()\d.]*[^()\d.\s])\s*\(', lambda m: ' (%s) ' % m.group(1).strip(), s)
    s = re.sub(r'\)\s*\(', ') (', s)
    # reversed brackets:  ") م ("  ->  " (م) "
    s = re.sub(r'\)\s*([^()\s]{1,3})\s*\(', lambda m: ' (%s) ' % m.group(1).strip(), s)
    s = re.sub(r'\)\s*([A-Za-z][A-Za-z_]{1,10})\s*\(', r' (\1) ', s)
    s = re.sub(r'(يساوي|تساوي)\s*[\]\)\s]*[\d\s×÷\(\)\[\]]*$', r'\1', s)
    s = re.sub(r'\s+', ' ', s).strip()
    s = dedupe(s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def _frac(s):
    """turn '× 200000 120000 220000' into '200000 × 120000 ÷ 220000'"""
    if not re.fullmatch(r'[×÷\d\s\.]+', s or ''):
        return s
    toks = s.split()
    if len(toks) < 3 or not all(re.fullmatch(r'[×÷]|\d+', t) for t in toks):
        return s
    if toks[0] == '×':
        toks = toks[1:2] + ['×'] + toks[2:] if len(toks) > 2 else toks
    out = toks[0]
    for t in toks[1:]:
        out += (' ' + t + ' ') if t in '×÷' else ('÷ ' + t if len(out.split()) >= 3 else ' ' + t)
    return re.sub(r'\s+', ' ', out).strip()


def _tidy(s):
    s = re.sub(r'\s+', ' ', s or '').strip()
    s = re.sub(r'[\s\)\(\]\[]+$', '', s)
    return s.strip()


def _tidy_note(s):
    s = re.sub(r'\s+', ' ', s or '').strip()
    s = re.sub(r'^[\s\)\(\]\[\.:،]+', '', s)
    s = re.sub(r'[\s\)\(\]\[]+$', '', s)
    return s.strip()


def dedupe(s):
    """collapse 'X X' / phrase-doubled text (these PDFs render many lines twice)"""
    n = len(s)
    for k in range(n // 2, 12, -1):
        head, tail = s[:k].strip(), s[k:].strip()
        if head and tail and (tail == head or tail.startswith(head[:-1])):
            return head
    prev = None
    while prev != s:
        prev = s
        s = re.sub(r'(.{8,}?)\1', r'\1', s)
    return s


def _join(parts):
    s = ' '.join(p.strip() for p in parts if p and p.strip())
    return re.sub(r'\s+', ' ', s).strip()


# ---------------------------------------------------------------- insurance
def bubbles(page):
    out = []
    for dr in page.get_drawings():
        if len(dr['items']) != 4 or not dr.get('color'):
            continue
        if any(abs(a - b) > 0.01 for a, b in zip(dr['color'], GREEN)):
            continue
        r = dr['rect']
        yc, xc = (r.y0 + r.y1) / 2, (r.x0 + r.x1) / 2
        slot = min(range(4), key=lambda i: abs(SLOTS[i] - xc))
        out.append((yc, xc, slot, dr.get('fill') in CORRECT_FILLS))
    return out


def slot_of_x(xmin):
    for i, sx in enumerate(SLOTS):
        if xmin > sx - 8:
            return i
    return 3


HEADER_RE = re.compile(r'^(هيئات التأمين\s*&|تابع أنواع الخطر|مبدأ التعويض ومبدأ|سياسات إدارة الخطر|الخطر\s*$)')


def parse_insurance(path):
    doc = pymupdf.open(path)
    mcq, tf = [], []
    bad_mcq = []
    section = ''
    mode = 'mcq'
    cur = None
    tf_cur = None
    pending_lead = ['']

    # one flat row list across pages so options that spill to the next page still join
    allrows = []
    brows_by_page = {}
    for pno in range(len(doc)):
        allrows += [(pno, r) for r in L.page_lines(doc, pno)]
        brows = []
        for b in bubbles(doc[pno]):
            if brows and abs(brows[-1][0] - b[0]) <= 3:
                brows[-1][1].append(b)
            else:
                brows.append([b[0], [b]])
        brows_by_page[pno] = brows

    def close_tf():
        nonlocal tf_cur
        if tf_cur and tf_cur.get('ans') is not None and _join(tf_cur['stem']).strip():
            tf.append(tf_cur)
        tf_cur = None

    def close_mcq():
        nonlocal cur
        if cur and len(cur['options']) == 4 and cur['ans'] is not None:
            mcq.append(cur)
        elif cur is not None:
            bad_mcq.append(cur)
        cur = None

    def row_bubbles(pno, y):
        for ry, items in brows_by_page.get(pno, []):
            if abs(ry - y) <= 5:
                return items
        return None

    i = 0
    while i < len(allrows):
        pno, row = allrows[i]
        t = row['text'].strip()
        i += 1
        if not t:
            continue
        if re.search(r'صواب\s*أم\s*خطأ|صوابأم خطأ', t) or re.search(r'أسئلة\s*\)?\s*صواب', t):
            close_mcq(); close_tf(); mode = 'tf'; continue
        if t.lstrip().startswith(('أول', 'أوال', 'أوًل')):
            close_mcq(); close_tf(); mode = 'mcq'; continue
        if HEADER_RE.match(t) and len(t) < 120:
            close_mcq(); close_tf()
            section = fix(re.sub(r'\s*&\s*', ' & ', t.strip()))
            continue

        items = row_bubbles(pno, row['y'])
        m = re.match(r'^(\d{1,2})\s*[\.\)]\s*(.*)$', t)

        if mode == 'mcq':
            if m:
                close_mcq()
                cur = {'num': int(m.group(1)), 'stem': [m.group(2)], 'options': {},
                       'ans': None, 'section': section, 'note': pending_lead[0]}
                pending_lead[0] = ''
                if items:
                    _fill_options(cur, allrows, i, items, row_bubbles)
                    i = cur.pop('_next_i')
                continue
            if cur is None:
                if len(t) > 40:
                    pending_lead[0] = (pending_lead[0] + ' ' + t).strip()
                continue
            if items:
                if cur['options']:
                    close_mcq()
                    cur = {'num': None, 'stem': [t], 'options': {}, 'ans': None,
                           'section': section, 'note': ''}
                _fill_options(cur, allrows, i, items, row_bubbles)
                i = cur.pop('_next_i')
            else:
                cur['stem'].append(t)
        else:
            if m:
                close_tf()
                tf_cur = {'num': int(m.group(1)), 'stem': [], 'ans': None, 'note': '',
                          'section': section}
                _feed_tf(tf_cur, m.group(2))
                if tf_cur.get('ans') is not None:
                    close_tf()
                continue
            if tf_cur is None:
                if tf and len(t) < 400:
                    tf[-1]['note'] = (tf[-1].get('note') or '') + ' ' + t
                continue
            _feed_tf(tf_cur, t)
            if tf_cur.get('ans') is not None:
                close_tf()
    close_mcq(); close_tf()

    out_mcq = []
    for q in mcq:
        opts = [_tidy_note(_frac(fix(q['options'][k]))) for k in range(4)]
        out_mcq.append({'q': _tidy(fix(_join(q['stem']))), 'options': opts, 'ans': q['ans'],
                        'section': q['section'], 'note': _tidy_note(fix(q.get('note', '')))})
    out_tf = [{'q': _tidy(fix(_join(q['stem']))), 'ans': q['ans'],
               'note': _tidy_note(fix(q['note'])), 'section': q['section']} for q in tf]
    _fix_numeric(out_mcq)
    _fix_leftovers(out_mcq)
    for q in out_tf:
        if q['note'].startswith('950000') or '950000' in q['note'][:20]:
            q['note'] = 'التصحيح: 1000000 × (950000 ÷ 1200000)'
    return out_mcq, out_tf, bad_mcq


# --- hand-keyed repair for the numeric (fraction) section -------------------
_NUM_SECTION = 'مبدأ التعويض ومبدأ الحلول في الحقوق'
_NUM_FIXED = [
    {'q': 'قام سامي بالتأمين على سيارته بوثيقة التأمين الشامل بمبلغ (م) 300000 جنيه وأثناء سريان '
          'الوثيقة حدث تصادم للسيارة وقدرت الخسائر المالية (خ) الناتجة عنه حينئذ بمبلغ 50000 جنيه، '
          'وقد كانت السيارة قد تم تثمينها بمبلغ 250000 جنيه (ق). فإن مقدار التعويض المالي (ع) '
          'المستحق لسامي يساوي ........ جنيه',
     'options': ['50000', '300000', '250000', '40000'], 'ans': 0},
    {'q': 'إذا كان مبلغ التأمين (م) 500000 جنيه، وقيمة الخسارة المحققة (خ) 100000 جنيه، وقيمة الشيء '
          'المؤمن عليه وقت تحقق الخطر (ق) 450000 جنيه. فإن مقدار التعويض (ع) يساوي ........ جنيه',
     'options': ['500000', '100000', '450000', '200000'], 'ans': 1},
    {'q': 'إذا كان مبلغ التأمين (م) 200000 جنيه، وقيمة الخسارة المحققة (خ) 250000 جنيه، وقيمة الشيء '
          'المؤمن عليه وقت تحقق الخطر (ق) 300000 جنيه. فإن مقدار التعويض (ع) إذا كانت الوثيقة لا '
          'تخضع لمبدأ النسبية يساوي ........ جنيه',
     'options': ['200000', '300000', '250000', '350000'], 'ans': 0},
    {'q': 'في المسألة السابقة، قيمة التعويض (ع) إذا كانت الوثيقة تخضع لمبدأ النسبية تساوي ........',
     'options': ['200000 × 250000 ÷ 300000', '250000 × 200000 ÷ 300000',
                 '300000 × 200000 ÷ 250000', '250000 × 100000 ÷ 300000'], 'ans': 1},
    {'q': 'إذا كان مبلغ التأمين (م) 200000 جنيه، وقيمة الخسارة المحققة (خ) 120000 جنيه، وقيمة الشيء '
          'المؤمن عليه وقت تحقق الخطر (ق) 220000 جنيه، وقامت شركة التأمين بسداد التعويض المستحق ثم '
          'حلت محل المستأمن في مقاضاة المسئول عن الضرر وحصلت على 140000 جنيه. فإذا كانت الوثيقة لا '
          'تخضع لمبدأ النسبية فإن شركة التأمين تأخذ مبلغ ........ جنيه',
     'options': ['140000', '20000', '120000', '220000'], 'ans': 2},
    {'q': 'في المسألة السابقة إذا كانت الوثيقة تخضع لمبدأ النسبية فإن شركة التأمين تأخذ مبلغ التعويض '
          'الذي دفعته وقيمته تساوي ........',
     'options': ['120000 × 200000 ÷ 220000', '140000 × 200000 ÷ 220000',
                 '200000 × 140000 ÷ 220000', '140000 ÷ 120000'], 'ans': 0},
]


def _fix_numeric(mcq):
    idx = [k for k, q in enumerate(mcq) if q['section'] == _NUM_SECTION]
    if len(idx) < len(_NUM_FIXED):
        return
    start = idx[0]
    del mcq[start:]
    for spec in _NUM_FIXED:
        mcq.append({'q': spec['q'], 'options': list(spec['options']), 'ans': spec['ans'],
                    'section': _NUM_SECTION, 'note': ''})


_LEAD_IN = ('فقد أحد الأشخاص مبنى خشبي يمتلكه بعد تعرضه لحادث حريق. '
            'وعليه أجب على الفقرات من 3 إلى 5:')


def _fix_leftovers(mcq):
    """a few rows where a stem or the next question's head leaked into the options"""
    if len(mcq) > 4:
        q2 = mcq[1]
        q2['q'] = q2['q'].split(' إلى 5:')[0].strip()
        q2['options'][3] = 'لاشيء مما سبق'
        for k in (2, 3, 4):
            if k < len(mcq) and not mcq[k].get('note'):
                mcq[k]['note'] = _LEAD_IN
    for q in mcq:
        for k, o in enumerate(q['options']):
            m = re.search(r'\s\d{1,2}\.(?=\s*[%s])' % AR, o)
            if m and len(o) > 45:
                q['options'][k] = o[:m.start()].strip()
                q['num'] = q.get('num')
    # Q21 head stolen by Q20's second option
    for q in mcq:
        for k, o in enumerate(q['options']):
            if o.startswith('إمكانية إثبات وقوع الحادث') and len(o) > 40:
                q['options'][k] = 'إمكانية إثبات وقوع الحادث'
    for q in mcq:
        if q['q'].startswith('المعلومات المقدمة معاينة خبراء محاضر الشرطة'):
            q['q'] = 'تعتمد شركات التأمين في تحديد معالم الحادث على:'


def _fill_options(cur, allrows, i, items, row_bubbles):
    """collect the option texts for the bubble row at allrows[i-1]"""
    p0, row0 = allrows[i - 1]
    anchors = sorted([(xc, slot) for (yc, xc, slot, correct) in items])
    cols = {}

    def col_of(x0, x1):
        # the option text always starts just to the right of its own bubble
        cand = [a for a in anchors if a[0] <= x0 - 10]
        return (cand[-1] if cand else anchors[0])[1]

    units0 = list(row0['units'])
    for x0, x1, t in units0:
        cols.setdefault(col_of(x0, x1), []).append(t)
    if sorted(cols) != [0, 1, 2, 3]:
        # fall back to plain right-to-left reading order
        cols = {}
        for k, (x0, x1, t) in enumerate(units0):
            cols.setdefault(min(k, 3), []).append(t)
    for (yc, xc, slot, correct) in items:
        if correct:
            cur['ans'] = slot
    j = i
    n_cont = 0
    while j < len(allrows) and n_cont < 3:
        pno, nxt = allrows[j]
        txt = nxt['text'].strip()
        if not txt:
            j += 1
            continue
        if pno == p0:
            if nxt['y'] - row0['y'] > 44:
                break
        elif not (nxt['y'] < 200 and pno == p0 + 1):
            break
        if re.match(r'^\d{1,2}\s*[\.\)]\s', txt) or txt.startswith('*'):
            break
        if HEADER_RE.match(txt) or '&' in txt or len(txt) > 300:
            break
        if row_bubbles(pno, nxt['y']):
            break
        for x0, x1, t in nxt['units']:
            cols.setdefault(col_of(x0, x1), []).append(t)
        j += 1
        n_cont += 1
    for c, parts in cols.items():
        cur['options'][c] = ' '.join(p.strip() for p in parts if p.strip())
    cur['_next_i'] = j


def _feed_tf(q, text):
    if q.get('ans') is not None:
        q['note'] = (q.get('note') or '') + ' ' + text
        return
    m = re.search(r'[√×✓✗]', text)
    if m:
        q['ans'] = m.group(0) in '√✓'
        q['stem'].append(text[:m.start()])
        rest = text[m.end():]
        if rest.strip():
            q['note'] = (q.get('note') or '') + ' ' + rest
        return
    m = re.search(r'[\(\)]\s*(صواب|خطأ)\s*[\(\)]', text)
    if m:
        q['ans'] = m.group(1) == 'صواب'
        before, rest = text[:m.start()], text[m.end():]
        q['stem'].append(before)
        rest = _drop_repeat(before, rest)
        if rest.strip():
            q['note'] = (q.get('note') or '') + ' ' + rest
        return
    q['stem'].append(text)


def _drop_repeat(before, after):
    a = re.sub(r'[^\u0621-\u064a0-9]', '', before)
    b = re.sub(r'[^\u0621-\u064a0-9]', '', after)
    if a and b and (b.startswith(a[-40:]) or b.startswith(a)):
        return ''
    return after


DB_GLUE = [
    ('استبدالالتكراربمعرفاتتربط', 'استبدال التكرار بمعرفات تربط'),
    ('ادخالالسجلالواحدأكثر', 'ادخال السجل الواحد أكثر'),
    ('وربطالجداولبمفاتيح', 'وربط الجداول بمفاتيح'),
    ('البرنامجالأكاديمي', 'البرنامج الأكاديمي'),
    ('جدولالطلباتيربط', 'جدول الطلبات يربط'),
    ('بالمفتاحالأجنبي', 'بالمفتاح الأجنبي'),
    ('فيالجدولالثالث', 'في الجدول الثالث'),
    ('أينيكونالمفتاح', 'أين يكون المفتاح'),
    ('يمكنتسجيلالطلب', 'يمكن تسجيل الطلب'),
    ('سياقالبيانات', 'سياق البيانات'),
    ('والكلماتمثل', 'والكلمات مثل'),
    ('وضعالمفتاح', 'وضع المفتاح'),
    ('عددالأعمدة', 'عدد الأعمدة'),
    ('لهمبالوصول', 'لهم بالوصول'),
    ('جدولالطالب', 'جدول الطالب'),
    ('فيالجداول', 'في الجداول'),
    ('جدولالطلب', 'جدول الطلب'),
    ('جدولالمنتج', 'جدول المنتج'),
    ('العميلكمفتاح', 'العميل كمفتاح'),
    ('قاعدة العملداخل', 'قاعدة العمل داخل'),
    ('فرضقيد', 'فرض قيد'),
    ('المجموعة الثانة', 'المجموعة الثانية'),
    ('المجموعة الأو', 'المجموعة الأولى'),
    ('أيممايلييمكن استخدامهكقاعدة', 'أي مما يلي يمكن استخدامه كقاعدة'),
    ('ممايلي', 'مما يلي'),
    ('مهاممدير', 'مهام مدير'),
    ('المخزنةفي', 'المخزنة في'),
    ('للبياناتميزة', 'للبيانات ميزة'),
    ('التطبيقلقاعدة', 'التطبيق لقاعدة'),
    ('إطلاقاداخل', 'إطلاقا داخل'),
    ('تصميمنظم', 'تصميم نظم'),
    ('كيانيُراد', 'كيان يُراد'),
    ('تمثيلهفي', 'تمثيله في'),
    ('المفاتيحفلا', 'المفاتيح فلا'),
    ('يتمتكرار', 'يتم تكرار'),
    ('الجدوللتسهيل', 'الجدول لتسهيل'),
    ('وقتابينما', 'وقت بينما'),
    ('كيانايتم', 'كيانات يتم'),
    ('رئيسيايميز', 'رئيسي يميز'),
    ('وسيطايجمع', 'وسيطا يجمع'),
    ('الأرقامويسمح', 'الأرقام ويسمح'),
    ('عدمتمييزها', 'عدم تمييزها'),
    ('وجداولالطلاب', 'وجدول الطلاب'),
    ('يسجلفيبرنامجأكاديمي', 'يسجل في برنامج أكاديمي'),
    ('فقطللجداول', 'فقط للجداول'),
    ('الجدولينفي', 'الجدولين في'),
    ('أجلكل', 'أجل كل'),
    ('خاطئةداخل', 'خاطئة داخل'),
    ('استعلامل', 'استعمال ل'),
    ('الصحيحةمثل', 'الصحيحة مثل'),
    ('الكسورمثل', 'الكسور مثل'),
    ('الزمنيةمثل', 'الزمنية مثل'),
    ('الجدولينبمفتاح', 'الجدولين بمفتاح'),
    ('القيمةداخل', 'القيمة داخل'),
    ('كسوروقيممالية', 'كسور وقيم مالية'),
    ('يوضعكود', 'يوضع كود'),
    ('لماذايفيد', 'لماذا يفيد'),
    ('المنظمةمن', 'المنظمة من'),
    ('وجودكود', 'وجود كود'),
    ('علاقةمتعدد', 'علاقة متعدد'),
    ('يتطلب تغيير اسم مقرران يتمتعديله', 'يتطلب تغيير اسم مقرر أن يتم تعديله'),
    ('رئيسياللجدول', 'رئيسيا للجدول'),
    ('وجدولالطلاب', 'وجدول الطلاب'),
    ('منالطلاب', 'من الطلاب'),
]


_LATIN_RUN = re.compile(r'(?:[A-Za-z][A-Za-z0-9_.]*\s+)[A-Za-z][A-Za-z0-9_.]*')


def _flip_latin(m):
    w = m.group(0).split()
    return ' '.join(reversed(w)) if len(w) > 1 else m.group(0)


def fix_db(s):
    s = fix(s or '')
    s = re.sub(r'\bص\s*\d{1,3}\.\s*', '', s)                  # stray page refs
    s = re.sub(r'(?<=[A-Za-z0-9_\)])(?=[\u0621-\u064a])', ' ', s)
    s = re.sub(r'(?<=[\u0621-\u064a])(?=[A-Za-z0-9])', ' ', s)
    for a, b in DB_GLUE:
        s = s.replace(a, b)
    s = _LATIN_RUN.sub(_flip_latin, s)                            # bidi-reversed latin runs
    # reversed brackets in this file:  ") 1: M (" -> " (1: M) "
    s = re.sub(r'\)\s*(»[^«]{0,90}«)\s*\(', lambda m: ' (%s) ' % m.group(1).strip(), s)
    s = re.sub(r'\)\s*([^()]{1,14}?)\s*\(', lambda m: ' (%s) ' % m.group(1).strip(), s)
    s = re.sub(r'\s+([،.:؟!])', r'\1', s)
    s = re.sub(r'(?<=[،؛])(?=[\u0621-\u064a])', ' ', s)
    for a, b in DB_OVERRIDE:
        s = s.replace(a, b)
    s = re.sub(r'\s+', ' ', s).strip()
    s = re.sub(r'^[\s\.،]+', '', s)
    return s


DB_OVERRIDE = [
    ('SQL Server Microsoft', 'Microsoft SQL Server'),
    ('(Foreign Key (هو عمود أو صفة) أو أكثر)', '(Foreign Key) هو عمود أو صفة (أو أكثر)'),
]


# ---------------------------------------------------------------- databases
DB_OPT = re.compile(r'^([أبجد])\s*[\)(]\s*(.*)$')
DB_Q = re.compile(r'^(\d{1,3})\s*[\)(]\s*(.*)$')
DB_ANS = re.compile(r'^الإجاة\s*\)?\s*([أابجد])\s*\)?')


def parse_db(path):
    doc = pymupdf.open(path)
    mcq, tf = [], []
    section = ''
    cur = None

    def flush():
        nonlocal cur
        if not cur:
            return
        if cur['type'] == 'mcq':
            opts = [cur['options'].get(k, '').strip() for k in 'أبجد']
            while opts and not opts[-1]:          # some items only have أ/ب/ج
                opts.pop()
            if len(opts) >= 2 and cur['ans'] is not None and cur['ans'] < len(opts):
                mcq.append({'q': fix_db(_join(cur['stem'])), 'options': [fix_db(o) for o in opts],
                            'ans': cur['ans'], 'section': cur['section'],
                            'xmax': cur['xmax']})
        elif cur.get('ans') is not None:
            tf.append({'q': fix_db(_join(cur['stem'])), 'ans': cur['ans'],
                       'note': _tidy_note(fix_db(cur.get('note', ''))), 'section': cur['section']})
        cur = None

    for pno in range(len(doc)):
        for row in L.page_lines(doc, pno):
            t = row['text'].strip()
            if not t or re.match(r'^\d{1,2}$', t):
                continue
            if 'المحاضرة' in t and len(t) < 300:
                flush()
                h = t
                half = len(h) // 2
                if h[:half] == h[half:]:
                    h = h[:half]
                section = fix(dedupe(h))
                continue
            if re.match(r'^المجموع', t):
                continue
            m = DB_Q.match(t)
            if m and not re.match(r'^[أبجد]', t):
                flush()
                stem = m.group(2)
                cur = {'type': 'tf', 'stem': [], 'ans': None, 'note': '',
                       'section': section}
                _db_tf_feed(cur, stem)
                if cur.get('ans') is not None:
                    flush()
                continue
            if cur is None:
                continue
            if cur['type'] == 'tf' and DB_OPT.match(t) and cur.get('ans') is None:
                cur['type'] = 'mcq'
                cur['options'] = {}
                cur['xmax'] = {}
            if cur['type'] == 'mcq':
                if re.match(r'^الإجاة', t):
                    mm = DB_ANS.match(t)
                    if mm:
                        L2 = 'أ' if mm.group(1) == 'ا' else mm.group(1)
                        cur['ans'] = 'أبجد'.index(L2)
                    flush()
                    continue
                mo = DB_OPT.match(t)
                if mo:
                    opts_add(cur, mo.group(1), mo.group(2), row)
                    continue
                if re.match(r'^شكل\s*\d', t):
                    continue
                if cur['options']:
                    x1 = max(u[1] for u in row['units'])
                    c = min(cur['xmax'], key=lambda k: abs(cur['xmax'][k] - x1))
                    cur['options'][c] += ' ' + t
                elif len(t) < 8:
                    continue
                continue
            _db_tf_feed(cur, t)
            if cur.get('ans') is not None:
                flush()
    flush()
    return mcq, tf


def opts_add(cur, letter, txt, row):
    cur['options'][letter] = txt
    cur['xmax'][letter] = max(u[1] for u in row['units'])


def _db_tf_feed(cur, text):
    if cur.get('ans') is not None:
        cur['note'] = (cur.get('note') or '') + ' ' + text
        return
    m = re.search(r'[\(\)]\s*(صواب|خطأ)\s*[\(\)]', text)
    if m:
        cur['ans'] = m.group(1) == 'صواب'
        before, rest = text[:m.start()], text[m.end():]
        cur['stem'].append(before)
        rest = _drop_repeat(before, rest)
        if rest.strip(' .'):
            cur['note'] = (cur.get('note') or '') + ' ' + rest
        return
    cur['stem'].append(text)
