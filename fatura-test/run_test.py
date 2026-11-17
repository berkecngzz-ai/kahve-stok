"""Fatura okuma testi.

Kullanım:
  python run_test.py --reader claude            # Claude API ile oku (ANTHROPIC_API_KEY gerekir)
  python run_test.py --reader command           # kendi uygulamanın okuyucusu (READER_CMD)
  python run_test.py --reader mock              # puanlayıcının çalıştığını kontrol et
  python run_test.py --reader claude --runs 3   # aynı belgeyi 3 kez oku, tutarlılığı ölç
  python run_test.py --only 05                  # tek belge
"""
import argparse, datetime, importlib, json, os, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scorer import score_doc, traps

BASE = os.path.dirname(os.path.abspath(__file__))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reader", default="claude", choices=["claude", "command", "mock"])
    ap.add_argument("--runs", type=int, default=1)
    ap.add_argument("--only", default=None)
    a = ap.parse_args()

    reader = importlib.import_module(f"readers.{a.reader}_reader")
    gt = json.load(open(os.path.join(BASE, "data", "ground_truth.json")))["belgeler"]
    if a.only:
        gt = [d for d in gt if d["dosya"].startswith(a.only)]

    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    outdir = os.path.join(BASE, "results", f"{stamp}-{a.reader}")
    os.makedirs(outdir, exist_ok=True)

    runs = []
    for r in range(a.runs):
        preds, docs, durations = {}, [], {}
        for d in gt:
            img = os.path.join(BASE, "data", "images", d["dosya"])
            t0 = time.time()
            try:
                p = reader.read(img)
            except Exception as e:
                print(f"  ! {d['dosya']}: {e}")
                p = None
            durations[d["dosya"]] = round(time.time() - t0, 1)
            preds[d["dosya"]] = p
            s = score_doc(d, p)
            docs.append({"dosya": d["dosya"], **s, "sure_sn": durations[d["dosya"]]})
            print(f"[{r+1}/{a.runs}] {d['dosya']:32s} %{s['puan']*100:5.1f}  ({durations[d['dosya']]} sn)")
        tr = traps({d["dosya"]: d for d in gt}, preds) if not a.only else []
        json.dump(preds, open(os.path.join(outdir, f"okunan_{r+1}.json"), "w"), ensure_ascii=False, indent=1)
        runs.append({"docs": docs, "traps": tr})

    write_report(runs, outdir, a.reader)


def write_report(runs, outdir, reader):
    n = len(runs)
    all_checks = [c for r in runs for d in r["docs"] for c in d["checks"]]
    overall = sum(c["gecti"] for c in all_checks) / len(all_checks)
    L = [f"# Fatura okuma testi — {reader}", "",
         f"**Genel doğruluk: %{overall*100:.1f}** ({sum(c['gecti'] for c in all_checks)}/{len(all_checks)} kontrol, {n} tur)", ""]

    if runs[0]["traps"]:
        L += ["## Tuzaklar", "", "| Tuzak | Sonuç |", "|---|---|"]
        for i, t in enumerate(runs[0]["traps"]):
            ok = sum(r["traps"][i]["gecti"] for r in runs)
            L.append(f"| {t['tuzak']} | {'✅' if ok == n else ('❌' if ok == 0 else f'⚠️ {ok}/{n}')} |")
        L.append("")

    L += ["## Belge bazında", "", "| Belge | Doğruluk | Süre |", "|---|---|---|"]
    for i, d in enumerate(runs[0]["docs"]):
        sc = [r["docs"][i]["puan"] for r in runs]
        sp = f"%{min(sc)*100:.0f}–%{max(sc)*100:.0f}" if n > 1 and min(sc) != max(sc) else f"%{sc[0]*100:.0f}"
        L.append(f"| {d['dosya']} | {sp} | {d['sure_sn']} sn |")

    L += ["", "## Hatalar (1. tur)", ""]
    for d in runs[0]["docs"]:
        bad = [c for c in d["checks"] if not c["gecti"]]
        if bad:
            L.append(f"**{d['dosya']}**")
            L += [f"- {c['alan']}: beklenen `{c['beklenen']}`, gelen `{c['gelen']}`" for c in bad]
            L.append("")
    rep = "\n".join(L)
    open(os.path.join(outdir, "rapor.md"), "w").write(rep)
    json.dump(runs, open(os.path.join(outdir, "detay.json"), "w"), ensure_ascii=False, indent=1, default=str)
    print("\n" + rep)
    print(f"\nRapor: {os.path.join(outdir, 'rapor.md')}")


if __name__ == "__main__":
    main()
