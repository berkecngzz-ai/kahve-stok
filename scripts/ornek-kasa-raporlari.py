# Deneme için gerçekçi kasa satış raporları üretir (tek hafta, bir semt kafesi: 18–24 Ekim 2026).
# Dört biçim: XLSX (bulut adisyon), Windows-1254 CSV (muhasebe/ERP), HTML ".xls" (masaüstü POS), İngilizce CSV (yabancı POS).
# Aynı hafta, aynı satışlar → dört dosyadan aynı toplam çıkmalı. Kullanım: python scripts/ornek-kasa-raporlari.py
import os, zipfile
from xml.sax.saxutils import escape

KOK = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'ornek-kasa-raporlari')
os.makedirs(KOK, exist_ok=True)

# (kategori, ürün, adet, birim fiyat TL) — ikram 0 TL, iade eksi
SATIS = [
    ('Sıcak Kahveler', 'Espresso', 58, 110), ('Sıcak Kahveler', 'Double Espresso', 34, 140),
    ('Sıcak Kahveler', 'Americano', 126, 140), ('Sıcak Kahveler', 'Filtre Kahve', 118, 130),
    ('Sıcak Kahveler', 'Latte', 131, 165), ('Sıcak Kahveler', 'Latte Büyük', 33, 190),
    ('Sıcak Kahveler', 'Cappuccino', 92, 160), ('Sıcak Kahveler', 'Flat White', 47, 170),
    ('Sıcak Kahveler', 'Cortado', 21, 150), ('Sıcak Kahveler', 'Mocha', 29, 185),
    ('Sıcak Kahveler', 'Karamel Latte', 38, 185), ('Sıcak Kahveler', 'Vanilya Latte', 26, 185),
    ('Sıcak Kahveler', 'Türk Kahvesi', 74, 110), ('Sıcak Kahveler', 'Türk Kahvesi (İkram)', 6, 0),
    ('Soğuk Kahveler', 'Ice Americano', 61, 155), ('Soğuk Kahveler', 'Ice Latte', 88, 180),
    ('Soğuk Kahveler', 'Cold Brew', 33, 175), ('Soğuk Kahveler', 'Ice Karamel Latte', 19, 195),
    ('Çay ve Diğer', 'Çay', 212, 40), ('Çay ve Diğer', 'Bitki Çayı', 27, 90),
    ('Çay ve Diğer', 'Chai Latte', 22, 175), ('Çay ve Diğer', 'Sıcak Çikolata', 18, 170),
    ('Çay ve Diğer', 'Ev Yapımı Limonata', 31, 130),
    ('Tatlılar', 'San Sebastian Cheesecake', 46, 240), ('Tatlılar', 'Brownie', 28, 160),
    ('Tatlılar', 'Çikolatalı Cookie', 41, 120), ('Tatlılar', 'Tiramisu', 17, 220), ('Tatlılar', 'Havuçlu Kek', 23, 150),
    ('Atıştırmalık', 'Kruvasan', 26, 140), ('Atıştırmalık', 'Kaşarlı Tost', 33, 190),
    ('Atıştırmalık', 'Avokadolu Sandviç', 14, 260),
    ('Paketli İçecek', 'Su 0,5 L', 143, 30), ('Paketli İçecek', 'Soda', 52, 50),
    ('Ekstralar', 'Ekstra Shot', 37, 40), ('Ekstralar', 'Yulaf Sütü (+)', 44, 30),
    ('Sıcak Kahveler', 'Latte', -2, 165), ('Sıcak Kahveler', 'Cappuccino', -1, 160),   # iade
]
BASLIK = 'Ürün Satış Raporu'
DONEM = '18.10.2026 - 24.10.2026'
tl = lambda n: f'{n:,.2f}'.replace(',', 'X').replace('.', ',').replace('X', '.')     # 1.234,56
toplam_adet = sum(a for _, _, a, _ in SATIS)
toplam_tutar = sum(a * f for _, _, a, f in SATIS)

# ---------- A) XLSX: bulut adisyon programı (başlık satırları, kategori sütunu, ara toplamlar) ----------
def xlsx(yol, satirlar):
    paylasilan, idx = [], {}
    def s(v):
        if v not in idx: idx[v] = len(paylasilan); paylasilan.append(v)
        return idx[v]
    harf = lambda i: chr(65 + i)
    xml_satirlar = []
    for r, satir in enumerate(satirlar, 1):
        hucreler = []
        for c, v in enumerate(satir):
            if v is None or v == '': continue
            ref = f'{harf(c)}{r}'
            if isinstance(v, (int, float)): hucreler.append(f'<c r="{ref}"><v>{v}</v></c>')
            else: hucreler.append(f'<c r="{ref}" t="s"><v>{s(str(v))}</v></c>')
        xml_satirlar.append(f'<row r="{r}">{"".join(hucreler)}</row>')
    dosyalar = {
        '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>',
        '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
        'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Ürün Satış" sheetId="1" r:id="rId1"/></sheets></workbook>',
        'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>',
        'xl/worksheets/sheet1.xml': '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            f'<sheetData>{"".join(xml_satirlar)}</sheetData></worksheet>',
    }
    dosyalar['xl/sharedStrings.xml'] = ('<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        f'count="{len(paylasilan)}" uniqueCount="{len(paylasilan)}">' + ''.join(f'<si><t>{escape(v)}</t></si>' for v in paylasilan) + '</sst>')
    with zipfile.ZipFile(yol, 'w', zipfile.ZIP_DEFLATED) as z:
        for ad, icerik in dosyalar.items(): z.writestr(ad, icerik)

a = [[BASLIK], ['Şube: Moda'], [f'Tarih Aralığı: {DONEM}'], [],
     ['Kategori', 'Ürün Adı', 'Adet', 'Birim Fiyat', 'Tutar']]
for kat in dict.fromkeys(k for k, _, _, _ in SATIS):
    grup = [x for x in SATIS if x[0] == kat]
    for _, ad, adet, fiyat in grup: a.append([kat, ad, adet, fiyat, adet * fiyat])
    a.append(['', 'Ara Toplam', sum(x[2] for x in grup), '', sum(x[2] * x[3] for x in grup)])
a += [[], ['', 'Genel Toplam', toplam_adet, '', toplam_tutar]]
xlsx(os.path.join(KOK, '1-bulut-adisyon_urun-satis.xlsx'), a)

# ---------- B) CSV, Windows-1254, noktalı virgül: muhasebe/ERP dışa aktarımı (stok kodu, "1.234,00") ----------
b = ['Stok Kodu;Stok Adı;Satış Miktarı;Birim;Birim Fiyat;Tutar']
for i, (_, ad, adet, fiyat) in enumerate(SATIS, 1):
    b.append(f'{150000 + i:06d};{ad.replace("i", "İ").upper()};{tl(adet)};ADET;{tl(fiyat)};{tl(adet * fiyat)}')
b.append(f';TOPLAM;{tl(toplam_adet)};;;{tl(toplam_tutar)}')
with open(os.path.join(KOK, '2-muhasebe-erp_satis.csv'), 'w', encoding='cp1254', newline='') as f:
    f.write('\r\n'.join(b) + '\r\n')

# ---------- C) HTML ".xls": masaüstü POS ("Excel'e aktar" HTML tablo verir; kategori başlık satırları) ----------
c = [f'<html><head><meta charset="utf-8"></head><body><h3>{BASLIK}</h3><p>{DONEM}</p>',
     '<table border="1"><tr><th>Ürün</th><th>Miktar</th><th>Tutar</th></tr>']
for kat in dict.fromkeys(k for k, _, _, _ in SATIS):
    c.append(f'<tr><td colspan="3"><b>{escape(kat.upper())}</b></td></tr>')
    for k, ad, adet, fiyat in SATIS:
        if k == kat: c.append(f'<tr><td>{escape(ad)}</td><td>{adet}</td><td>{tl(adet * fiyat)}</td></tr>')
c.append(f'<tr><td><b>Toplam</b></td><td><b>{toplam_adet}</b></td><td><b>{tl(toplam_tutar)}</b></td></tr></table></body></html>')
with open(os.path.join(KOK, '3-masaustu-pos_urun-satis.xls'), 'w', encoding='utf-8') as f:
    f.write('\n'.join(c))

# ---------- D) İngilizce CSV: yabancı POS (Item + Variation; boy ayrı sütunda, virgüllü) ----------
EN = {'Latte Büyük': ('Latte', 'Large')}
d = ['Category,Item,Variation,Qty Sold,Gross Sales']
for kat, ad, adet, fiyat in SATIS:
    item, var = EN.get(ad, (ad, 'Regular'))
    d.append(f'"{kat}","{item}","{var}",{adet},{adet * fiyat:.2f}')
with open(os.path.join(KOK, '4-yabanci-pos_item-sales.csv'), 'w', encoding='utf-8', newline='') as f:
    f.write('\r\n'.join(d) + '\r\n')

print(f'{len(SATIS)} satır · toplam {toplam_adet} adet · {tl(toplam_tutar)} TL -> {os.path.normpath(KOK)}')
