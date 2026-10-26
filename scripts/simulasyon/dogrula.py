# BAĞIMSIZ DOĞRULAMA — uygulamanın hesap kodunu, fonksiyonlarını ve veritabanı sorgularını KULLANMAZ.
# Simülasyonun ham girdilerinden (cikti/ham-veri.json: faturalar, satış satırları, iptal/iade, reçete sürümleri, fire,
# sayımlar) beklenen stok/açık/TL'yi sıfırdan, basit bir hesapla üretir; uygulamanın ekranda gösterdiği rapor
# (stok_farki: patronun Rapor sekmesinin döndürdüğü JSON) ile karşılaştırır. Uygulamadan yalnız ÇIKTI okunur.
#
# Kurallar (görev metninden):
#   beklenen = başlangıç sayımı + mal girişi (fiziksel teslim günü) − satış tüketimi (satış gününün reçetesi; iptal düşer,
#   iade stoğu artırmaz; reçetesiz ürün 0) − fire;  açık = sayılan − beklenen;  TL = açık × ağırlıklı ortalama alış maliyeti
#   (dönem sonuna kadar son 90 günün faturaları, KDV dahil).  Haftalık (tam) sayım bir önceki tam sayımdan, günlük süt
#   sayımı bir önceki süt sayımından başlar. Düzeltilmiş sayım değeri kullanılır.
# Kullanım: python scripts/simulasyon/dogrula.py      (çıktı: cikti/dogrulama.json + ekrana özet)
import json, os, sys, urllib.request
BURA = os.path.dirname(os.path.abspath(__file__))
CIKTI = os.path.join(BURA, 'cikti')
ham = json.load(open(os.path.join(CIKTI, 'ham-veri.json'), encoding='utf-8'))
giris = json.load(open(os.path.join(BURA, '..', '..', '.local-work', 'ornek-kahve-giris.json'), encoding='utf-8'))
import datetime as dt
GUN0 = dt.date.fromisoformat(ham['gun0'])
iso = lambda n: (GUN0 + dt.timedelta(days=n)).isoformat()
MALZ = {m['kod']: m for m in ham['malzemeler']}
AD2KOD = {m['ad']: m['kod'] for m in ham['malzemeler']}

# ---------------- Bağımsız hesap ----------------
def recete(urun, gun):
    u = next(m for m in ham['menu'] if m['ad'] == urun)
    if u['recetesiz']: return {}
    r = dict(u['recete'])
    for v in ham['recete_surumleri']:
        if v['urun'] == urun and gun >= v['gecerli_gun']: r = dict(v['recete'])
    if urun == 'Latte' and gun < ham['recete_surumleri'][0]['gecerli_gun']: r['sut'] = 180
    return r

def satis_tuketimi(gun):
    net = {}
    for s in ham['satislar']:
        if s['gun'] != gun: continue
        k = (s['fis'], s['urun'])
        if s['durum'] == 'Satış': net[k] = net.get(k, 0) + s['adet']
        elif s['durum'] == 'İptal': net[k] = net.get(k, 0) - s['adet']
        # İade: ürün verilmişti, stoğa etkisi yok
    t = {}
    for (fis, urun), a in net.items():
        a = max(0, a)
        for m, q in recete(urun, gun).items(): t[m] = t.get(m, 0) + q * a
    return t

def fire(gun):
    t = {}
    for f in ham['fire']:
        if f['gun'] != gun: continue
        if 'malzeme' in f: t[f['malzeme']] = t.get(f['malzeme'], 0) + f['miktar']
        else:
            for m, q in recete(f['urun'], gun).items(): t[m] = t.get(m, 0) + q * f['miktar']
    return t

def teslim(gun):
    t = {}
    for f in ham['faturalar']:
        if f['teslim_gunu'] != gun: continue
        for s in f['satirlar']: t[s['malzeme']] = t.get(s['malzeme'], 0) + s['gelen'] * s['carpan']
    return t

def maliyet(m, bitis):
    tutar = miktar = 0
    for f in ham['faturalar']:
        if not (bitis - 90 < f['teslim_gunu'] <= bitis): continue
        for s in f['satirlar']:
            if s['malzeme'] == m: tutar += s['tutar_dahil'] * s['gelen'] / s['miktar']; miktar += s['gelen'] * s['carpan']
    if miktar: return tutar / miktar
    return MALZ[m]['fiyat'] / (1 if MALZ[m]['birim'] == 'adet' else 1000)

sayimlar = {s['gun']: dict(s['kalemler'], **s.get('duzeltme', {})) for s in ham['sayimlar']}
genis = {g: len(k) >= 2 for g, k in sayimlar.items()}

def beklenen_rapor(c):
    son = sayimlar[c]
    if genis[c]:
        onceki = max([g for g in sayimlar if g < c and genis[g]], default=None)
    satirlar = {}
    for m, sayilan in son.items():
        adaylar = [g for g in sayimlar if g < c and m in sayimlar[g] and (not genis[c] or onceki is None or g <= onceki)]
        if not adaylar: continue
        b = max(adaylar)
        gelen = sum(teslim(d).get(m, 0) for d in range(b + 1, c + 1))
        satis = sum(satis_tuketimi(d).get(m, 0) for d in range(b + 1, c + 1))
        fr = sum(fire(d).get(m, 0) for d in range(b + 1, c + 1))
        beklenen = sayimlar[b][m] + gelen - satis - fr
        fark = sayilan - beklenen
        satirlar[m] = dict(baslangic_gun=b, baslangic=sayimlar[b][m], gelen=gelen, satis=satis, fire=fr, beklenen=round(beklenen, 3),
                           sayilan=sayilan, fark=round(fark, 3), fark_tl=round(fark * maliyet(m, c), 2))
    return satirlar

# ---------------- Uygulamanın çıktısı (yalnız okuma) ----------------
URL = 'https://urklrolemeacguleadwa.supabase.co'
KEY = open(os.path.join(BURA, '..', '..', 'config.js'), encoding='utf-8').read().split("SUPABASE_KEY = '")[1].split("'")[0]
def istek(yol, govde=None, token=None, yontem=None):
    r = urllib.request.Request(URL + yol, data=None if govde is None else json.dumps(govde).encode(),
        method=yontem or ('POST' if govde is not None else 'GET'),
        headers={'apikey': KEY, 'Content-Type': 'application/json', **({'Authorization': f'Bearer {token}'} if token else {})})
    with urllib.request.urlopen(r) as y: return json.loads(y.read().decode())
tok = istek('/auth/v1/token?grant_type=password', {'email': giris['patron']['eposta'], 'password': giris['patron']['sifre']})['access_token']
sayim_girisleri = istek('/rest/v1/girisler?tur=eq.sayim&iptal_zamani=is.null&select=id,tarih', token=tok)
gun_of = {(dt.date.fromisoformat(g['tarih']) - GUN0).days: g['id'] for g in sayim_girisleri}

sonuc = dict(raporlar=[], hatalar=[], ozet={})
kritik = 0
for c in sorted(sayimlar):
    if c == 0: continue
    bek = beklenen_rapor(c)
    app = istek('/rest/v1/rpc/stok_farki', {'p_sayim': gun_of[c]}, tok)
    app_s = {AD2KOD[x['ad']]: x for x in app['satirlar'] if x['durum'] == 'tamam'}
    rapor = dict(gun=c, tarih=iso(c), genis=genis[c], acik_tl_app=float(app['toplam_acik_tl']), fazla_tl_app=float(app['toplam_fazla_tl']),
                 malzemeler={})
    for m, b in bek.items():
        a = app_s.get(m)
        if a is None:
            sonuc['hatalar'].append(f'gün {c} {m}: uygulamada satır yok'); kritik += 1; continue
        fark_app = float(a['fark']); tl_app = float(a['fark_tl']) if a['fark_tl'] is not None else None
        d = dict(beklenen=b['beklenen'], beklenen_app=float(a['beklenen']), fark=b['fark'], fark_app=fark_app,
                 fark_tl=b['fark_tl'], fark_tl_app=tl_app, baslangic_gun=b['baslangic_gun'],
                 baslangic_gun_app=(dt.date.fromisoformat(a['baslangic_tarih']) - GUN0).days)
        ok_miktar = abs(fark_app - b['fark']) < 0.01 and d['baslangic_gun'] == d['baslangic_gun_app']
        ok_tl = tl_app is not None and abs(tl_app - b['fark_tl']) <= 0.02
        d['tamam'] = ok_miktar and ok_tl
        if not d['tamam']:
            kritik += 1
            sonuc['hatalar'].append(f"gün {c} {MALZ[m]['ad']}: fark bağımsız {b['fark']} / uygulama {fark_app}; TL {b['fark_tl']} / {tl_app}; "
                                    f"başlangıç {d['baslangic_gun']} / {d['baslangic_gun_app']}; beklenen {b['beklenen']} / {d['beklenen_app']}")
        rapor['malzemeler'][m] = d
    sonuc['raporlar'].append(rapor)

# ---------------- Gömülü açıkların fiziksel gerçeği (üretici kayıtları) ile karşılaştırma ----------------
gk = {int(k): v for k, v in ham['gizli_kayip'].items()}
cb = lambda g1, g2: sum(max(0, 1) * 0 for _ in [])  # yer tutucu
def gizli(m, g1, g2): return sum(gk.get(d, {}).get(m, 0) for d in range(g1 + 1, g2 + 1))
def recetesiz_tuketim(m, g1, g2):
    t = 0
    for d in range(g1 + 1, g2 + 1):
        net = {}
        for s in ham['satislar']:
            if s['gun'] != d or s['urun'] != ham['gomulu']['recetesiz']: continue
            k = s['fis']
            if s['durum'] == 'Satış': net[k] = net.get(k, 0) + s['adet']
            elif s['durum'] == 'İptal': net[k] = net.get(k, 0) - s['adet']
        adet = sum(max(0, a) for a in net.values())
        t += next(u for u in ham['menu'] if u['ad'] == ham['gomulu']['recetesiz'])['recete'].get(m, 0) * adet
    return t
gercek = []
for r in sonuc['raporlar']:
    for m, d in r['malzemeler'].items():
        b = d['baslangic_gun']
        beklenen_kayip = gizli(m, b, r['gun']) + recetesiz_tuketim(m, b, r['gun'])
        gercek.append(dict(gun=r['gun'], malzeme=m, uygulama_acik=-d['fark_app'], gercek_kayip=round(beklenen_kayip, 1),
                           fark=round(-d['fark_app'] - beklenen_kayip, 1)))
sonuc['gercek_kayip_karsilastirma'] = gercek
sonuc['ozet'] = dict(rapor_sayisi=len(sonuc['raporlar']), karsilastirilan_satir=sum(len(r['malzemeler']) for r in sonuc['raporlar']),
                     kritik_uyusmazlik=kritik)
json.dump(sonuc, open(os.path.join(CIKTI, 'dogrulama.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f"Karşılaştırılan rapor: {sonuc['ozet']['rapor_sayisi']}, satır: {sonuc['ozet']['karsilastirilan_satir']}, kritik uyuşmazlık: {kritik}")
for h in sonuc['hatalar'][:40]: print(' ✗', h)
# Gerçek kayıpla en büyük sapmalar (sayım yuvarlaması: süt ±50 ml, gram ±5 g)
sap = sorted(gercek, key=lambda x: -abs(x['fark']))[:8]
for x in sap: print(f"  gerçek: gün {x['gun']} {x['malzeme']}: uygulama açığı {x['uygulama_acik']}, gömülen kayıp {x['gercek_kayip']}, sapma {x['fark']}")
sys.exit(1 if kritik else 0)
