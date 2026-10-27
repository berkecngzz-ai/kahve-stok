# Bağımsız defter (defter.json) ↔ uygulamanın raporları (uygulama.json): her sayım, her malzeme.
import json, os, sys
BURA = os.path.dirname(os.path.abspath(__file__))
D = json.load(open(os.path.join(BURA, 'cikti', 'defter.json'), encoding='utf-8'))
U = json.load(open(os.path.join(BURA, 'cikti', 'uygulama.json'), encoding='utf-8'))
sorun, satir_say, sonuc = [], 0, {}
for kafe in 'AB':
    for gun, beklenen in D[kafe].items():
        app = U['raporlar'][kafe].get(gun)
        if app is None: sorun.append(f'{kafe} gün {gun}: uygulamada rapor yok'); continue
        for ad, b in beklenen.items():
            satir_say += 1
            a = app['satirlar'].get(ad)
            if a is None: sorun.append(f'{kafe} gün {gun} {ad}: uygulamada satır yok'); continue
            for alan in ('gelen', 'satis', 'fire', 'beklenen', 'fark'):
                if abs(a[alan] - b[alan]) > 0.01:
                    sorun.append(f'{kafe} gün {gun} {ad}: {alan} defter {b[alan]} / uygulama {a[alan]}')
            if a['fark_tl'] is None or abs(a['fark_tl'] - b['fark_tl']) > 0.02:
                sorun.append(f'{kafe} gün {gun} {ad}: TL defter {b["fark_tl"]} / uygulama {a["fark_tl"]}')
        top_d = round(sum(x['fark_tl'] for x in beklenen.values() if x['fark_tl'] < 0), 2)
        sonuc[f'{kafe}-{gun}'] = dict(defter_kayip=top_d, uygulama_kayip=float(app['acik']), malzeme=len(beklenen))
json.dump(dict(sorunlar=sorun, ozet=sonuc, satir=satir_say), open(os.path.join(BURA, 'cikti', 'karsilastirma.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'Karşılaştırılan satır: {satir_say} · uyuşmazlık: {len(sorun)}')
for k, v in sonuc.items(): print(f'  {k}: defter kayıp {v["defter_kayip"]} TL · uygulama {v["uygulama_kayip"]} TL')
for s in sorun[:40]: print(' ✗', s)
sys.exit(1 if sorun else 0)
