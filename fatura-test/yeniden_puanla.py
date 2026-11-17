"""Kaydedilmiş okumaları (okunan_N.json) yeniden puanlar; AI'a yeni istek ATMAZ (harcama yok).
Kullanım: PYTHONUTF8=1 python fatura-test/yeniden_puanla.py <results/..-command klasörü> [--birim-donustur]
--birim-donustur: ürün adı büyük birimle yazılmışsa ("1L", "5.5LT", "1kg") ml/g stok miktarını L/kg'a çevirir
(uygulama stoğu ml/g tutar; puanlayıcı doğru cevapta insanın yazdığı birimi bekler). Puanlayıcı ve doğru cevaplar DEĞİŞMEZ."""
import json, os, re, sys, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scorer import score_doc, traps

BASE = os.path.dirname(os.path.abspath(__file__))
klasor = sys.argv[1]
donustur = "--birim-donustur" in sys.argv
gt = json.load(open(os.path.join(BASE, "data", "ground_truth.json"), encoding="utf-8"))["belgeler"]
detay = json.load(open(os.path.join(klasor, "detay.json"), encoding="utf-8"))
RE = re.compile(r"\d[\d.,]*\s*(l|lt|litre|kg)(?![a-zA-Z])", re.I)


def uyarla(p):
    if not p or not donustur:
        return p
    for k in p.get("kalemler", []):
        if k.get("stok_birim") in ("ml", "g") and k.get("stok_miktar") is not None and RE.search(k.get("urun") or ""):
            k["stok_miktar"] = k["stok_miktar"] / 1000
            k["stok_birim"] = {"ml": "L", "g": "kg"}[k["stok_birim"]]
    return p


runs = []
n = len([f for f in os.listdir(klasor) if f.startswith("okunan_")])
for r in range(1, n + 1):
    preds = json.load(open(os.path.join(klasor, f"okunan_{r}.json"), encoding="utf-8"))
    preds = {k: uyarla(v) for k, v in preds.items()}
    docs = [{"dosya": d["dosya"], **score_doc(d, preds.get(d["dosya"]))} for d in gt]
    runs.append({"docs": docs, "traps": traps({d["dosya"]: d for d in gt}, preds), "preds": preds})

chk = [c for r in runs for d in r["docs"] for c in d["checks"]]
print(f"GENEL DOĞRULUK: %{sum(c['gecti'] for c in chk) / len(chk) * 100:.1f} ({sum(c['gecti'] for c in chk)}/{len(chk)} kontrol, {n} tur)\n")
print("TUZAKLAR (kaç turda geçti):")
for i, t in enumerate(runs[0]["traps"]):
    print(f"  {sum(r['traps'][i]['gecti'] for r in runs)}/{n}  {t['tuzak']}")
print("\nBELGE: tur puanları | süre (ilk tur, sn)")
for i, d in enumerate(gt):
    sc = [r["docs"][i]["puan"] for r in runs]
    sure = detay[0]["docs"][i].get("sure_sn")
    print(f"  {d['dosya']:30s} " + " / ".join(f"%{x * 100:.0f}" for x in sc) + f" | {sure}")
print("\nHATALAR (belge → alan: kaç turda başarısız):")
for i, d in enumerate(gt):
    sayac = collections.Counter(); ornek = {}
    for r in runs:
        for c in r["docs"][i]["checks"]:
            if not c["gecti"]:
                sayac[c["alan"]] += 1; ornek.setdefault(c["alan"], (c["beklenen"], c["gelen"]))
    if sayac:
        print(f"  {d['dosya']}")
        for a, k in sayac.most_common():
            print(f"    [{k}/{n}] {a}: beklenen `{ornek[a][0]}` ↔ gelen `{ornek[a][1]}`")
