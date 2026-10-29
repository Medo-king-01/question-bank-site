# -*- coding: utf-8 -*-
"""Final text/answer repairs applied to every course right before data.json is written.

Two layers:
  1. generic rules  -> reversed RTL parentheses, split definite article ("ال برنامج"),
     Latin abbreviations ("ال DBMS" -> "الـ DBMS"), glued words.
  2. targeted fixes -> the handful of places where the PDF text is genuinely corrupted
     (a stray figure caption inside an option, two T/F statements merged ...).

Everything here is a plain string/regex substitution, so it is idempotent and safe to
re-run: `python3 make_data.py` always produces the same output.
"""
import re

AR = '\u0621-\u064a'

# ----------------------------------------------------------------- generic rules
LAT_ABBR = [('ال DBMS', 'الـ DBMS'), ('ال SQL', 'الـ SQL'), ('ال ERD', 'الـ ERD')]

GLUED = [
    ('ال يعتبر', 'لا يعتبر'),
    ('ال شىء', 'لا شيء'),
    ('ال خصم', 'الخصم'),
    ('ال برنامج', 'البرنامج'),
    ('ال حل', 'الحل'),
    ('ال نظام', 'النظام'),
    ('لل نظام', 'للنظام'),
    ('لل توقف', 'للتوقف'),
    ('الوظيف ي', 'الوظيفي'),
    ('الرعاية ال ية', 'الرعاية الصحية'),
    ('استعمال ل الـ DBMS', 'استعمال الـ DBMS'),
    ('منالسجلاتالتالية', 'من السجلات التالية'),
    ('الذييخزن', 'الذي يخزن'),
    ('الذيي ُخزن', 'الذي يُخزن'),
    ('بهالرقم', 'به الرقم'),
    ('التعريفيللقسم', 'التعريفي للقسم'),
    ('خو ارزمية', 'خوارزمية'),
    ('قر اءة', 'قراءة'),
    ('ثلاثا عداد', 'ثلاث أعداد'),
    ('تخزينم جموع', 'تخزين مجموع'),
    ('الثلاثأ رقام', 'الثلاث أرقام'),
    ('مدخ لات', 'مدخلات'),
    ('علامة ال " = "', 'علامة "="'),
    ('حلقةل طباعة', 'حلقة طباعة'),
    ('وجودع لامة', 'وجود علامة'),
]

# order matters: run longest keys first
GLUED_SORTED = sorted(GLUED, key=lambda kv: -len(kv[0]))


def _rev_paren(s):
    """'وحدة المعالجة المركزية) CPU.'  ->  'وحدة المعالجة المركزية (CPU).'"""
    if s.count('(') == 0 and s.count(')') == 1:
        head, tail = s.split(')')
        tail = tail.strip()
        if head.strip() and tail and len(tail) <= 60 and not re.search(r'[()]', tail):
            core = tail.rstrip('.،؟!:')
            if core and re.search(r'[%sA-Za-z]' % AR, core):
                return '%s (%s)%s' % (head.rstrip(), core, tail[len(core):])
    return s


def _open_paren(s):
    """'... (Market Failure؟'  ->  '... (Market Failure)؟'"""
    if s.count('(') == 1 and s.count(')') == 0:
        m = re.match(r'^(.*\()([^()]*?)\s*([.؟!:،]?)$', s)
        if m and m.group(2).strip():
            return '%s%s)%s' % (m.group(1), m.group(2).rstrip(), m.group(3))
    return s


LATIN_FIX = [
    ('Life Work of Quality', 'Quality of Work Life'),
    ('Language Machine', 'Machine Language'),
    ('level - High', 'High-level'),
    ('Errors Syntax', 'Syntax Errors'),
    ('Errors Runtime', 'Runtime Errors'),
    ('Chart Flow', 'Flow Chart'),
    ('screen Touch', 'Touch screen'),
    ('Editor Text', 'Text Editor'),
    ('System Operating', 'Operating System'),
]


def _swap_paren_all(s):
    s = _swap_paren(s)
    # ") CPU ("  ->  " (CPU) "   (Arabic content is left alone: operators live there)
    return re.sub(r'\)\s*([A-Za-z][A-Za-z0-9 _/+=.-]*?)\s*\(', lambda m: ' (%s) ' % m.group(1).strip(), s)


def _swap_paren(s):
    """'برنامج) Quality of Work Life (يهدف'  ->  'برنامج (Quality of Work Life) يهدف'"""
    if s.count('(') == s.count(')') and s.count('(') >= 1 and s.index(')') < s.index('('):
        i, j = s.index(')'), s.index('(')
        return s[:i] + ' (' + s[i + 1:j].strip() + ') ' + s[j + 1:]
    return s


def _inner_space(s):
    """'(ع )' -> '(ع)'   'قيمة (خ )'"""
    s = re.sub(r'\(\s*([^()]{1,25}?)\s+\)', r'(\1)', s)
    s = re.sub(r'\(\s+', '(', s)
    return re.sub(r'\s+\)', ')', s)


def clean_text(s):
    if not isinstance(s, str) or not s.strip():
        return s
    orig = s
    s = re.sub(r'\s+', ' ', s).strip()
    for a, b in LAT_ABBR:
        s = s.replace(a, b)
    for _ in range(2):              # two passes: a short repair can unlock a longer one
        for a, b in GLUED_SORTED:
            s = s.replace(a, b)
    s = _rev_paren(s)
    s = _open_paren(s)
    s = _swap_paren_all(s)
    for a, b in LATIN_FIX:
        s = s.replace(a, b)
    s = _inner_space(s)
    s = re.sub(r'\s+([،.:؟!])', r'\1', s)
    s = re.sub(r'(?<=[،؛])(?=[%s])' % AR, ' ', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s if s != orig or True else s


# ------------------------------------------------------------- targeted repairs
# (course_id, index-1-based) -> {'q': str, 'options': [...], 'note': str}
TARGETED = {
    ('prog', 53): {'options/2': '3.'},
    ('prog', 54): {'q': 'فى شكل (1)، ما اسم المتغير الذي يتم تخزين مجموع الأرقام به .......'},
    ('prog', 55): {'q': 'فى شكل (1)، ما اسم المتغير الذي يتم تخزين متوسط الثلاث أرقام به .......'},
    ('prog', 56): {'q': 'فى شكل (1)، العملية (Sum/3 = Avg) تمثل عملية .......؟'},
    ('prog', 57): {'q': 'فى شكل (1)، ما قيمة المتغير Avg عندما تكون (A = 5, B = 10, C = 15)؟'},
    ('prog', 59): {'options/1': 'سعر القطعة الواحدة.'},
    ('prog', 60): {'q': 'فى شكل (2)، العملية (المبلغ الكلى = سعر القطعة × عدد القطع) تمثل عملية .......؟'},
    ('prog', 66): {'options/2': 'كلمة "راسب".'},
    ('prog', 67): {'q': 'في شكل (3)، إذا كان المدخل للبرنامج (- 60) فإن خرج البرنامج هو .......، '
                        'مع مراعاة أن (-) هي إشارة السالب:'},
    ('prog', 70): {'q': 'في شكل (3)، (الدرجة <= 50؟) تمثل .......؟',
                   'options/1': 'عملية حسابية.'},
    ('prog', 71): {'q': 'في شكل (3)، "اقرأ الدرجة" تمثل ....... في البرنامج؟'},
    ('prog', 72): {'q': 'في شكل (3)، "اعرض النتيجة" تمثل ....... في البرنامج؟'},
    ('prog', 16): {'options/2': 'المترجم (Compiler) أو المفسر (Interpreter).'},
    ('prog', 74): {'q': 'تعتمد الحلقة التكرارية داخل البرنامج على ثلاثة عناصر منطقية رئيسية هي:'},
}

# targeted repairs for true/false sections  (course_id, 1-based index in its tf section)
TARGETED_TF = {
    # (course, section id or None, 1-based index)
    ('prog', None, 22): {'q': 'فاتورة قيمتها (Total) 1000 جنيه لا تحصل على خصم إذا كان شرط الخصم '
                             '(Total >= 1000)؟'},
    ('macro', None, 19): {'q': 'تقوم الحكومة بالاقتراض (الداخلى والخارجى) عندما تكون النفقات المتوقعة '
                              'أقل من الإيرادات المتوقعة للعام القادم.'},
    # db: the printed correction after the mark is a fragment in these items
    ('db', 'tf-7', 5): {'note': ''},
    ('db', 'tf-7', 6): {'note': 'المفتاح الرئيسي Emp_id لا يتكرر'},
    ('db', 'tf-5', 3): {'note': 'المفتاح الأجنبي يوضع في الجدول الفرعي'},
    ('db', 'tf-5', 4): {'note': 'قيمة المفتاح الرئيسي فريدة ولا تتكرر'},
    ('db', 'tf-9', 6): {'note': 'لا يُرسم في مخطط ERD المفاهيمي'},
    ('db', 'tf-7', 2): {'note': 'تخزين النصوص مثل الأسماء'},
    ('db', 'tf-7', 4): {'note': 'يخزن قيماً فريدة لا تتكرر'},
    ('db', 'tf-3', 9): {'note': 'من أمثلة قواعد البيانات العلائقية'},
    ('db', 'tf-7', 8): {'note': 'علاقة متعدد إلى متعدد، فكل طلب يمكن أن يحتوي أكثر من منتج' },
}

# ---------------------------------------------------------------------------
# الاقتصاد الكلي — المفتاح الرسمي "نماذج الاجابات" (مصوّر من ملف د. المادة).
# الإجابة تُؤخذ من المفتاح حرفيًا كما هي، حتى لو خالفت الرأي العلمي،
# لأن الامتحان بيتصحّح على المفتاح ده.
#   أولا: MCQ 1..38  ->  أ ب ج ب ب د ب ج د أ ب ب ج د ب ج ب ج ب د أ ج ب
#                       ب د د ب د ج ج د ب أ ب د د ج أ
#   ثانيا: T/F 1..36 ->  ✓ X X ✓ X X X X X X X ✓ X ✓ ✓ ✓ ✓ X X ✓
#                       ✓ ✓ ✓ X ✓ X ✓ ✓ ✓ X ✓ X X X X X
MACRO_MCQ_KEY = list('أبجببدبجدأببجدبجبجبدأجببددبدججدبأبددجأ')  # 38 حرفًا — ترتيب 1..38
MACRO_TF_KEY = [True, False, False, True, False, False, False, False, False, False,
                False, True, False, True, True, True, True, False, False, True,
                True, True, True, False, True, False, True, True, True, False,
                True, False, False, False, False, False]

# prog T/F statements that refer to one of the three flow-chart figures
PROG_TF_FIG = {26: '1', 27: '2', 28: '3', 29: '3', 30: '3'}

# two macro T/F statements were printed on one line -- split them again
MACRO_TF_SPLIT_AT = 8          # 1-based index of the merged item
MACRO_TF_SPLIT_EXTRA = ('عند تقاطع خط 45 درجة مع دالة الاستهلاك يكون الدخل أكبر من الاستهلاك.', False)

INS_NUM_TF_SEC = 'tf-9'
INS_NUM_TF = {                 # insurance T/F with a broken formula in the stem
    5: {'q': 'عندما يكون التأمين دون الكفاية والوثيقة لا تخضع لقاعدة النسبية يكون: '
             'التعويض (ع) = الخسارة (خ) × [مبلغ التأمين (م) ÷ قيمة الشيء المؤمن عليه وقت تحقق الخطر (ق)].',
        'note': 'تخضع لقاعدة النسبية'},
}


def _apply_targeted(course):
    if course['id'] != 'prog':
        return
    flat = [(s, i + 1, q) for s in course['sections'] for i, q in enumerate(s['questions'])
            if s['type'] == 'mcq']
    for (cid, idx), patch in TARGETED.items():
        if cid != course['id'] or idx > len(flat):
            continue
        _, _, q = flat[idx - 1]
        for key, val in patch.items():
            if key.startswith('options/'):
                q['options'][int(key.split('/')[1])] = val
            else:
                q[key] = val


def _apply_targeted_tf(course):
    for s in course['sections']:
        if s['type'] != 'tf':
            continue
        for i, q in enumerate(s['questions'], 1):
            patch = (TARGETED_TF.get((course['id'], s['id'], i))
                     or TARGETED_TF.get((course['id'], None, i)))
            if patch:
                q.update(patch)


def apply(courses):
    for c in courses:
        _apply_targeted(c)

        # prog T/F figure references
        if c['id'] == 'prog':
            for s in c['sections']:
                if s['type'] != 'tf':
                    continue
                for i, q in enumerate(s['questions'], 1):
                    if i in PROG_TF_FIG:
                        q['fig'] = PROG_TF_FIG[i]

        # macro: re-split the two T/F statements that arrived on one line
        if c['id'] == 'macro':
            for s in c['sections']:
                if s['type'] != 'tf':
                    continue
                qs = s['questions']
                k = MACRO_TF_SPLIT_AT - 1
                if k < len(qs) and "صفر 9 عند تقاطع" in qs[k]['q']:
                    qs[k]['q'] = qs[k]['q'].split(' 9 ')[0].rstrip('.') + '.'
                    qs.insert(k + 1, {'q': MACRO_TF_SPLIT_EXTRA[0], 'ans': MACRO_TF_SPLIT_EXTRA[1],
                                      'note': ''})

        # insurance T/F formula stems
        if c['id'] == 'ins':
            for s in c['sections']:
                if s['id'] != INS_NUM_TF_SEC:
                    continue
                for i, q in enumerate(s['questions'], 1):
                    if i in INS_NUM_TF:
                        q.update(INS_NUM_TF[i])

        # (after any insertion, so 1-based indices stay valid)
        _apply_targeted_tf(c)

        # ---- macro: enforce the official answer key (verbatim from the PDF key sheet)
        if c['id'] == 'macro':
            for s in c['sections']:
                if s['type'] == 'mcq':
                    for i, q in enumerate(s['questions'], 1):
                        if i <= len(MACRO_MCQ_KEY):
                            q['ans'] = 'أبجد'.index(MACRO_MCQ_KEY[i - 1])
                elif s['type'] == 'tf':
                    for i, q in enumerate(s['questions'], 1):
                        if i <= len(MACRO_TF_KEY):
                            q['ans'] = MACRO_TF_KEY[i - 1]

        # generic text pass over everything
        for s in c['sections']:
            for q in s['questions']:
                q['q'] = clean_text(q['q'])
                if q.get('options'):
                    q['options'] = [clean_text(o) for o in q['options']]
                if q.get('note'):
                    q['note'] = clean_text(q['note'])
    return courses
