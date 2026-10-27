# Kabul testi veri üreticisi: iki bağımsız TEST kafe, 30 gün (28 Eylül – 27 Ekim 2026), gerçekçi tüketim.
# Çıktı: test/kabul/cikti/plan.json (uygulamaya girilecek olaylar) + kasa dosyaları + e-faturalar.
# Bağımsız hesap defteri ayrı dosyada (defter.py) yalnız plan.json'dan hesaplanır; uygulamanın kodunu kullanmaz.
import json, os, random, zipfile, datetime as dt
from xml.sax.saxutils import escape

BURA = os.path.dirname(os.path.abspath(__file__))
CIKTI = os.path.join(BURA, 'cikti')
os.makedirs(os.path.join(CIKTI, 'pos'), exist_ok=True); os.makedirs(os.path.join(CIKTI, 'efatura'), exist_ok=True)
random.seed(20261028)
GUN0 = dt.date(2026, 9, 27)                      # açılış sayımı (kapanış) günü
G = lambda n: GUN0 + dt.timedelta(days=n)        # gün 1 = 28 Eylül … gün 30 = 27 Ekim
iso = lambda n: G(n).isoformat()

# ---------------- Malzemeler (birim: g / ml / adet; fiyat: kg / litre / adet, KDV dahil) ----------------
MALZ_A = [('ESP', 'Espresso çekirdeği', 'g', 1200), ('FIL', 'Filtre kahve', 'g', 900), ('SUT', 'Süt (tam yağlı)', 'ml', 45),
          ('LAK', 'Laktozsuz süt', 'ml', 58), ('YUL', 'Yulaf sütü', 'ml', 110), ('BAD', 'Badem sütü', 'ml', 130),
          ('KAR', 'Karamel şurubu', 'ml', 640), ('VAN', 'Vanilya şurubu', 'ml', 640), ('FIN', 'Fındık şurubu', 'ml', 640),
          ('CIK', 'Çikolata sosu', 'ml', 520), ('BCK', 'Beyaz çikolata sosu', 'ml', 560), ('KRM', 'Krema', 'ml', 160),
          ('B08', 'Bardak 8 oz', 'adet', 2.4), ('B12', 'Bardak 12 oz', 'adet', 2.9), ('B16', 'Bardak 16 oz', 'adet', 3.4),
          ('KAP', 'Kapak', 'adet', 1.1)]
MALZ_B = [('ESP', 'Espresso çekirdeği', 'g', 1150), ('SUT', 'Süt (tam yağlı)', 'ml', 44), ('YUL', 'Yulaf sütü', 'ml', 105),
          ('KAR', 'Karamel şurubu', 'ml', 620), ('CAY', 'Siyah çay', 'g', 420), ('B12', 'Bardak 12 oz', 'adet', 2.8),
          ('KAP', 'Kapak', 'adet', 1.0)]

def latte(sut, b, s='SUT', ek=None):
    r = {'ESP': 18, s: sut, b: 1, 'KAP': 1}
    if ek: r.update(ek)
    return r
URUN_A = {   # ad → reçete; (fiyat TL, günlük ortalama)
    'Espresso': ({'ESP': 18, 'B08': 1}, 90, 8), 'Double Espresso': ({'ESP': 36, 'B08': 1}, 110, 3),
    'Americano Küçük': ({'ESP': 18, 'B12': 1, 'KAP': 1}, 110, 9), 'Americano Büyük': ({'ESP': 36, 'B16': 1, 'KAP': 1}, 135, 7),
    'Latte Küçük': (latte(200, 'B12'), 135, 14), 'Latte Büyük': (latte(300, 'B16'), 160, 11),
    'Cappuccino Küçük': (latte(150, 'B12'), 130, 10), 'Cappuccino Büyük': (latte(220, 'B16'), 155, 6),
    'Flat White': (latte(130, 'B08'), 140, 5), 'Cortado': ({'ESP': 18, 'SUT': 60, 'B08': 1}, 120, 3),
    'Karamel Latte Küçük': (latte(200, 'B12', ek={'KAR': 20}), 160, 6), 'Karamel Latte Büyük': (latte(280, 'B16', ek={'KAR': 30}), 185, 5),
    'Vanilya Latte Küçük': (latte(200, 'B12', ek={'VAN': 20}), 160, 5), 'Vanilya Latte Büyük': (latte(280, 'B16', ek={'VAN': 30}), 185, 4),
    'Fındıklı Latte': (latte(250, 'B16', ek={'FIN': 25}), 175, 3),
    'Mocha Küçük': (latte(180, 'B12', ek={'CIK': 25}), 165, 4), 'Mocha Büyük': (latte(260, 'B16', ek={'CIK': 35, 'KRM': 20}), 190, 3),
    'Beyaz Mocha': (latte(250, 'B16', ek={'BCK': 30}), 185, 3), 'Yulaf Latte': (latte(250, 'B16', s='YUL'), 175, 4),
    'Badem Latte': (latte(250, 'B16', s='BAD'), 180, 2), 'Laktozsuz Latte': (latte(250, 'B16', s='LAK'), 170, 3),
    'Filtre Kahve Küçük': ({'FIL': 15, 'B12': 1, 'KAP': 1}, 95, 8), 'Filtre Kahve Büyük': ({'FIL': 22, 'B16': 1, 'KAP': 1}, 115, 6),
    'Sıcak Çikolata': (None, 150, 3),           # menüde, reçetesi girilmemiş (uyarı beklenir)
}
URUN_B = {
    'Espresso': ({'ESP': 18}, 85, 6), 'Americano': ({'ESP': 18, 'B12': 1, 'KAP': 1}, 105, 10),
    'Latte': ({'ESP': 18, 'SUT': 220, 'B12': 1, 'KAP': 1}, 130, 14), 'Yulaf Latte': ({'ESP': 18, 'YUL': 220, 'B12': 1, 'KAP': 1}, 160, 4),
    'Karamel Latte': ({'ESP': 18, 'SUT': 220, 'KAR': 20, 'B12': 1, 'KAP': 1}, 155, 6), 'Çay': ({'CAY': 3}, 40, 25),
}
# Senaryo S11: Latte Büyük reçetesi gün 17'den (14 Ekim) itibaren 300 → 270 ml süt
RECETE_SURUM = {('A', 'Latte Büyük'): [(17, latte(270, 'B16'))]}
KAPALI = {9}                                       # gün 9 (6 Ekim) A kafe kapalı: satış yok

def gunluk_satis(kafe, d):
    urunler = URUN_A if kafe == 'A' else URUN_B
    if kafe == 'A' and d in KAPALI: return {}
    hd = G(d).weekday()
    k = {5: 1.55, 6: 1.7, 0: 0.75}.get(hd, 1.0) * (0.65 if kafe == 'A' else 1.0)   # cumartesi/pazar yoğun, pazartesi sakin
    s = {u: max(0, round(o * k * random.uniform(0.7, 1.3))) for u, (_, _, o) in urunler.items()}
    if kafe == 'A' and d >= 25: s['Badem Latte'] = 0          # S16: badem sütü menüden kalktı (gün 25'te pasife alınır)
    return s
SATIS = {k: {d: gunluk_satis(k, d) for d in range(1, 31)} for k in 'AB'}

# ---------------- Faturalar (barista mal kabulü) ----------------
TED_A = {'KAH': ('TEST Kahve Dağıtım Ltd. Şti.', '1111111111'), 'SUT': ('TEST Süt ve Gıda A.Ş.', '2222222222'),
         'AMB': ('TEST Ambalaj ve Şurup San. Tic. Ltd.', '3333333333')}
TED_B = {'KAH': ('TEST Kahve Dağıtım Ltd. Şti.', '1111111111'), 'SUT': ('TEST Süt ve Gıda A.Ş.', '2222222222')}
# satır: (metin, miktar, belge birimi, malzeme|None, çarpan, birim fiyat (dahil, belge birimi), gelen|None=faturadaki,
#         barista kararı: 'tam' | 'farkli' | 'degil' (bu ürün X değil))
def f(gun, ted, no, satirlar, yukleme=None, teslim=None, kafe='A', not_=None):
    return dict(kafe=kafe, gun=gun, ted=ted, no=no, satirlar=satirlar, yukleme=yukleme or gun, teslim=teslim, not_=not_)
FATURA = [
    # A: süt her 3 günde (10 teslimat), kahve haftalık, ambalaj/şurup iki kez
    *[f(d, 'SUT', f'TSG-{d:03d}', [('Tam Yağlı Süt 1 L (12li koli)', 3, 'diger', 'SUT', 12000, 540, None, 'tam'),
                                   ('Laktozsuz Süt 1 L', 2, 'adet', 'LAK', 1000, 58, None, 'tam'),
                                   ('Yulaf İçeceği 1 L', 3, 'adet', 'YUL', 1000, 110, None, 'tam'),
                                   *([('Badem İçeceği 1 L', 2, 'adet', 'BAD', 1000, 130, None, 'tam')] if d < 22 else []),
                                   *([('Krema 1 L', 1, 'adet', 'KRM', 1000, 160, None, 'tam')] if d % 2 else [])])
      for d in (1, 4, 7, 10, 13, 19, 22, 25, 28)],
    # S9: aynı gün iki süt teslimatı (gün 18) + gün 18'de dar süt sayımı
    f(18, 'SUT', 'TSG-018A', [('Tam Yağlı Süt 1 L (12li koli)', 3, 'diger', 'SUT', 12000, 540, None, 'tam')]),
    f(18, 'SUT', 'TSG-018B', [('Tam Yağlı Süt 1 L (12li koli)', 1, 'diger', 'SUT', 12000, 540, None, 'tam'),
                              ('Laktozsuz Süt 1 L', 2, 'adet', 'LAK', 1000, 58, None, 'tam')]),
    # S1: faturada 10 kg, gelen 9,6 kg (barista "Farklı geldi" der, sayar)
    f(5, 'KAH', 'TKD-2026-0105', [('Espresso Çekirdek 1 kg', 10, 'adet', 'ESP', 1000, 1200, 9.6, 'farkli'),
                                   ('Filtre Kahve 1 kg', 3, 'adet', 'FIL', 1000, 900, None, 'tam')]),
    f(12, 'KAH', 'TKD-2026-0112', [('Espresso Çekirdek 1 kg', 12, 'adet', 'ESP', 1000, 1200, None, 'tam'),
                                    ('Filtre Kahve 1 kg', 2, 'adet', 'FIL', 1000, 900, None, 'tam')]),
    # S12: fiyat ay ortasında artar (1.200 → 1.350 TL/kg)
    f(19, 'KAH', 'TKD-2026-0119', [('Espresso Çekirdek 1 kg', 12, 'adet', 'ESP', 1000, 1350, None, 'tam'),
                                    ('Filtre Kahve 1 kg', 2, 'adet', 'FIL', 1000, 950, None, 'tam')]),
    # S8: hafta kapandıktan sonra (gün 28 sayımı) gelen geçmiş tarihli belge: mal gün 26'da geldi, fatura gün 30'da yüklendi
    f(26, 'KAH', 'TKD-2026-0126', [('Espresso Çekirdek 1 kg', 10, 'adet', 'ESP', 1000, 1350, None, 'tam'),
                                    ('Filtre Kahve 1 kg', 2, 'adet', 'FIL', 1000, 950, None, 'tam')], yukleme=30, teslim=26),
    # S3/S4/S5: fazla teslimat (1000 yerine 1050), yanlış ürün ("Bu ürün X değil"), teslim alınmayan (0)
    f(3, 'AMB', 'TAS-26-0003', [('Karton Bardak 8 oz (1000li koli)', 1, 'diger', 'B08', 1000, 2400, None, 'tam'),
                                ('Karton Bardak 12 oz (1000li koli)', 2, 'diger', 'B12', 1000, 2900, None, 'tam'),
                                ('Karton Bardak 16 oz (1000li koli)', 2, 'diger', 'B16', 1000, 3400, None, 'tam'),
                                ('Kapak (1000li koli)', 4, 'diger', 'KAP', 1000, 1100, None, 'tam'),
                                ('Karamel Şurup 700 ml', 4, 'adet', 'KAR', 700, 448, None, 'tam'),
                                ('Vanilya Şurup 700 ml', 4, 'adet', 'VAN', 700, 448, None, 'tam'),
                                ('Fındık Şurup 700 ml', 2, 'adet', 'FIN', 700, 448, None, 'tam'),
                                ('Çikolata Sos 1 L', 3, 'adet', 'CIK', 1000, 520, None, 'tam'),
                                ('Beyaz Çikolata Sos 1 L', 2, 'adet', 'BCK', 1000, 560, None, 'tam')]),
    f(16, 'AMB', 'TAS-26-0016', [('Karton Bardak 12 oz (1000li koli)', 1, 'diger', 'B12', 1000, 2900, 1.05, 'farkli'),
                                 ('Karton Bardak 16 oz (1000li koli)', 1, 'diger', 'B16', 1000, 3400, 0, 'farkli'),
                                 ('Kapak (1000li koli)', 2, 'diger', 'KAP', 1000, 1100, None, 'tam'),
                                 ('Pipet (500lü)', 2, 'adet', 'KAP', 500, 85, None, 'degil'),
                                 ('Karamel Şurup 700 ml', 3, 'adet', 'KAR', 700, 448, None, 'tam'),
                                 ('Vanilya Şurup 700 ml', 3, 'adet', 'VAN', 700, 448, None, 'tam'),
                                 ('Çikolata Sos 1 L', 2, 'adet', 'CIK', 1000, 520, None, 'tam')]),
    # S6/S7: mal gün 21'de geldi (hafta kapanışı gün 21), fatura gün 23'te yüklendi; patron teslim gününü düzeltir
    f(21, 'SUT', 'TSG-021', [('Tam Yağlı Süt 1 L (12li koli)', 3, 'diger', 'SUT', 12000, 540, None, 'tam')], yukleme=23, teslim=21),
    # B kafe: iki tedarikçi, temiz
    *[f(d, 'SUT', f'TSG-B{d:03d}', [('Tam Yağlı Süt 1 L (12li koli)', 2, 'diger', 'SUT', 12000, 528, None, 'tam'),
                                    ('Yulaf İçeceği 1 L', 5, 'adet', 'YUL', 1000, 105, None, 'tam')], kafe='B')
      for d in (2, 6, 10, 14, 18, 22, 26)],
    *[f(d, 'KAH', f'TKD-B{d:03d}', [('Espresso Çekirdek 1 kg', 6, 'adet', 'ESP', 1000, 1150, None, 'tam'),
                                    ('Siyah Çay 1 kg', 1, 'adet', 'CAY', 1000, 420, None, 'tam'),
                                    ('Karamel Şurup 700 ml', 2, 'adet', 'KAR', 700, 434, None, 'tam'),
                                    ('Karton Bardak 12 oz (1000li koli)', 1, 'diger', 'B12', 1000, 2800, None, 'tam'),
                                    ('Kapak (1000li koli)', 1, 'diger', 'KAP', 1000, 1000, None, 'tam')], kafe='B')
      for d in (1, 8, 15, 22)],
]
# S2: eksik kalan 0,4 kg espresso gün 8'de faturasız geldi (barista "Mal geldi → faturasız"); patron farkı "sonraki teslimatta geldi" kapatır
ELLE = [dict(kafe='A', gun=8, aciklama='TEST Kahve Dağıtım — 5 Ekim faturasının eksiği', kalemler=[('ESP', 400)])]

# ---------------- Fire ----------------
FIRE = [  # (kafe, gün, neden, {'malzeme': kod, 'miktar'} | {'urun': ad, 'miktar'}, iptal edilecek mi)
    ('A', 2, 'Döküldü', {'malzeme': 'SUT', 'miktar': 1000}, False), ('A', 6, 'Değirmen ayarı', {'malzeme': 'ESP', 'miktar': 60}, False),
    ('A', 11, 'Yanlış yapıldı', {'urun': 'Latte Büyük', 'miktar': 2}, False),     # S13: ürün firesi …
    ('A', 11, 'Bozuldu', {'malzeme': 'KRM', 'miktar': 500}, False),               # … ve malzeme firesi aynı dönemde
    ('A', 15, 'Döküldü', {'malzeme': 'YUL', 'miktar': 300}, False), ('A', 20, 'Yanlış yapıldı', {'urun': 'Mocha Küçük', 'miktar': 1}, False),
    ('A', 24, 'Döküldü', {'malzeme': 'SUT', 'miktar': 2000}, True),               # S15: yanlışlıkla girildi, patron iptal eder
    ('A', 27, 'Değirmen ayarı', {'malzeme': 'ESP', 'miktar': 50}, False),
    ('B', 5, 'Döküldü', {'malzeme': 'SUT', 'miktar': 500}, False), ('B', 19, 'Yanlış yapıldı', {'urun': 'Latte', 'miktar': 1}, False),
]
# Kayıt dışı kayıp (gömülü; uygulamaya GİRİLMEZ): yalnız A. (kafe, gün) → {malzeme: miktar}
GIZLI = {('A', d): {'SUT': 600} for d in range(8, 31)}
GIZLI.update({('A', d): {'SUT': 600, 'ESP': 40} for d in range(15, 22)})
# Sayımlar: gün 0 açılış, 7/14/21/28 haftalık, gün 18 dar süt sayımı (S9), gün 14'te Kapak 800 yerine 1.800 yazılır (S10)
SAYIM_GUNLERI = {'A': [0, 7, 14, 18, 21, 28], 'B': [0, 7, 14, 21, 28]}
ACILIS = {'A': {'ESP': 10000, 'FIL': 2500, 'SUT': 30000, 'LAK': 6000, 'YUL': 6000, 'BAD': 4000, 'KAR': 2100, 'VAN': 2100,
                'FIN': 1400, 'CIK': 2000, 'BCK': 1500, 'KRM': 1500, 'B08': 700, 'B12': 1500, 'B16': 1400, 'KAP': 2800},
          'B': {'ESP': 4000, 'SUT': 20000, 'YUL': 4000, 'KAR': 1400, 'CAY': 800, 'B12': 900, 'KAP': 900}}
YUV = {'g': 10, 'ml': 50, 'adet': 1}

plan = dict(gun0=iso(0), malz={'A': MALZ_A, 'B': MALZ_B},
            urun={'A': {u: dict(recete=r, fiyat=p) for u, (r, p, _) in URUN_A.items()}, 'B': {u: dict(recete=r, fiyat=p) for u, (r, p, _) in URUN_B.items()}},
            recete_surum=[dict(kafe=k, urun=u, gun=g, recete=r) for (k, u), l in RECETE_SURUM.items() for g, r in l],
            faturalar=[], elle=ELLE, fire=[dict(kafe=k, gun=g, neden=n, kalem=x, iptal=i) for k, g, n, x, i in FIRE],
            satis={}, sayim={}, kapali=sorted(KAPALI), ted={'A': TED_A, 'B': TED_B})

# ---------------- Fiziksel gerçek (gizli kayıp dahil) → sayımlar ----------------
def recete(kafe, u, d):
    r = (URUN_A if kafe == 'A' else URUN_B)[u][0]
    for (k, uu), l in RECETE_SURUM.items():
        if k == kafe and uu == u:
            for g, rr in l:
                if d >= g: r = rr
    return r or {}
def gelen(kafe, d):
    t = {}
    for x in FATURA:
        if x['kafe'] != kafe or (x['teslim'] or x['gun']) != d: continue
        for (_, q, _, mz, c, _, g, karar) in x['satirlar']:
            if karar == 'degil': continue
            t[mz] = t.get(mz, 0) + (q if g is None else g) * c
    for e in ELLE:
        if e['kafe'] == kafe and e['gun'] == d:
            for mz, q in e['kalemler']: t[mz] = t.get(mz, 0) + q
    return t
EKSI = []
for kafe in 'AB':
    malz = MALZ_A if kafe == 'A' else MALZ_B
    birim = {k: b for k, _, b, _ in malz}
    stok = dict(ACILIS[kafe]); sayimlar = {0: dict(stok)}
    for d in range(1, 31):
        for m, q in gelen(kafe, d).items(): stok[m] += q
        for u, a in SATIS[kafe][d].items():
            for m, q in recete(kafe, u, d).items(): stok[m] -= q * a
        for (k, g, _, x, iptal) in FIRE:
            if k != kafe or g != d or iptal: continue        # iptal edilen fire fiziksel değildi
            if 'malzeme' in x: stok[x['malzeme']] -= x['miktar']
            else:
                for m, q in recete(kafe, x['urun'], d).items(): stok[m] -= q * x['miktar']
        for m, q in GIZLI.get((kafe, d), {}).items(): stok[m] -= q
        if min(stok.values()) < 0: print(f'EKSİ STOK {kafe} gün {d}:', {m: round(v) for m, v in stok.items() if v < 0}); EKSI.append(1)
        if d in SAYIM_GUNLERI[kafe]:
            say = {m: round(v / YUV[birim[m]]) * YUV[birim[m]] for m, v in stok.items()}
            if kafe == 'A' and d == 18: say = {'SUT': say['SUT']}           # dar sayım: yalnız süt
            sayimlar[d] = say
    plan['sayim'][kafe] = sayimlar
    top = {}
    for d in range(1, 31):
        for u, a in SATIS[kafe][d].items():
            for m, q in recete(kafe, u, d).items(): top[m] = top.get(m, 0) + q * a
    print(kafe, 'günlük ort. tüketim', {m: round(v / 30) for m, v in top.items()})
    print(kafe, 'gün 30 fiziksel:', {m: round(v) for m, v in stok.items()})

# ---------------- Kasa raporları ----------------
def xlsx_yaz(yol, satirlar):
    paylasilan, idx = [], {}
    def s(v):
        if v not in idx: idx[v] = len(paylasilan); paylasilan.append(v)
        return idx[v]
    xml = []
    for r, satir in enumerate(satirlar, 1):
        h = []
        for c, v in enumerate(satir):
            if v is None or v == '': continue
            ref = f'{chr(65 + c)}{r}'
            h.append(f'<c r="{ref}"><v>{v}</v></c>' if isinstance(v, (int, float)) else f'<c r="{ref}" t="s"><v>{s(str(v))}</v></c>')
        xml.append(f'<row r="{r}">{"".join(h)}</row>')
    ct = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>'
    d = {'[Content_Types].xml': ct,
         '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
         'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Satışlar" sheetId="1" r:id="rId1"/></sheets></workbook>',
         'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>',
         'xl/worksheets/sheet1.xml': f'<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>{"".join(xml)}</sheetData></worksheet>',
         'xl/sharedStrings.xml': '<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + ''.join(f'<si><t>{escape(v)}</t></si>' for v in paylasilan) + '</sst>'}
    with zipfile.ZipFile(yol, 'w', zipfile.ZIP_DEFLATED) as z:
        for a, i in d.items(): z.writestr(a, i)
tl = lambda x: f'{x:,.2f}'.replace(',', 'X').replace('.', ',').replace('X', '.')
pos_satir_sayisi = 0
for kafe in 'AB':
    urunler = URUN_A if kafe == 'A' else URUN_B
    fis = 50000 if kafe == 'A' else 7000
    satirlar = []      # (gün, fiş, saat, ürün, adet, tutar, durum)
    for d in range(1, 31):
        havuz = [u for u, n in SATIS[kafe][d].items() for _ in range(n)]; random.shuffle(havuz)
        i = 0; fisler = []
        while i < len(havuz):
            n = min(random.choice([1, 1, 1, 2, 2, 3, 4]), len(havuz) - i); fisler.append(havuz[i:i + n]); i += n
        t0, t1 = 7 * 60 + 30, 22 * 60 + 30
        for j, fl in enumerate(fisler):
            fis += 1; t = int(t0 + (t1 - t0) * j / max(1, len(fisler)) + random.uniform(0, 4))
            saat = f'{t // 60:02d}:{t % 60:02d}:{random.randint(0, 59):02d}'
            say = {}
            for u in fl: say[u] = say.get(u, 0) + 1
            for u, a in say.items(): satirlar.append([d, str(fis), saat, u, a, a * urunler[u][1], 'Satış'])
            # S14: %1 hazırlanmadan iptal (satış + iptal, tüketim yok), %0,5 müşteriye verildikten sonra iade (tüketim var)
            r = random.random()
            if r < 0.01:
                u = random.choice(list(say)); satirlar.append([d, str(fis), saat, u, 1, urunler[u][1], 'Satış'])
                satirlar.append([d, str(fis), saat, u, 1, urunler[u][1], 'İptal'])
            elif r < 0.015:
                u = random.choice(list(say)); satirlar.append([d, str(fis), saat, u, 1, urunler[u][1], 'İade'])
        # Menüde olmayan ürün (su) kasada var: yok sayılmalı
        if kafe == 'A' and d not in KAPALI:
            fis += 1; satirlar.append([d, str(fis), '13:05:00', 'Su 0,5 L', random.randint(5, 15), 0, 'Satış'])
    pos_satir_sayisi += len(satirlar)
    plan['satis'][kafe] = satirlar
    # Dosyalar: A günlük XLSX (yükleme ertesi sabah), haftalık CSV (gün 22–28, gün 25–27 iki dosyada çakışır);
    #           B haftalık CSV, Windows-1254, farklı sütun adları
    dosyalar = []
    if kafe == 'A':
        for d in range(1, 22):
            if not any(x[0] == d for x in satirlar): continue      # kapalı gün: kasa raporu yok
            rows = [['TEST Kafe A — Satış Detay Raporu'], [G(d).strftime('%d.%m.%Y')], [],
                    ['Fiş No', 'Tarih', 'Saat', 'Ürün Adı', 'Adet', 'Tutar', 'Durum']]
            rows += [[x[1], G(x[0]).strftime('%d.%m.%Y'), x[2], x[3], x[4], x[5], x[6]] for x in satirlar if x[0] == d]
            ad = f'A-satis-{iso(d)}.xlsx'; xlsx_yaz(os.path.join(CIKTI, 'pos', ad), rows)
            dosyalar.append(dict(dosya=ad, gunler=[d], yukleme=d + 1 if d < 21 else d))
        for (g1, g2, yuk) in ((22, 27, 28), (25, 30, 30)):   # gün 25–27 iki dosyada (çakışma; mükerrer satır sayılmamalı)
            b = ['Fiş No;Tarih;Saat;Ürün Adı;Adet;Tutar;Durum']
            b += [f'{x[1]};{G(x[0]).strftime("%d.%m.%Y")};{x[2]};{x[3]};{x[4]};{tl(x[5])};{x[6]}' for x in satirlar if g1 <= x[0] <= g2]
            ad = f'A-satis-{iso(g1)}_{iso(g2)}.csv'
            open(os.path.join(CIKTI, 'pos', ad), 'w', encoding='utf-8-sig', newline='\r\n').write('\n'.join(b) + '\n')
            dosyalar.append(dict(dosya=ad, gunler=list(range(g1, g2 + 1)), yukleme=yuk))
    else:
        for g1 in (1, 8, 15, 22, 29):
            g2 = min(g1 + 6, 30)
            b = ['Adisyon No;İşlem Tarihi;Saat;Ürün;Miktar;Tutar;İşlem Tipi']
            b += [f'{x[1]};{G(x[0]).strftime("%d.%m.%Y")};{x[2][:5]};{x[3]};{x[4]},00;{tl(x[5])};{x[6].upper()}' for x in satirlar if g1 <= x[0] <= g2]
            ad = f'B-satis-{iso(g1)}_{iso(g2)}.csv'
            open(os.path.join(CIKTI, 'pos', ad), 'w', encoding='cp1254', newline='\r\n').write('\n'.join(b) + '\n')
            dosyalar.append(dict(dosya=ad, gunler=list(range(g1, g2 + 1)), yukleme=g2 if g2 < 30 else 30))
    plan.setdefault('pos', {})[kafe] = dosyalar
print('kasa satırı:', pos_satir_sayisi)
if EKSI: raise SystemExit('eksi stok var')

# ---------------- e-Faturalar (UBL, sade) ----------------
for x in FATURA:
    kafe, (ted, vkn) = x['kafe'], (TED_A if x['kafe'] == 'A' else TED_B)[x['ted']]
    kalem = ''.join(f'<cac:InvoiceLine><cbc:ID>{i}</cbc:ID><cbc:InvoicedQuantity unitCode="C62">{q}</cbc:InvoicedQuantity>'
                    f'<cbc:LineExtensionAmount currencyID="TRY">{q * bf:.2f}</cbc:LineExtensionAmount><cac:Item><cbc:Name>{escape(m)}</cbc:Name></cac:Item>'
                    f'<cac:Price><cbc:PriceAmount currencyID="TRY">{bf:.2f}</cbc:PriceAmount></cac:Price></cac:InvoiceLine>'
                    for i, (m, q, b, mz, c, bf, g, k) in enumerate(x['satirlar'], 1))
    genel = round(sum(q * bf for (m, q, b, mz, c, bf, g, k) in x['satirlar']), 2)
    xml = (f'<?xml version="1.0" encoding="UTF-8"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" '
           f'xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">'
           f'<cbc:ID>{x["no"]}</cbc:ID><cbc:IssueDate>{iso(x["teslim"] or x["gun"])}</cbc:IssueDate>'
           f'<cac:AccountingSupplierParty><cac:Party><cac:PartyIdentification><cbc:ID schemeID="VKN">{vkn}</cbc:ID></cac:PartyIdentification>'
           f'<cac:PartyName><cbc:Name>{escape(ted)}</cbc:Name></cac:PartyName></cac:Party></cac:AccountingSupplierParty>'
           f'<cac:LegalMonetaryTotal><cbc:PayableAmount currencyID="TRY">{genel:.2f}</cbc:PayableAmount></cac:LegalMonetaryTotal>{kalem}</Invoice>')
    ad = f'{kafe}-{x["no"]}.xml'
    open(os.path.join(CIKTI, 'efatura', ad), 'w', encoding='utf-8').write(xml)
    plan['faturalar'].append(dict(x, dosya=ad, genel=genel, tedarikci=ted, vkn=vkn,
        satirlar=[dict(metin=m, miktar=q, birim=b, malzeme=mz, carpan=c, birim_fiyat=bf, gelen=g, karar=k)
                  for (m, q, b, mz, c, bf, g, k) in x['satirlar']]))
json.dump(plan, open(os.path.join(CIKTI, 'plan.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('fatura:', len(FATURA), '· sayım:', {k: sorted(v) for k, v in plan['sayim'].items()})
