# -*- coding: utf-8 -*-
import sys, re, json
import paths  # noqa: F401  (repo-relative sys.path setup)
import pymupdf
import layout
import build as B
from manual import (ACC_MCQ, ACC_TF, GOV_MCQ, MAC_INSERT_Q18, MAC_TAIL, MAC_FIX_Q,
                    MAC_ANS, INV_INSERT_46)
from files import MAC
import ins as INS
import qa_patch

LETTERS = 'أبجد'


AR = '\u0621-\u064a'


def despace(s):
    """Join runs of single letters that the PDF justifies letter-by-letter."""
    toks = s.split(' ')
    out = []
    i = 0
    while i < len(toks):
        if len(toks[i]) == 1 and re.fullmatch('['+AR+']', toks[i]):
            j = i
            while j < len(toks) and len(toks[j]) == 1 and re.fullmatch('['+AR+']', toks[j]):
                j += 1
            if j - i >= 2:
                out.append(''.join(toks[i:j]))
                i = j
                continue
        tok = toks[i]
        if (len(tok) == 1 and re.fullmatch('['+AR+']', tok) and out
                and out[-1] and re.fullmatch('['+AR+']', out[-1][-1])):
            out[-1] = out[-1] + tok
            i += 1
            continue
        out.append(tok)
        i += 1
    return ' '.join(out)


def fix_figs(q):
    q = re.sub(r'\(\s*(\d{1,2})\s*\(', r'(\1) ', q)
    q = re.sub(r'\)\s*(\d{1,2})\s*\)', r' (\1)', q)
    q = re.sub(r'\s*\)\s*(\d{1,2})\s*\(', r' (\1) ', q)
    q = re.sub(r'\(\s*(\d{1,2})\s*\)', r'(\1)', q)
    q = re.sub(r'\(\s+', '(', q)
    q = re.sub(r'\s+\)', ')', q)
    q = re.sub(r'\)(?=[' + AR + r'])', ') ', q)
    q = re.sub(r'(?<=[' + AR + r'])\(', ' (', q)
    q = re.sub(r'\s+', ' ', q)
    return q


def fix_inv_tail(t):
    if not t:
        return ''
    if 'تراجع الاستثمار' in t:
        return 'ارتفاع معدل الفائدة الحقيقي يؤدي عادة إلى تراجع الاستثمار الإنتاجي.'
    t = re.sub(r'\s+', ' ', t).strip(' .،')
    if not t.endswith(('.', '؟', '!')):
        t += '.'
    return t


TEXT_FIXES = [
    ('0 = 2 Mod i', 'i Mod 2 = 0'),
    ('1 + i = i', 'i = i + 1'),
    ('15 =C ,B=10 , 5 =A', 'A = 5, B = 10, C = 15'),
    ('إ. جمالي', 'إجمالي'),
    ('عندماتركز', 'عندما تركز'),
    ('وقع فعلاهو', 'وقع فعلا هو'),
    ('النتيجةالسلوكية', 'النتائج السلوكية'),
    ('التوقعاتالسلوكية', 'التوقعات السلوكية'),
    ('تماًما', 'تمامًا'),
    ('غالًبا', 'غالبًا'),
    ('ارتباًطا', 'ارتباطًا'),
    ('قوًيا', 'قويًا'),
    ('استثماًرا', 'استثمارًا'),
    ('مالًيا', 'ماليًا'),
    ('نظراً', 'نظرًا'),
    ('أصاًسا', 'أساسًا'),
    ('أساًسا', 'أساسًا'),
    ('مهاراتهفقط', 'مهاراته فقط'),
    ('الت يليس', 'التي ليس'),
    ('قد قيدمن', 'قيود من'),
    ('قيودمن', 'قيود من'),
    ('جودةللجميع', 'جودة للجميع'),
    ('علىالمجتمع', 'على المجتمع'),
    ('منأبرز', 'من أبرز'),
    ('تطبيقال', 'تطبيق ال'),
    ('لايُساهمأبداً', 'لا يُساهم أبدًا'),
    ('شخصيتهالمهنيةأو', 'شخصيته المهنية أو'),
    ('المصلحةالفرديةللموظف', 'المصلحة الفردية للموظف'),
    ('كالغذء', 'كالغذاء'),
    ('الالتزامبأخلاقياتالعمل', 'الالتزام بأخلاقيات العمل'),
    ('مستوىالفرد', 'مستوى الفرد'),
    ('ف يتشكيل', 'في تشكيل'),
    ('و حدة', 'وحدة'),
    ('الحاسبو', 'الحاسب و'),
    ('ا نتقال', 'انتقال'),
    ('ت عد', 'تعد'),
    ('شك ل', 'شكل'),
    ('خطو ة', 'خطوة'),
    ('خطوة)', 'خطوة)'),
    ('كانالمدخلللبرنام ج', 'كان المدخل للبرنامج'),
    ('(- 0 6)', '(-60)'),
    ('ي تم فحص', 'يتم فحص'),
    ('لات حتوي', 'لا تحتوي'),
    ('لا ت حتوي', 'لا تحتوي'),
    ('الشفافية', 'الشفافية'),
    ('س عر', 'سعر'),
    ('ض رب', 'ضرب'),
    ('ق رار', 'قرار'),
    ('ال تنفيذ', 'التنفيذ'),
    ('ال ناتج', 'الناتج'),
    ('ال خرج', 'الخرج'),
    ('حقيقًيا', 'حقيقيًا'),
    ('إيجابًيا', 'إيجابيًا'),
    ('استثمارًا حقيقًيا', 'استثمارًا حقيقيًا'),
    ('انخفاضالعائد', 'انخفاض العائد'),
    ('يمثلاستثمارًا', 'يمثل استثمارًا'),
    ('الماليةبشكل', 'المالية بشكل'),
    ('منالآتي', 'من الآتي'),
    ('منالاستثمار', 'من الاستثمار'),
    ('شيءهو', 'شيء هو'),
    ('الهيكلالتنظيمي', 'الهيكل التنظيمي'),
    ('كانالمدخلللبرنامج', 'كان المدخل للبرنامج'),
    ('Basic Visual', 'Visual Basic'),
    ('تد فق', 'تدفق'),
    ('خرائط التد فق', 'خرائط التدفق'),
]


AR_RE = re.compile(r'[\u0621-\u064a]')
LAT_RE = re.compile(r'[A-Za-z][A-Za-z0-9+#\.\-]*')


def fix_latin_order(s):
    if AR_RE.search(s):
        return s
    words = s.split(' ')
    if len([w for w in words if LAT_RE.search(w)]) >= 2:
        return ' '.join(reversed(words))
    return s


def polish(s):
    for a, b in TEXT_FIXES:
        s = s.replace(a, b)
    s = re.sub(r'\s+([،.:؟!])', r'\1', s)
    s = re.sub(r'\)\s+،', ')،', s)
    s = re.sub(r'(?:\.\s*){4,}', ' ....... ', s)
    s = re.sub(r'^\.{1,3}\s*', '', s)
    s = re.sub(r'\s*\.{1,3}$', '', s)
    s = re.sub(r'\s+\.(?=\s|$)', '.', s)
    s = re.sub(r'(?<=[\u0621-\u064a])\d{1,2}$', '', s)
    s = re.sub(r'(?<=[\u0621-\u064a])\.(?=[\u0621-\u064a])', '. ', s)
    s = re.sub(r'\s+', ' ', s)
    qm = bool(re.search(r'[؟!]', s[-4:]))
    s = re.sub(r'[\s\)\(؟!]+$', '', s)
    dots = re.search(r'\.+$', s)
    if dots and len(dots.group(0)) <= 2:
        s = s[:dots.start()]
    if qm:
        s += '؟'
    elif s and not s.endswith(('.', '؟', '!')):
        s += '.'
    return s.strip()


def clean_q(s):
    s = re.sub(r'\s+', ' ', s or '').strip()
    s = re.sub(r'\s*\(\s*', ' (', s)
    s = re.sub(r'\s*\)\s*', ') ', s)
    s = re.sub(r'\s+([،.:؟!])', r'\1', s)
    s = re.sub(r'\s*\.\s*', '. ', s)
    s = re.sub(r'\s{2,}', ' ', s)
    s = despace(s)
    s = fix_figs(s)
    s = polish(s)
    s = fix_latin_order(s)
    return s.strip()


# ---------- MACRO true/false from glyph lines (pages 9-10)
def macro_tf():
    doc = pymupdf.open(MAC)
    items = []
    cur = None
    for pno in (8, 9):
        for t in layout.text_of(doc, pno, sep_gap=8):
            t = B.mac_fix(t)
            if 'خاطئة' in t:
                continue
            mark = None
            if '✓' in t:
                mark = True
            if '✗' in t:
                mark = False
            body = re.sub(r'[✓✗]', '', t).strip()
            m = re.match(r'^(\d{1,2})\s*(.*)$', body)
            if m and (m.group(1).isdigit() and int(m.group(1)) <= 40 and len(m.group(2)) > 3):
                cur = {'q': re.sub(r'\s+\d{1,2}$', '', m.group(2)), 'ans': mark}
                items.append(cur)
                continue
            if cur is None:
                continue
            if not body:
                if mark is not None and cur['ans'] is None:
                    cur['ans'] = mark
                continue
            cur['q'] = (cur['q'] + ' ' + body).strip()
            if mark is not None and cur['ans'] is None:
                cur['ans'] = mark
    return items


def build_all():
    courses = []

    # ---------------- ETHICS
    mcq, tf = B.parse_ethics()
    eth_mcq = [{'q': clean_q(m['q']), 'options': [clean_q(o) for o in m['options']],
                'ans': m['ans']} for m in mcq]
    eth_tf = [{'q': clean_q(t['q']), 'ans': t['ans']} for t in tf]
    courses.append({
        'id': 'ethics', 'title': 'أخلاقيات الأعمال والحوكمة', 'emoji': '⚖️',
        'color': '#7c3aed',
        'sections': [
            {'id': 'mcq', 'title': 'الأسئلة الموضوعية (اختيار من متعدد)', 'type': 'mcq', 'questions': eth_mcq},
            {'id': 'tf', 'title': 'أسئلة الصح والخطأ', 'type': 'tf', 'questions': eth_tf},
        ]})

    # ---------------- INVEST
    mcq, tf = B.parse_invest()
    inv_mcq = []
    for i, m in enumerate(mcq):
        q = re.sub(r'^أسئلة الميد تيرم أختر من بين الإجابات التالية:?\s*', '', m['q'] or '')
        q = clean_q(q)
        if not q:
            continue
        inv_mcq.append({'q': q, 'options': [clean_q(o) for o in m['options']], 'ans': m['ans']})
    inv_tf = []
    for i, t in enumerate(tf):
        q = clean_q(t['q'])
        if 'مؤشرات متداولة' in q:
            head, _, tail = q.partition('مؤشرات متداولة')
            inv_tf.append({'q': (head + 'مؤشرات متداولة.').strip(), 'ans': True})
            tail = tail.strip(' .،')
            tail = fix_inv_tail(tail)
            if tail:
                inv_tf.append({'q': tail, 'ans': True})
            continue
        inv_tf.append({'q': q, 'ans': t['ans']})
    courses.append({
        'id': 'invest', 'title': 'مبادئ الاستثمار', 'emoji': '📈', 'color': '#0ea5e9',
        'sections': [
            {'id': 'mcq', 'title': 'اختيار من متعدد', 'type': 'mcq', 'questions': inv_mcq},
            {'id': 'tf', 'title': 'صح أو خطأ', 'type': 'tf', 'questions': inv_tf},
        ]})

    # ---------------- ACCOUNTING
    acc_mcq = [{'q': q, 'options': o, 'ans': a} for q, o, a in ACC_MCQ]
    acc_tf = [{'q': q, 'ans': a} for q, a in ACC_TF]
    courses.append({
        'id': 'acct', 'title': 'محاسبة متوسطة (1)', 'emoji': '🧾', 'color': '#16a34a',
        'sections': [
            {'id': 'tf', 'title': 'السؤال الأول: صح أو خطأ', 'type': 'tf', 'questions': acc_tf},
            {'id': 'mcq', 'title': 'السؤال الثاني: اختر الإجابة الصحيحة', 'type': 'mcq', 'questions': acc_mcq},
        ]})

    # ---------------- PROGRAMMING
    items = B.parse_prog()
    prog_mcq, prog_tf = [], []
    for it in items:
        if it['type'] == 'mcq' and not it['options'] and it.get('ans') is not None:
            it['type'] = 'tf'
        q = clean_q(it['q'])
        q = re.sub(r'ص\s*و\s*ا\s*ب', 'صواب', q)
        q = re.sub(r'خ\s*ط\s*أ', 'خطأ', q)
        note = clean_q(it.get('note', ''))
        note = re.sub(r'ص\s*و\s*ا\s*ب', 'صواب', note)
        note = re.sub(r'خ\s*ط\s*أ', 'خطأ', note)
        if it['type'] == 'mcq' and it['options']:
            opts = []
            for k in LETTERS:
                v = clean_q(it['options'].get(k, ''))
                v = re.sub(r'\s*شكل\s*\(\d\)\s*', ' ', v).strip()
                if not v and k not in it['options']:
                    break
                opts.append(v)
            while opts and not opts[-1]:
                opts.pop()
            ans = it.get('ans')
            mfig = re.search(r'شكل\s*\((\d)\)', q)
            prog_mcq.append({'q': q, 'options': opts, 'ans': ans,
                             'section': it.get('section', ''),
                             'fig': mfig.group(1) if mfig else None})
        else:
            ans = it.get('ans')
            if ans is None:
                continue
            prog_tf.append({'q': q, 'ans': ans, 'note': note, 'section': it.get('section', '')})
    courses.append({
        'id': 'prog', 'title': 'تصميم برامج الحاسب الآلي', 'emoji': '💻', 'color': '#f59e0b',
        'sections': [
            {'id': 'mcq', 'title': 'اختيار من متعدد', 'type': 'mcq', 'questions': prog_mcq},
            {'id': 'tf', 'title': 'صح أو خطأ', 'type': 'tf', 'questions': prog_tf},
        ]})

    # ---------------- MACRO
    m, _ = B.parse_macro3()
    mac_items = []
    for i, x in enumerate(m):
        mac_items.append({'q': clean_q(x['q']), 'options': [clean_q(o) for o in x['options']]})
    # insert missing source Q18 after the 18th parsed question
    ins = {'q': MAC_INSERT_Q18[0], 'options': MAC_INSERT_Q18[1]}
    mac_items = mac_items[:18] + [ins] + mac_items[18:]
    mac_items = mac_items + [{'q': q, 'options': o} for q, o, a in MAC_TAIL]
    for num, (q, opts) in MAC_FIX_Q.items():
        if num - 1 < len(mac_items):
            mac_items[num - 1] = {'q': q, 'options': opts}
    for i, x in enumerate(mac_items):
        x['ans'] = MAC_ANS[i] if i < len(MAC_ANS) else None
    mtf = macro_tf()
    mac_tf = [{'q': clean_q(x['q']), 'ans': x['ans']} for x in mtf if x.get('ans') is not None]
    courses.append({
        'id': 'macro', 'title': 'الاقتصاد الكلي', 'emoji': '📊', 'color': '#ef4444',
        'sections': [
            {'id': 'mcq', 'title': 'أولًا: اختيار الإجابة الصحيحة', 'type': 'mcq', 'questions': mac_items},
            {'id': 'tf', 'title': 'ثانيًا: صح أو خطأ', 'type': 'tf', 'questions': mac_tf},
        ]})

    # ---------------- GOVERNMENT SERVICES
    gov = [{'q': q, 'options': o, 'ans': a} for q, o, a in GOV_MCQ]
    courses.append({
        'id': 'gov', 'title': 'اقتصاديات الخدمات الحكومية', 'emoji': '🏛️', 'color': '#0d9488',
        'sections': [
            {'id': 'mcq', 'title': 'اختيار الإجابة المناسبة', 'type': 'mcq', 'questions': gov},
        ]})

    # ---------------- INSURANCE & RISK MANAGEMENT
    ins_mcq, ins_tf, _bad = INS.parse_insurance(
        paths.PDFS + '/بنك أسئلة التأمين وإدارة -منتصف الفصل الدراسي 2027-2026.pdf')
    ins_secs = []
    _order, _by = [], {}
    for item in ins_mcq + ins_tf:
        sec = item.get('section') or 'عام'
        if sec not in _by:
            _by[sec] = {'mcq': [], 'tf': []}
            _order.append(sec)
        _by[sec]['mcq' if 'options' in item else 'tf'].append(item)
    for sec in _order:
        g = _by[sec]
        for key, typ, title in (('mcq', 'mcq', 'اختيار من متعدد'),
                                ('tf', 'tf', 'صح أو خطأ')):
            if g[key]:
                ins_secs.append({'id': '%s-%d' % (key, len(ins_secs)), 'type': typ,
                                 'title': '%s — %s' % (sec.replace('&', 'و'), title), 'questions': g[key]})
    courses.append({'id': 'ins', 'title': 'التأمين وإدارة الخطر', 'emoji': '🛡️',
                    'color': '#0284c7', 'sections': ins_secs, 'raw': True})

    # ---------------- DATABASES
    db_mcq, db_tf = INS.parse_db(paths.PDFS + '/بنك أسئلة مقرر قواعد البيانات  short.pdf')
    for q in db_mcq + db_tf:
        if re.search(r'شكل\s*1', q['q']):
            q['fig'] = 'db1'
    db_secs = []
    d_order, d_by = [], {}
    for item in db_mcq + db_tf:
        sec = item.get('section') or 'عام'
        if sec not in d_by:
            d_by[sec] = {'mcq': [], 'tf': []}
            d_order.append(sec)
        d_by[sec]['mcq' if 'options' in item else 'tf'].append(item)
    for sec in d_order:
        g = d_by[sec]
        for key, typ, title in (('mcq', 'mcq', 'اختيار من متعدد'),
                                ('tf', 'tf', 'صح أو خطأ')):
            if g[key]:
                db_secs.append({'id': '%s-%d' % (key, len(db_secs)), 'type': typ,
                                'title': '%s — %s' % (sec.replace('&', 'و'), title), 'questions': g[key]})
    courses.append({'id': 'db', 'title': 'قواعد البيانات', 'emoji': '🗄️',
                    'color': '#4338ca', 'sections': db_secs, 'raw': True})

    for c in courses:
        if c.get('raw'):
            for sec in c['sections']:
                for item in sec['questions']:
                    item['q'] = (item['q'] or '').strip()
                    if item.get('options'):
                        item['options'] = [(o or '').strip() for o in item['options']]
                    if item.get('note'):
                        item['note'] = item['note'].strip()
            continue
        for sec in c['sections']:
            for item in sec['questions']:
                item['q'] = clean_q(item['q'])
                if item.get('options'):
                    item['options'] = [clean_q(o) for o in item['options']]
                if item.get('note'):
                    item['note'] = clean_q(item['note'])
    qa_patch.apply(courses)
    return courses


if __name__ == '__main__':
    courses = build_all()
    tot = 0
    for c in courses:
        n = sum(len(s['questions']) for s in c['sections'])
        tot += n
        print(f"{c['title']}: " + ', '.join(f"{s['title']}={len(s['questions'])}" for s in c['sections']), f"| total {n}")
        for s in c['sections']:
            for q in s['questions']:
                if q.get('ans') is None:
                    print('   MISSING ANS:', c['id'], s['id'], q['q'][:60])
                if s['type'] == 'mcq' and any(not o for o in q['options']):
                    print('   EMPTY OPT:', c['id'], q['q'][:60])
    print('TOTAL', tot)
    with open(paths.DATA, 'w') as f:
        json.dump(courses, f, ensure_ascii=False, indent=1)
