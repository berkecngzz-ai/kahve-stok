# Örnek Kahve — 30 günlük simülasyonun HAM verisini üretir (sabit tohum: aynı girdi → aynı veri).
# Çıktı: scripts/simulasyon/cikti/
#   ham-veri.json        menü, reçete sürümleri, faturalar (doğru içerik), satış satırları, fire, sayımlar, gömülü hatalar
#   pos/*.xlsx|csv       kasa raporları (1–7 haftalık, 5–10 çakışan, 11–30 günlük)
#   faturalar/*.jpg|pdf  fatura görselleri (bazıları eğik, bulanık, el yazısı notlu)
#   GOMULU-HATALAR.md    bilerek gömülen açık ve hatalar
# Gün 0 = 2026-09-25 (açılış sayımı, gün sonu); gün 1..30 = 26 Eylül .. 25 Ekim 2026.
import json, math, os, random, zipfile, datetime as dt
from xml.sax.saxutils import escape
from PIL import Image, ImageDraw, ImageFilter, ImageFont

KOK = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cikti')
for d in ('', 'pos', 'faturalar'):
    os.makedirs(os.path.join(KOK, d), exist_ok=True)
rng = random.Random(20261026)
GUN0 = dt.date(2026, 9, 25)
gun = lambda n: GUN0 + dt.timedelta(days=n)
iso = lambda n: gun(n).isoformat()

# ---------------- Malzemeler (stok birimi; açılış fiyatı TL / kg|L|adet, KDV dahil) ----------------
MALZ = [
    ('esp', 'Espresso çekirdeği', 'g', 1000), ('filtre', 'Filtre kahve çekirdeği', 'g', 850),
    ('sut', 'Tam yağlı süt', 'ml', 42.42), ('yulaf', 'Yulaf sütü', 'ml', 111.1), ('krema', 'Krema', 'ml', 181.8),
    ('karamel', 'Karamel şurubu', 'ml', 606), ('vanilya', 'Vanilya şurubu', 'ml', 606), ('findik', 'Fındık şurubu', 'ml', 626.2),
    ('cikolata', 'Çikolata sosu', 'ml', 525.2),
    ('b8', 'Karton bardak 8 oz', 'adet', 2.88), ('b12', 'Karton bardak 12 oz', 'adet', 3.48), ('s16', 'Soğuk bardak 16 oz', 'adet', 4.2),
    ('kapak', 'Bardak kapağı', 'adet', 1.32),
    ('sansebastian', 'San Sebastian dilim', 'adet', 96), ('brownie', 'Brownie', 'adet', 55.55), ('cookie', 'Cookie', 'adet', 35.35),
    ('su', 'Su 0,5 L', 'adet', 6.06),
]
# ---------------- Menü (25 ürün): satış fiyatı, hafta içi günlük ortalama adet, reçete ----------------
L = lambda **k: k
MENU = [
    ('Espresso', 110, 10, L(esp=9, b8=1)), ('Double Espresso', 140, 6, L(esp=18, b8=1)),
    ('Americano', 140, 20, L(esp=18, b12=1, kapak=1)), ('Filtre Kahve', 130, 16, L(filtre=15, b12=1, kapak=1)),
    ('Latte', 165, 24, L(esp=18, sut=180, b12=1, kapak=1)), ('Cappuccino', 160, 12, L(esp=18, sut=150, b8=1, kapak=1)),
    ('Flat White', 170, 6, L(esp=18, sut=120, b8=1, kapak=1)), ('Cortado', 150, 4, L(esp=18, sut=60, b8=1, kapak=1)),
    ('Macchiato', 145, 3, L(esp=18, sut=30, b8=1)), ('Mocha', 185, 4, L(esp=18, sut=180, cikolata=30, b12=1, kapak=1)),
    ('Karamel Latte', 185, 6, L(esp=18, sut=180, karamel=20, b12=1, kapak=1)),
    ('Vanilya Latte', 185, 4, L(esp=18, sut=180, vanilya=20, b12=1, kapak=1)),
    ('Fındıklı Latte', 185, 3, L(esp=18, sut=180, findik=20, b12=1, kapak=1)), ('Yulaf Latte', 190, 4, L(esp=18, yulaf=180, b12=1, kapak=1)),
    ('Ice Americano', 155, 9, L(esp=18, s16=1, kapak=1)), ('Ice Latte', 180, 11, L(esp=18, sut=200, s16=1, kapak=1)),
    ('Ice Karamel Latte', 195, 4, L(esp=18, sut=200, karamel=25, s16=1, kapak=1)),
    ('Ice Mocha', 195, 3, L(esp=18, sut=200, cikolata=30, s16=1, kapak=1)),
    ('Cold Brew', 175, 4, L(filtre=25, s16=1, kapak=1)),                     # REÇETESİ GİRİLMEYECEK (gömülü)
    ('Sıcak Çikolata', 170, 3, L(sut=220, cikolata=40, krema=20, b12=1, kapak=1)),
    ('San Sebastian Cheesecake', 240, 6, L(sansebastian=1)), ('Brownie', 160, 4, L(brownie=1)), ('Cookie', 120, 6, L(cookie=1)),
    ('Su', 30, 12, L(su=1)), ('Ekstra Shot', 40, 4, L(esp=9)),
]
RECETESIZ = 'Cold Brew'
LATTE_DEGISIM_GUN = 15                     # Latte sütü 180 → 200 ml (bu gün dahil)
SUT_KAYIP_BASLA = 8                        # 2. haftadan itibaren teorik süt tüketiminin %8'i kayıt dışı kayıp
SUT_KAYIP_ORAN = 0.08
KAHVE_KAYIP = (18, 1200)                   # 18. gün 1,2 kg espresso çekirdeği kaybolur (3. hafta)
HAFTALIK = [0, 7, 14, 21, 28]              # gün sonu tam sayım; süt ayrıca her gün
HATALI_SAYIM = (12, 'sut')                 # 12. gün süt: 18,x L yerine 8,x L yazıldı (sonra düzeltilecek)

def recete(urun, n):
    r = dict(next(m for m in MENU if m[0] == urun)[3])
    if urun == 'Latte' and n >= LATTE_DEGISIM_GUN: r['sut'] = 200
    return r

# ---------------- Satışlar: fiş bazında ----------------
satislar = []        # {gun, fis, saat, urun, adet, tutar, durum}
fis_no = 10000
for n in range(1, 31):
    hafta_sonu = gun(n).weekday() >= 5
    kat = 1.45 if hafta_sonu else 1.0
    istek = []
    for ad, fiyat, ort, _ in MENU:
        lam = ort * kat * rng.uniform(0.85, 1.15)
        adet = max(0, int(round(rng.gauss(lam, math.sqrt(lam)))))
        istek += [ad] * adet
    rng.shuffle(istek)
    i = 0
    while i < len(istek):
        k = rng.choice([1, 1, 1, 2, 2, 3])
        fis_no += 1
        dakika = rng.randint(7 * 60 + 30, 20 * 60 + 30)
        saat = f'{dakika // 60:02d}:{dakika % 60:02d}:{rng.randint(0, 59):02d}'
        fis = f'M-{fis_no}'
        kalem = {}
        for ad in istek[i:i + k]: kalem[ad] = kalem.get(ad, 0) + 1
        for ad, adet in kalem.items():
            fiyat = next(m[1] for m in MENU if m[0] == ad)
            satislar.append(dict(gun=n, fis=fis, saat=saat, urun=ad, adet=adet, tutar=adet * fiyat, durum='Satış'))
            r = rng.random()
            if r < 0.012:     # hazırlanmadan iptal: aynı fişte iptal satırı, ürün yapılmadı
                satislar.append(dict(gun=n, fis=fis, saat=saat, urun=ad, adet=1, tutar=fiyat, durum='İptal'))
            elif r < 0.018:   # yapılıp verildi, sonra para iadesi
                satislar.append(dict(gun=n, fis=fis, saat=saat, urun=ad, adet=1, tutar=fiyat, durum='İade'))
        i += k

def gun_net(n):
    """Günün fiziksel olarak hazırlanan ürünleri: satış − iptal (iade edilen ürün hazırlanmıştı)."""
    net = {}
    for s in satislar:
        if s['gun'] != n: continue
        if s['durum'] == 'Satış': net[(s['fis'], s['urun'])] = net.get((s['fis'], s['urun']), 0) + s['adet']
        elif s['durum'] == 'İptal': net[(s['fis'], s['urun'])] = net.get((s['fis'], s['urun']), 0) - s['adet']
    toplam = {}
    for (f, u), a in net.items(): toplam[u] = toplam.get(u, 0) + max(0, a)
    return toplam

def teorik_tuketim(n, recetesiz_dahil):
    t = {}
    for urun, adet in gun_net(n).items():
        if urun == RECETESIZ and not recetesiz_dahil: continue
        for m, q in recete(urun, n).items(): t[m] = t.get(m, 0) + q * adet
    return t

# ---------------- Fire (kayıtlı) ----------------
FIRE = [
    dict(gun=3, sebep='Bozuldu', malzeme='sut', miktar=1000), dict(gun=6, sebep='Döküldü', malzeme='esp', miktar=120),
    dict(gun=9, sebep='Tarihi geçti', malzeme='sansebastian', miktar=2), dict(gun=11, sebep='Döküldü', malzeme='sut', miktar=500),
    dict(gun=15, sebep='Yere düştü', malzeme='b12', miktar=8), dict(gun=17, sebep='Bozuldu', malzeme='sut', miktar=1000),
    dict(gun=20, sebep='Döküldü', urun='Latte', miktar=1), dict(gun=23, sebep='Tarihi geçti', malzeme='cookie', miktar=3),
    dict(gun=26, sebep='Bozuldu', malzeme='yulaf', miktar=1000), dict(gun=29, sebep='Döküldü', malzeme='karamel', miktar=150),
]
def fire_gun(n):
    t = {}
    for f in FIRE:
        if f['gun'] != n: continue
        if 'malzeme' in f: t[f['malzeme']] = t.get(f['malzeme'], 0) + f['miktar']
        else:
            for m, q in recete(f['urun'], n).items(): t[m] = t.get(m, 0) + q * f['miktar']
    return t

# ---------------- Faturalar ----------------
# her satır: metin, belge miktarı, belge birimi (yazılan), carpan (stok birimi / belge birimi), KDV hariç birim fiyat, KDV %, malzeme
TEDARIKCI = {
    'sut': ('Yıldız Süt ve Süt Ürünleri Ltd. Şti.', '9870012345', 'Bağdat Cad. No:112 Kadıköy / İstanbul'),
    'kahve': ('Kavruk Kahve Kavurma A.Ş.', '5430098765', 'Hasanpaşa Mah. Fahrettin Kerim Gökay Cad. 8 Kadıköy'),
    'metro': ('Metro Grossmarket Ataşehir', '6200443300', 'Barbaros Mah. Ataşehir / İstanbul'),
    'ambalaj': ('Ambalajcı Murat Ticaret', '1112223334', 'Perpa Ticaret Merkezi B Blok Okmeydanı'),
    'pastane': ('Tatlı Ev Pastanesi', '4567891230', 'Moda Cad. 21 Kadıköy / İstanbul'),
}
faturalar = []
fno = {'sut': 4510, 'kahve': 1201, 'metro': 88012, 'ambalaj': 330, 'pastane': 770}
def fatura(ted, n, satirlar, **ek):
    fno[ted] += 1
    f = dict(id=f'F{len(faturalar) + 1:02d}', ted=ted, fatura_no=f'{ted[:3].upper()}2026{fno[ted]:06d}', fatura_gunu=n,
             teslim_gunu=n, yukleme_gunu=n, satirlar=satirlar, gorsel=dict(), **ek)
    faturalar.append(f)
    return f
def sut_satiri(koli, fiyat):  # 12'li koli 1 L süt
    return dict(metin='Tam Yağlı Süt 1 L (12\'li koli)', miktar=koli, birim='Koli', carpan=12000, fiyat=fiyat, kdv=1, malzeme='sut', gelen=koli)

# Süt: her 3 günde (1,4,…,28); fiyat koli 12 L: 504 TL (42/L) → 16. günden 552 TL (46/L, KDV hariç)
for n in range(1, 31, 3):
    fiyat = 500 if n < 16 else 546.53        # KDV hariç; %1 KDV ile 505,00 / 552,00 → ~42,08 / 46,00 TL/L
    koli = 5 if n in (16, 25) else 4
    faturalar.append(None) if False else None
    if n == 13:   # GEÇ FATURA: fatura tarihi 13, fiziksel teslim 15, yükleme 16 (3 gün geç)
        fatura('sut', 13, [sut_satiri(koli, fiyat)], gec=True); faturalar[-1].update(teslim_gunu=15, yukleme_gunu=16)
    elif n == 22:  # MİKTARI YANLIŞ OKUNABİLECEK: "12 LT" ve "1 L × 12" yazımı (AI 120 okuyabilir); fiziksel 12 L
        fatura('sut', n, [dict(metin='Süt UHT Tam Yağlı 1 LT', miktar=12, birim='LT', carpan=1000, fiyat=45.54, kdv=1, malzeme='sut', gelen=12)],
               belirsiz_miktar=True)
        faturalar[-1]['satirlar'].append(dict(metin='Tam Yağlı Süt 1 L (12\'li koli)', miktar=koli - 1, birim='Koli', carpan=12000,
                                              fiyat=546.53, kdv=1, malzeme='sut', gelen=koli - 1))
    else:
        fatura('sut', n, [sut_satiri(koli, fiyat)])
# Kahve: haftalık (gün 2, 9, 16, 23) 1 kg paket çekirdek; filtre 1 kg
for n in (2, 9, 16, 23):
    fatura('kahve', n, [dict(metin='Espresso Blend Çekirdek 1 kg', miktar=18, birim='Paket', carpan=1000, fiyat=990.10, kdv=1, malzeme='esp', gelen=18),
                        dict(metin='Filtre Kahve Kolombiya 1 kg', miktar=4, birim='Paket', carpan=1000, fiyat=841.58, kdv=1, malzeme='filtre', gelen=4)])
# Metro: şuruplar, sos, krema, yulaf, su (gün 1, 15)
for n in (1, 15):
    fatura('metro', n, [
        dict(metin='Monin Karamel Şurup 700 ml', miktar=6, birim='Şişe', carpan=700, fiyat=420.0, kdv=1, malzeme='karamel', gelen=6),
        dict(metin='Monin Vanilya Şurup 700 ml', miktar=3, birim='Şişe', carpan=700, fiyat=420.0, kdv=1, malzeme='vanilya', gelen=3),
        dict(metin='Monin Fındık Şurup 700 ml', miktar=2, birim='Şişe', carpan=700, fiyat=434.0, kdv=1, malzeme='findik', gelen=2),
        dict(metin='Çikolata Sosu 1 L', miktar=6, birim='Adet', carpan=1000, fiyat=520.0, kdv=1, malzeme='cikolata', gelen=6),
        dict(metin='Pınar Krema 1 L', miktar=2, birim='Adet', carpan=1000, fiyat=180.0, kdv=1, malzeme='krema', gelen=2),
        dict(metin='Alpro Yulaf İçeceği 1 L', miktar=12, birim='Adet', carpan=1000, fiyat=110.0, kdv=1, malzeme='yulaf', gelen=12),
        dict(metin='Erikli Su 0,5 L 24\'lü', miktar=8, birim='Koli', carpan=24, fiyat=144.0, kdv=1, malzeme='su', gelen=8),
    ])
# Ambalaj (gün 2, 16)
for n in (2, 16):
    fatura('ambalaj', n, [
        dict(metin='Karton Bardak 8 oz (1000\'li koli)', miktar=1, birim='Koli', carpan=1000, fiyat=2400.0, kdv=20, malzeme='b8', gelen=1),
        dict(metin='Karton Bardak 12 oz (1000\'li koli)', miktar=2, birim='Koli', carpan=1000, fiyat=2900.0, kdv=20, malzeme='b12', gelen=2),
        dict(metin='Şeffaf Soğuk Bardak 16 oz (500\'lü)', miktar=1, birim='Koli', carpan=500, fiyat=1750.0, kdv=20, malzeme='s16', gelen=1),
        dict(metin='Bardak Kapağı (1000\'li)', miktar=3, birim='Koli', carpan=1000, fiyat=1100.0, kdv=20, malzeme='kapak', gelen=3),
    ])
# Pastane (her 4 gün)
for n in range(1, 31, 4):
    fatura('pastane', n, [
        dict(metin='San Sebastian Cheesecake (12 dilim)', miktar=3, birim='Adet', carpan=12, fiyat=1140.6, kdv=1, malzeme='sansebastian', gelen=3),
        dict(metin='Brownie', miktar=22, birim='Adet', carpan=1, fiyat=55.0, kdv=1, malzeme='brownie', gelen=22),
        dict(metin='Çikolatalı Cookie', miktar=34, birim='Adet', carpan=1, fiyat=35.0, kdv=1, malzeme='cookie', gelen=34),
    ])
faturalar.sort(key=lambda f: (f['fatura_gunu'], f['id']))
for i, f in enumerate(faturalar): f['id'] = f'F{i + 1:02d}'
for f in faturalar:
    for s in f['satirlar']:
        s['tutar_haric'] = round(s['miktar'] * s['fiyat'], 2)
        s['tutar_dahil'] = round(s['tutar_haric'] * (1 + s['kdv'] / 100), 2)
    f['ara_toplam'] = round(sum(s['tutar_haric'] for s in f['satirlar']), 2)
    f['kdv_toplam'] = round(sum(s['tutar_dahil'] - s['tutar_haric'] for s in f['satirlar']), 2)
    f['genel_toplam'] = round(f['ara_toplam'] + f['kdv_toplam'], 2)

def teslim_gun(n):
    t = {}
    for f in faturalar:
        if f['teslim_gunu'] != n: continue
        for s in f['satirlar']: t[s['malzeme']] = t.get(s['malzeme'], 0) + s['gelen'] * s['carpan']
    return t

# ---------------- Fiziksel stok ve sayımlar ----------------
ACILIS = dict(esp=8000, filtre=2000, sut=30000, yulaf=4000, krema=1000, karamel=1400, vanilya=1400, findik=700, cikolata=1500,
              b8=600, b12=900, s16=300, kapak=1200, sansebastian=14, brownie=10, cookie=14, su=96)
fiziksel = dict(ACILIS)
yuvarla = lambda m, v: (round(v / 100) * 100 if m in ('sut', 'yulaf') else round(v / 10) * 10 if MALZ_BIRIM[m] in ('g', 'ml') else round(v))
MALZ_BIRIM = {m[0]: m[2] for m in MALZ}
sayimlar = [dict(gun=0, kalemler={m: v for m, v in ACILIS.items()})]
gizli_kayip = {}          # gün → malzeme → kayıp (kayıt dışı)
eksi = []
for n in range(1, 31):
    for m, q in teslim_gun(n).items(): fiziksel[m] += q
    for m, q in teorik_tuketim(n, recetesiz_dahil=True).items(): fiziksel[m] -= q
    for m, q in fire_gun(n).items(): fiziksel[m] -= q
    kayip = {}
    if n >= SUT_KAYIP_BASLA:
        kayip['sut'] = round(teorik_tuketim(n, recetesiz_dahil=False).get('sut', 0) * SUT_KAYIP_ORAN, 1)
    if n == KAHVE_KAYIP[0]: kayip['esp'] = KAHVE_KAYIP[1]
    for m, q in kayip.items(): fiziksel[m] -= q
    gizli_kayip[n] = kayip
    for m, v in fiziksel.items():
        if v < 0: eksi.append((n, m, v))
    if n in HAFTALIK:
        sayimlar.append(dict(gun=n, kalemler={m: yuvarla(m, v) for m, v in fiziksel.items()}))
    else:
        sayimlar.append(dict(gun=n, kalemler={'sut': yuvarla('sut', fiziksel['sut'])}))
if eksi: raise SystemExit(f'Fiziksel stok eksiye düştü (senaryoyu ayarla): {eksi[:5]}')
hs = next(s for s in sayimlar if s['gun'] == HATALI_SAYIM[0])
dogru = hs['kalemler']['sut']
hs['yazilan'] = {'sut': dogru - 10000}     # 18,x L yerine 8,x L
hs['duzeltme'] = {'sut': dogru}

# ---------------- POS dosyaları ----------------
def pos_satirlari(g1, g2):
    return [s for s in satislar if g1 <= s['gun'] <= g2]
tl = lambda v: f'{v:,.2f}'.replace(',', 'X').replace('.', ',').replace('X', '.')
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
    d = {
        '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>',
        '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
        'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Satışlar" sheetId="1" r:id="rId1"/></sheets></workbook>',
        'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>',
        'xl/worksheets/sheet1.xml': f'<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>{"".join(xml)}</sheetData></worksheet>',
    }
    d['xl/sharedStrings.xml'] = ('<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                                 + ''.join(f'<si><t>{escape(v)}</t></si>' for v in paylasilan) + '</sst>')
    with zipfile.ZipFile(yol, 'w', zipfile.ZIP_DEFLATED) as z:
        for a, i in d.items(): z.writestr(a, i)
def tr_tarih(n): return gun(n).strftime('%d.%m.%Y')
def pos_xlsx(ad, g1, g2):
    rows = [['Örnek Kahve — Satış Detay Raporu'], [f'{tr_tarih(g1)} - {tr_tarih(g2)}'], [],
            ['Fiş No', 'Tarih', 'Saat', 'Ürün Adı', 'Adet', 'Tutar', 'Durum']]
    for s in pos_satirlari(g1, g2):
        rows.append([s['fis'], tr_tarih(s['gun']), s['saat'], s['urun'], s['adet'], s['tutar'], s['durum']])
    rows += [[], ['', '', '', 'Genel Toplam', sum(s['adet'] for s in pos_satirlari(g1, g2) if s['durum'] == 'Satış'), '', '']]
    xlsx_yaz(os.path.join(KOK, 'pos', ad), rows)
def pos_csv(ad, g1, g2):
    b = ['Adisyon No;İşlem Tarihi;Saat;Ürün;Miktar;Tutar;İşlem Tipi']
    for s in pos_satirlari(g1, g2):
        b.append(f"{s['fis']};{tr_tarih(s['gun'])};{s['saat'][:5]};{s['urun']};{s['adet']},00;{tl(s['tutar'])};{s['durum'].upper()}")
    with open(os.path.join(KOK, 'pos', ad), 'w', encoding='cp1254', newline='') as f: f.write('\r\n'.join(b) + '\r\n')
pos_dosyalari = [dict(dosya='satis-01-07.xlsx', g1=1, g2=7, yukleme_gunu=7), dict(dosya='satis-05-10.csv', g1=5, g2=10, yukleme_gunu=10)]
pos_xlsx('satis-01-07.xlsx', 1, 7); pos_csv('satis-05-10.csv', 5, 10)
for n in range(11, 31):
    ad = f'satis-{n:02d}.' + ('xlsx' if n % 2 else 'csv')
    (pos_xlsx if n % 2 else pos_csv)(ad, n, n)
    pos_dosyalari.append(dict(dosya=ad, g1=n, g2=n, yukleme_gunu=n))

# ---------------- Fatura görselleri ----------------
F = lambda ad, b: ImageFont.truetype(os.path.join('C:/Windows/Fonts', ad), b)
def fatura_resmi(f, varyant):
    W, H = 1240, 1754
    im = Image.new('RGB', (W, H), 'white'); d = ImageDraw.Draw(im)
    ad, vkn, adres = TEDARIKCI[f['ted']]
    d.rectangle([60, 60, W - 60, 230], outline='black', width=3)
    d.text((90, 85), ad, font=F('arialbd.ttf', 40), fill='black')
    d.text((90, 140), adres, font=F('arial.ttf', 24), fill='black')
    d.text((90, 175), f'Vergi No: {vkn}   Kadıköy V.D.', font=F('arial.ttf', 24), fill='black')
    d.text((W - 420, 85), 'SATIŞ FATURASI', font=F('arialbd.ttf', 34), fill='black')
    d.text((90, 260), 'Sayın: Örnek Kahve — Moda Cad. 45 Kadıköy / İstanbul', font=F('arial.ttf', 26), fill='black')
    d.text((90, 300), f'Fatura No: {f["fatura_no"]}', font=F('arial.ttf', 26), fill='black')
    d.text((W - 420, 300), f'Tarih: {tr_tarih(f["fatura_gunu"])}', font=F('arial.ttf', 26), fill='black')
    y = 370
    d.rectangle([60, y - 10, W - 60, y + 40], fill='#e8e8e8')
    for x, t in ((90, 'Ürün / Açıklama'), (600, 'Miktar'), (700, 'Birim'), (810, 'B.Fiyat'), (950, 'KDV')):
        d.text((x, y), t, font=F('arialbd.ttf', 24), fill='black')
    d.text((W - 80 - d.textlength('Tutar', font=F('arialbd.ttf', 24)), y), 'Tutar', font=F('arialbd.ttf', 24), fill='black')
    y += 60
    for s in f['satirlar']:
        d.text((90, y), s['metin'], font=F('arial.ttf', 24), fill='black')
        d.text((600, y), f'{s["miktar"]}', font=F('arial.ttf', 24), fill='black')
        d.text((700, y), s['birim'], font=F('arial.ttf', 24), fill='black')
        d.text((810, y), tl(s['fiyat']), font=F('arial.ttf', 24), fill='black')
        d.text((950, y), f'%{s["kdv"]}', font=F('arial.ttf', 24), fill='black')
        tx = tl(s['tutar_haric']); d.text((W - 80 - d.textlength(tx, font=F('arial.ttf', 24)), y), tx, font=F('arial.ttf', 24), fill='black')
        d.line([60, y + 40, W - 60, y + 40], fill='#cccccc', width=1)
        y += 56
    y += 30
    for et, v in (('Ara Toplam', f['ara_toplam']), ('Hesaplanan KDV', f['kdv_toplam']), ('GENEL TOPLAM', f['genel_toplam'])):
        fo = F('arialbd.ttf' if et == 'GENEL TOPLAM' else 'arial.ttf', 28)
        d.text((720, y), et, font=fo, fill='black'); tx = tl(v); d.text((W - 80 - d.textlength(tx, font=fo), y), tx, font=fo, fill='black'); y += 46
    d.text((90, H - 160), 'Teslim alan: ............................   İmza: ..................', font=F('arial.ttf', 24), fill='black')
    if 'not' in varyant:
        el = F('Inkfree.ttf', 46)
        d.text((150, y + 80), varyant['not'], font=el, fill='#1a3cc8')
    if varyant.get('belirsiz'):
        # "12 LT" satırının yanına el yazısı "0"a benzeyen karalama: 12 / 120 karışabilir
        d.text((632, 432), '0', font=F('Inkfree.ttf', 40), fill='#1a3cc8')
    if varyant.get('aci'):
        bg = Image.new('RGB', (W + 200, H + 200), '#8a8f94'); bg.paste(im, (100, 100))
        im = bg.rotate(varyant['aci'], resample=Image.BICUBIC, expand=False, fillcolor='#8a8f94')
    if varyant.get('bulanik'):
        im = im.filter(ImageFilter.GaussianBlur(varyant['bulanik']))
    return im
# Uygulamanın AI'ya gönderdiği kopya (fotoKucult: uzun kenar 1600 px, JPEG 0,78); PDF'in ilk sayfası da böyle gider.
os.makedirs(os.path.join(KOK, 'gonderim'), exist_ok=True)
def gonderim(im, ad):
    k = im.copy(); k.thumbnail((1600, 1600)); k.save(os.path.join(KOK, 'gonderim', f'{ad}.jpg'), 'JPEG', quality=78)
VARYANT = {}
for i, f in enumerate(faturalar):
    v = {}
    if i % 5 == 1: v['aci'] = rng.choice([-4, -3, 3, 5])
    if i % 7 == 3: v['bulanik'] = 1.6
    if f['id'] in ('F04', 'F11'): v['not'] = '2 koli eksik geldi mi? kontrol!' if f['id'] == 'F04' else 'Ödeme pazartesi — Ahmet'
    if f.get('belirsiz_miktar'): v['belirsiz'] = True
    if f.get('gec'): v['not'] = 'Teslim: ' + gun(f['teslim_gunu']).strftime('%d.%m') + ' (geç geldi)'
    VARYANT[f['id']] = v
    im = fatura_resmi(f, v)
    pdf = f['ted'] == 'kahve' and f['fatura_gunu'] == 9
    yol = os.path.join(KOK, 'faturalar', f'{f["id"]}.' + ('pdf' if pdf else 'jpg'))
    if pdf: im.save(yol, 'PDF', resolution=150)
    else: im.save(yol, 'JPEG', quality=82)
    f['dosya'] = os.path.basename(yol); f['gorsel'] = v
    gonderim(im, f['id'])

# Mükerrer: süt faturası (gün 7) aynı dosya + aynı faturanın farklı açıyla yeniden çekilmiş fotoğrafı
mukerrer = next(f for f in faturalar if f['ted'] == 'sut' and f['fatura_gunu'] == 7)
im = fatura_resmi(mukerrer, {'aci': 2})
im.save(os.path.join(KOK, 'faturalar', f'{mukerrer["id"]}-tekrar-cekim.jpg'), 'JPEG', quality=80)
gonderim(im, f'{mukerrer["id"]}-tekrar-cekim')

# ---------------- Ham veri + gömülü hatalar ----------------
ham = dict(
    gun0=GUN0.isoformat(), malzemeler=[dict(kod=m[0], ad=m[1], birim=m[2], fiyat=m[3]) for m in MALZ],
    menu=[dict(ad=m[0], fiyat=m[1], recete=m[3], recetesiz=(m[0] == RECETESIZ)) for m in MENU],
    recete_surumleri=[dict(urun='Latte', gecerli_gun=LATTE_DEGISIM_GUN, recete=recete('Latte', LATTE_DEGISIM_GUN))],
    satislar=satislar, pos_dosyalari=pos_dosyalari, faturalar=faturalar, mukerrer_fatura=mukerrer['id'], fire=FIRE,
    sayimlar=sayimlar, acilis=ACILIS, gizli_kayip=gizli_kayip, haftalik=HAFTALIK,
    gomulu=dict(sut_kayip=dict(baslangic_gunu=SUT_KAYIP_BASLA, oran=SUT_KAYIP_ORAN), kahve_kayip=dict(gun=KAHVE_KAYIP[0], gram=KAHVE_KAYIP[1]),
                hatali_sayim=dict(gun=HATALI_SAYIM[0], malzeme='sut', yazilan=hs['yazilan']['sut'], dogru=dogru),
                recetesiz=RECETESIZ, mukerrer_fatura=mukerrer['id'],
                belirsiz_miktar=[f['id'] for f in faturalar if f.get('belirsiz_miktar')],
                gec_fatura=[dict(id=f['id'], fatura_gunu=f['fatura_gunu'], teslim_gunu=f['teslim_gunu'], yukleme_gunu=f['yukleme_gunu']) for f in faturalar if f.get('gec')],
                cakisan_pos=['satis-01-07.xlsx', 'satis-05-10.csv'], latte_degisim_gunu=LATTE_DEGISIM_GUN,
                fiyat_degisimi='Tam yağlı süt: 16. günden itibaren koli 500,00 → 546,53 TL (KDV hariç)'))
with open(os.path.join(KOK, 'ham-veri.json'), 'w', encoding='utf-8') as f: json.dump(ham, f, ensure_ascii=False, indent=1)

iptal = sum(s['adet'] for s in satislar if s['durum'] == 'İptal'); iade = sum(s['adet'] for s in satislar if s['durum'] == 'İade')
sut_kayip = sum(k.get('sut', 0) for k in gizli_kayip.values())
cb = sum(gun_net(n).get(RECETESIZ, 0) for n in range(1, 31))
with open(os.path.join(KOK, 'GOMULU-HATALAR.md'), 'w', encoding='utf-8') as f:
    f.write(f"""# Örnek Kahve — bilerek gömülen açıklar ve hatalar (üretici: scripts/simulasyon/uret.py, tohum 20261026)

Dönem: {iso(1)} – {iso(30)} (gün 1–30). Açılış sayımı {iso(0)} gün sonu. Haftalık tam sayım: gün {', '.join(map(str, HAFTALIK[1:]))}; süt her gün.

| # | Gömülen | Ayrıntı | Beklenen yakalama |
|---|---|---|---|
| 1 | Süt kaybı | Gün {SUT_KAYIP_BASLA}'den itibaren her gün, reçetelerden hesaplanan teorik süt tüketiminin %{int(SUT_KAYIP_ORAN*100)}'i kayıt dışı kayboldu. Toplam {sut_kayip/1000:.1f} L. | Günlük süt sayımlarında her gün açık |
| 2 | Kahve çekirdeği kaybı | Gün {KAHVE_KAYIP[0]}'de {KAHVE_KAYIP[1]} g espresso çekirdeği kayboldu. | Gün 21 haftalık sayımında (15–21. hafta) |
| 3 | Hatalı barista sayımı | Gün {HATALI_SAYIM[0]} süt: doğrusu {dogru/1000:.1f} L, {hs['yazilan']['sut']/1000:.1f} L yazıldı; patron sonra düzeltir. | Düzeltmeden önce sahte açık, sonra kaybolur |
| 4 | Reçetesiz ürün | "{RECETESIZ}" satılıyor ({cb} adet) ama reçetesi girilmedi (fiziksel: 25 g filtre kahve + soğuk bardak + kapak). | Uyarı; filtre kahvede açık olarak görünür |
| 5 | Mükerrer fatura | {mukerrer['id']} ({mukerrer['fatura_no']}) aynı dosya ve farklı açıdan yeni fotoğraf olarak yeniden yüklenir. | Engellenmeli |
| 6 | Yanlış okunabilecek miktar | {', '.join(f['id'] for f in faturalar if f.get('belirsiz_miktar'))}: "12 LT" yanında el yazısı karalama (12/120). Fiziksel 12 L. | Kör sayım 12 L; şüpheli → kontrol |
| 7 | Geç fatura | {', '.join(f"{g['id']}: fatura günü {g['fatura_gunu']}, teslim {g['teslim_gunu']}, yükleme {g['yukleme_gunu']}" for g in ham['gomulu']['gec_fatura'])} | Teslim tarihi düzeltilince doğru haftaya |
| 8 | İptal ve iade | {iptal} adet hazırlanmadan iptal (tüketim yok), {iade} adet verildikten sonra para iadesi (tüketim var). | İptal düşer, iade stoğu artırmaz |
| 9 | Çakışan POS dosyaları | satis-01-07.xlsx ve satis-05-10.csv (5–7. günler iki dosyada). | Mükerrer satırlar atlanır, sayısı bildirilir |
| 10 | Reçete değişimi | Latte sütü gün {LATTE_DEGISIM_GUN}'den itibaren 180 → 200 ml. | Her satış kendi gününün reçetesiyle |
| 11 | Fiyat değişimi | {ham['gomulu']['fiyat_degisimi']} | Ağırlıklı ortalama maliyet |
""")
print(f'{len(satislar)} satış satırı, {len(faturalar)} fatura, {len(sayimlar)} sayım, süt kaybı {sut_kayip/1000:.1f} L, Cold Brew {cb}')
