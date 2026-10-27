# BAĞIMSIZ HESAP DEFTERİ: yalnız cikti/plan.json'dan (uygulamaya girilenler) her sayım için beklenen stok, fark ve TL.
# Uygulamanın kodunu/veritabanını kullanmaz. Kurallar (iş kuralı, kafede elle yapılacak hesap):
#   * Sayım o günün KAPANIŞIDIR: o günün teslimatı, satışı ve firesi sayımın içindedir.
#   * Haftalık (geniş) sayımın başlangıcı bir önceki geniş sayımdır; tek malzemelik (dar) sayımınki o malzemenin önceki sayımı.
#   * Mal, teslim edildiği güne yazılır (faturanın basılı tarihine değil). Stoğa sayılan (gelen) miktar girer.
#     "Bu ürün X değil" denen satır stoğa girmez. Faturasız mal kabulü de girer.
#   * Satış, satıldığı günün reçetesiyle düşer. Aynı fiş + ürün içinde iptal satıştan düşülür (en az 0); iade stoğu etkilemez.
#     Menüde olmayan ürün (su) yok sayılır; reçetesi girilmemiş ürün (sıcak çikolata) stoktan düşmez.
#   * Fire: malzeme firesi doğrudan, ürün firesi o günün reçetesiyle. İptal edilen fire yoktur.
#   * TL = fark × ağırlıklı ortalama alış maliyeti (sayım gününe kadar son 90 günün faturaları; satır tutarı gelen/faturadaki
#     oranıyla), fatura yoksa kayıtlı fiyat. KDV dahil.
import json, os, sys
BURA = os.path.dirname(os.path.abspath(__file__))
plan = json.load(open(os.path.join(BURA, 'cikti', 'plan.json'), encoding='utf-8'))
YUV = lambda x: round(x + 0.0, 3)

def defter(kafe):
    malz = {k: dict(ad=a, birim=b, fiyat=f) for k, a, b, f in plan['malz'][kafe]}
    urun = plan['urun'][kafe]
    def recete(u, d):
        r = urun[u]['recete'] or {}
        for v in plan['recete_surum']:
            if v['kafe'] == kafe and v['urun'] == u and d >= v['gun']: r = v['recete']
        return r
    gelen, tutarlar = {}, []                     # gelen[gün][malz]; tutarlar: (gün, malz, tutar, miktar)
    for f in plan['faturalar']:
        if f['kafe'] != kafe: continue
        g = f['teslim'] or f['gun']
        for s in f['satirlar']:
            if s['karar'] == 'degil': continue
            q = s['miktar'] if s['gelen'] is None else s['gelen']
            stok = q * s['carpan']
            gelen.setdefault(g, {}); gelen[g][s['malzeme']] = gelen[g].get(s['malzeme'], 0) + stok
            if stok > 0: tutarlar.append((g, s['malzeme'], round(s['miktar'] * s['birim_fiyat'] * q / s['miktar'], 2), stok))
    for e in plan['elle']:
        if e['kafe'] != kafe: continue
        for m, q in e['kalemler']:
            gelen.setdefault(e['gun'], {}); gelen[e['gun']][m] = gelen[e['gun']].get(m, 0) + q
    tuketim = {}
    net = {}
    for (d, fis, saat, u, a, tutar, durum) in plan['satis'][kafe]:
        if u not in urun: continue
        k = (d, fis, u)
        if durum == 'Satış': net[k] = net.get(k, 0) + a
        elif durum == 'İptal': net[k] = net.get(k, 0) - a
    for (d, fis, u), a in net.items():
        for m, q in recete(u, d).items():
            tuketim.setdefault(d, {}); tuketim[d][m] = tuketim[d].get(m, 0) + q * max(0, a)
    fire = {}
    for x in plan['fire']:
        if x['kafe'] != kafe or x['iptal']: continue
        k = x['kalem']; d = x['gun']; fire.setdefault(d, {})
        if 'malzeme' in k: fire[d][k['malzeme']] = fire[d].get(k['malzeme'], 0) + k['miktar']
        else:
            for m, q in recete(k['urun'], d).items(): fire[d][m] = fire[d].get(m, 0) + q * k['miktar']
    def maliyet(m, bitis):
        t = [x for x in tutarlar if x[1] == m and bitis - 90 < x[0] <= bitis]
        if t and sum(x[3] for x in t) > 0: return sum(x[2] for x in t) / sum(x[3] for x in t)
        return malz[m]['fiyat'] / (1 if malz[m]['birim'] == 'adet' else 1000)
    sayimlar = {int(g): v for g, v in plan['sayim'][kafe].items()}
    genis = {g: len(v) >= 2 for g, v in sayimlar.items()}
    sonuc = {}
    for c in sorted(sayimlar):
        if c == 0: continue
        onceki = max([g for g in sayimlar if g < c and genis[g]], default=None) if genis[c] else None
        satir = {}
        for m, say in sayimlar[c].items():
            aday = [g for g in sayimlar if g < c and m in sayimlar[g] and (onceki is None or g <= onceki)]
            if not aday: continue
            b = max(aday)
            top = lambda tab: sum(tab.get(d, {}).get(m, 0) for d in range(b + 1, c + 1))
            gel, sat, fr = top(gelen), top(tuketim), top(fire)
            bek = sayimlar[b][m] + gel - sat - fr
            fark = say - bek
            satir[malz[m]['ad']] = dict(baslangic_gun=b, gelen=YUV(gel), satis=YUV(sat), fire=YUV(fr), beklenen=YUV(bek),
                                        sayilan=say, fark=YUV(fark), fark_tl=round(fark * maliyet(m, c), 2))
        sonuc[c] = satir
    return sonuc

if __name__ == '__main__':
    d = {k: defter(k) for k in 'AB'}
    json.dump(d, open(os.path.join(BURA, 'cikti', 'defter.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    for k in 'AB':
        for c, s in d[k].items():
            kayip = sum(x['fark_tl'] for x in s.values() if x['fark_tl'] < 0)
            print(k, 'gün', c, f'{len(s)} malzeme, kayıp {kayip:.2f} TL')
