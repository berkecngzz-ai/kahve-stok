# Kurgusal faturalar: aynı belgenin metin satırları (metinli PDF'in çıkaracağı), PNG, eğik/düşük kontrastlı JPEG,
# taranmış (görüntü) PDF ve iki sayfalı sürümü. Kaynak gerçek değerler kaynak.json'da (karşılaştırma için).
import json, os
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance
BURA = os.path.dirname(os.path.abspath(__file__))
C = os.path.join(BURA, 'cikti', 'belge'); os.makedirs(C, exist_ok=True)
F = lambda s, b=False: ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf' if b else 'C:/Windows/Fonts/arial.ttf', s)
tl = lambda x: f'{x:,.2f}'.replace(',', 'X').replace('.', ',').replace('X', '.')

BELGELER = {
  # Kısa (GİB biçimi 16 karakter) numara, tek KDV, iskonto, binlik ayırıcı
  'F1': dict(ted='TEST Gıda Dağıtım Ltd. Şti.', vkn='4440001112', no='TGD2026000000418', tarih='21.10.2026', iskonto=150.00,
             satirlar=[('Espresso Çekirdek Kahve 1 kg', 10, 'Adet', 1090.91, 10), ('Filtre Kahve 1 kg', 4, 'Adet', 818.18, 10),
                       ('Karamel Şurup 700 ml', 6, 'Adet', 407.27, 10), ('Karton Bardak 12 oz (1000\'li koli)', 2, 'Koli', 2636.36, 10)]),
  # Uzun numara (21 karakter, kesilme hatasının olduğu), unvan eksiz tedarikçi, iki KDV oranı (%1 süt, %10 kahve)
  'F2': dict(ted='TEST TEDARİKÇİ', vkn='5550002223', no='TEST-OCR-20261028-001', tarih='28.10.2026', iskonto=0,
             satirlar=[('Tam Yağlı Süt 1 L (12\'li koli)', 3, 'Koli', 534.65, 1), ('Laktozsuz Süt 1 L', 12, 'Adet', 57.43, 1),
                       ('Çikolata Sos 1 L', 2, 'Adet', 472.73, 10)]),
}
kaynak = {}
for ad, b in BELGELER.items():
    satir = []
    haric = 0; kdv = {}
    for (m, q, br, bf, o) in b['satirlar']:
        t = round(q * bf, 2); haric += t; kdv[o] = kdv.get(o, 0) + t * o / 100
        satir.append(dict(metin=m, miktar=q, birim=br, birim_fiyat=bf, tutar=t, kdv=o))
    haric = round(haric - b['iskonto'], 2)
    # iskonto oransal dağıtılır (KDV iskonto sonrası)
    oran = haric / (haric + b['iskonto']) if b['iskonto'] else 1
    kdv = {o: round(v * oran, 2) for o, v in kdv.items()}
    genel = round(haric + sum(kdv.values()), 2)
    kaynak[ad] = dict(tedarikci=b['ted'], vkn=b['vkn'], fatura_no=b['no'], tarih='-'.join(reversed(b['tarih'].split('.'))),
                      iskonto=b['iskonto'], kdv_haric=haric, kdv=kdv, genel=genel, satirlar=satir)
    # Metin satırları (metinli PDF'ten çıkan sıra)
    L = [b['ted'], f'VKN: {b["vkn"]}', 'e-FATURA', f'Fatura No: {b["no"]}', f'Fatura Tarihi: {b["tarih"]}', 'Sayın: TEST Kafe A (kabul)',
         'Sıra Mal/Hizmet Miktar Birim Birim Fiyat KDV % Tutar']
    for i, s in enumerate(satir, 1):
        L.append(f'{i} {s["metin"]} {s["miktar"]} {s["birim"]} {tl(s["birim_fiyat"])} %{s["kdv"]} {tl(s["tutar"])}')
    L.append(f'Mal Hizmet Toplam Tutarı {tl(round(sum(s["tutar"] for s in satir), 2))}')
    if b['iskonto']: L.append(f'Toplam İskonto {tl(b["iskonto"])}')
    for o, v in sorted(kdv.items()): L.append(f'Hesaplanan KDV (%{o}) {tl(v)}')
    L += [f'Vergiler Dahil Toplam Tutar {tl(genel)}', f'Ödenecek Tutar {tl(genel)}']
    kaynak[ad]['metin'] = L
    # Görsel
    W, H = 1240, 1754
    img = Image.new('RGB', (W, H), 'white'); d = ImageDraw.Draw(img)
    y = 70
    d.text((70, y), b['ted'], font=F(34, True), fill='black'); y += 50
    d.text((70, y), f'VKN: {b["vkn"]}   Merkez Mah. Kahve Sok. No:5 Muğla', font=F(22), fill='black'); y += 60
    d.text((820, 70), 'e-FATURA', font=F(40, True), fill='black')
    d.text((820, 130), f'Fatura No: {b["no"]}', font=F(22), fill='black')
    d.text((820, 165), f'Fatura Tarihi: {b["tarih"]}', font=F(22), fill='black')
    d.text((70, y), 'Sayın: TEST Kafe A (kabul)', font=F(24), fill='black'); y += 70
    kol = [70, 110, 600, 700, 790, 950, 1050]
    for x, h in zip(kol, ['Sıra', 'Mal / Hizmet', 'Miktar', 'Birim', 'Birim Fiyat', 'KDV %', 'Tutar']): d.text((x, y), h, font=F(22, True), fill='black')
    y += 40; d.line((70, y, 1170, y), fill='black', width=2); y += 15
    for i, s in enumerate(satir, 1):
        for x, v in zip(kol, [str(i), s['metin'], str(s['miktar']), s['birim'], tl(s['birim_fiyat']), f'%{s["kdv"]}', tl(s['tutar'])]):
            d.text((x, y), v, font=F(21), fill='black')
        y += 42
    y += 30; d.line((600, y, 1170, y), fill='black', width=1); y += 15
    son = [('Mal Hizmet Toplam Tutarı', tl(round(sum(s['tutar'] for s in satir), 2)))]
    if b['iskonto']: son.append(('Toplam İskonto', tl(b['iskonto'])))
    son += [(f'Hesaplanan KDV (%{o})', tl(v)) for o, v in sorted(kdv.items())]
    son += [('Vergiler Dahil Toplam Tutar', tl(genel)), ('Ödenecek Tutar', tl(genel))]
    for e, v in son: d.text((600, y), e, font=F(22, e.startswith('Ödenecek')), fill='black'); d.text((1050, y), v, font=F(22, e.startswith('Ödenecek')), fill='black'); y += 38
    d.text((70, H - 90), 'Tamamen kurgusal test belgesidir. Gerçek ticari işlem değildir.', font=F(18), fill='gray')
    img.save(os.path.join(C, f'{ad}.png'))
    # Aynı belgenin farklı boyutta kaydı (yeniden kaydedilmiş)
    img.resize((900, int(900 * H / W))).save(os.path.join(C, f'{ad}-kucuk.jpg'), quality=85)
    # Tekrar fotoğraflanmış: hafif eğik, düşük kontrast, bulanık
    f = img.rotate(2.5, expand=True, fillcolor=(235, 232, 225)).filter(ImageFilter.GaussianBlur(1.1))
    f = ImageEnhance.Contrast(f).enhance(0.55); f = ImageEnhance.Brightness(f).enhance(0.93)
    f.convert('RGB').save(os.path.join(C, f'{ad}-foto.jpg'), quality=72)
    # Taranmış PDF (yalnız görüntü)
    img.convert('L').convert('RGB').save(os.path.join(C, f'{ad}-tarama.pdf'), resolution=150)
    # İki sayfalı: ilk sayfa üst + ilk iki satır, ikinci sayfa kalan satırlar + toplamlar
    s1 = img.crop((0, 0, W, 470)); s2 = img.crop((0, 470, W, H))
    p1 = Image.new('RGB', (W, H), 'white'); p1.paste(s1, (0, 0)); ImageDraw.Draw(p1).text((70, H - 140), 'Sayfa 1 / 2 — devamı arkada', font=F(20), fill='black')
    p2 = Image.new('RGB', (W, H), 'white'); p2.paste(s2, (0, 60)); ImageDraw.Draw(p2).text((70, 20), f'{b["no"]} — Sayfa 2 / 2', font=F(20), fill='black')
    p1.save(os.path.join(C, f'{ad}-sayfa1.png')); p2.save(os.path.join(C, f'{ad}-sayfa2.png'))
json.dump(kaynak, open(os.path.join(C, 'kaynak.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print({k: (v['fatura_no'], v['genel'], v['kdv_haric'], v['kdv']) for k, v in kaynak.items()})
