import glob
def find(key):
    g = glob.glob(paths.PDFS + '/*.pdf')
    for f in g:
        if key in f:
            return f
    raise KeyError(key)
ETH = find('أخلاقيات')
INV = find('الاستثمار')
PRG = find('تصميم')
MAC = find('اقتصاد كلى')
ACC = find('محاسبة')
GOV = find('الخدمات الحكومية')
ALL = [('ethics', ETH, 'أخلاقيات الأعمال والحوكمة'), ('invest', INV, 'مبادئ الاستثمار'),
       ('acct', ACC, 'محاسبة متوسطة (1)'), ('prog', PRG, 'تصميم برامج الحاسب الآلي'),
       ('macro', MAC, 'الاقتصاد الكلي'), ('gov', GOV, 'اقتصاديات الخدمات الحكومية')]
