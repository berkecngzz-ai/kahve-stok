"""Okuyucu çıktısını doğru cevapla karşılaştırır ve puanlar.

Okuyucu çıktısı (belge başına) şu şemada olmalı:
{
  "tip": "fatura" | "irsaliye" | "fis",
  "tedarikci": str, "no": str|null, "tarih": "YYYY-MM-DD",
  "genel_toplam": float|null,
  "kalemler": [
    {"urun": str, "miktar": float|null, "birim": str|null,
     "stok_miktar": float|null, "stok_birim": str|null,
     "tutar": float|null,            # KDV dahil satır tutarı
     "sinif": "stok" | "gider",
     "belirsiz": str|null}           # eksik bilgi varsa kullanıcıya sorulacak not
  ]
}
"""
import difflib, re, unicodedata

TUTAR_TOL = 0.02      # satır tutarı %2
TOPLAM_TOL = 0.05     # genel toplam ±0,05 TL


def norm(s):
    s = (s or "").lower().replace("ı", "i")
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"carte ?d'?or|cdo|cartedor|pantheon|dvg|surup|metro chef|aro", " ", s)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def num_eq(a, b, tol_rel=0.0, tol_abs=0.011):
    if a is None or b is None:
        return a is None and b is None
    try:
        a, b = float(a), float(b)
    except (TypeError, ValueError):
        return False
    return abs(a - b) <= max(tol_abs, abs(b) * tol_rel)


def aggregate(items):
    """Aynı ürün birden çok satırda geldiyse (ör. Tedarikçi F) topla."""
    out = {}
    for it in items:
        k = norm(it.get("urun"))
        if k in out:
            o = out[k]
            for f in ("miktar", "stok_miktar", "tutar"):
                if o.get(f) is not None and it.get(f) is not None:
                    o[f] = float(o[f]) + float(it[f])
            o["belirsiz"] = o.get("belirsiz") or it.get("belirsiz")
        else:
            out[k] = dict(it)
    return list(out.values())


def match_items(gt_items, pred_items):
    gt_items, pred_items = aggregate(gt_items), aggregate(pred_items)
    pairs, used = [], set()
    for g in gt_items:
        best, bscore = None, 0.0
        for i, p in enumerate(pred_items):
            if i in used:
                continue
            sc = difflib.SequenceMatcher(None, norm(g["urun"]), norm(p.get("urun"))).ratio()
            if sc > bscore:
                best, bscore = i, sc
        if best is not None and bscore >= 0.55:
            used.add(best)
            pairs.append((g, pred_items[best]))
        else:
            pairs.append((g, None))
    extra = [p for i, p in enumerate(pred_items) if i not in used]
    return pairs, extra


def score_doc(gt, pred):
    checks = []  # (alan, geçti_mi, beklenen, gelen)
    def chk(name, ok, exp, got):
        checks.append({"alan": name, "gecti": bool(ok), "beklenen": exp, "gelen": got})

    if pred is None:
        chk("okuma", False, "çıktı", "yok/hata")
        return {"checks": checks, "puan": 0.0}

    chk("tip", pred.get("tip") == gt["tip"], gt["tip"], pred.get("tip"))
    chk("tarih", pred.get("tarih") == gt["tarih"], gt["tarih"], pred.get("tarih"))
    if gt.get("no"):
        chk("belge_no", (pred.get("no") or "").replace(" ", "") == gt["no"], gt["no"], pred.get("no"))
    if gt.get("genel_toplam") is not None:
        chk("genel_toplam", num_eq(pred.get("genel_toplam"), gt["genel_toplam"], tol_abs=TOPLAM_TOL),
            gt["genel_toplam"], pred.get("genel_toplam"))

    pairs, extra = match_items(gt["kalemler"], pred.get("kalemler") or [])
    for g, p in pairs:
        u = g["urun"]
        if p is None:
            chk(f"{u} / bulundu", False, "kalem", "eksik")
            continue
        chk(f"{u} / bulundu", True, "kalem", p.get("urun"))
        chk(f"{u} / sınıf", p.get("sinif") == g["sinif"], g["sinif"], p.get("sinif"))
        if g["sinif"] == "stok":
            # Birim serbest: 4 şişe / 3000 ml ikisi de doğru; 5.5 L / 1 adet ikisi de doğru
            ok_vals = {g.get("stok_miktar"), g.get("miktar")}
            if g.get("koli_ici") and g.get("miktar"):
                ok_vals = {g["miktar"] * g["koli_ici"]}
            ok_vals.discard(None)
            if g.get("stok_miktar") is None:
                okm = p.get("stok_miktar") in (None, 0)
            else:
                okm = any(num_eq(p.get("stok_miktar"), v, tol_rel=0.001) for v in ok_vals)
            chk(f"{u} / stok miktarı", okm, g.get("stok_miktar"), p.get("stok_miktar"))
        if g.get("miktar") is not None:
            chk(f"{u} / miktar", num_eq(p.get("miktar"), g["miktar"]), g["miktar"], p.get("miktar"))
        okt = [g.get("tutar")] + g.get("tutar_alternatif", [])
        if g.get("tutar") is None:
            chk(f"{u} / fiyat uydurmadı", p.get("tutar") in (None, 0, 0.0), None, p.get("tutar"))
        else:
            chk(f"{u} / tutar", any(num_eq(p.get("tutar"), t, tol_rel=TUTAR_TOL) for t in okt),
                g["tutar"], p.get("tutar"))
        if g.get("belirsiz"):
            chk(f"{u} / eksik bilgiyi işaretledi", bool(p.get("belirsiz")), "işaretli", p.get("belirsiz"))
    for p in extra:
        chk(f"fazladan kalem: {p.get('urun')}", False, "yok", p.get("urun"))

    passed = sum(c["gecti"] for c in checks)
    return {"checks": checks, "puan": passed / len(checks) if checks else 0.0}


# Tuzaklar: ürünün gerçek hayatta bozulacağı noktalar. Her biri ayrı raporlanır.
def traps(gt_by_file, pred_by_file):
    def items(fname):
        p = pred_by_file.get(fname) or {}
        return aggregate(p.get("kalemler") or [])

    def find(fname, key):
        for it in items(fname):
            if key in norm(it.get("urun")):
                return it
        return None

    res = []
    def t(name, ok, detail):
        res.append({"tuzak": name, "gecti": bool(ok), "detay": detail})

    a = find("05_tedarikci_e_fatura.jpg", "almond")
    t("Koli çarpanı: Tedarikçi E '750ML*12' → 4 şişe (48 değil)",
      a and num_eq(a.get("miktar"), 4) and a.get("stok_miktar") not in (48, 36000),
      a and {"miktar": a.get("miktar"), "stok_miktar": a.get("stok_miktar")})

    s = items("10_tedarikci_i_irsaliye.jpg")
    tot = sum(float(i.get("stok_miktar") or 0) for i in s)
    t("Koli çarpanı: Tedarikçi I 25 koli → 360 şişe", num_eq(tot, 360), {"toplam_sise": tot})

    gider_ok = all(i.get("sinif") == "gider" for f in
                   ("03_tedarikci_c_fis.jpg", "04_tedarikci_d_fis.jpg", "09_tedarikci_h_belge2.jpg") for i in items(f)) \
        and all(items(f) for f in ("03_tedarikci_c_fis.jpg", "04_tedarikci_d_fis.jpg", "09_tedarikci_h_belge2.jpg"))
    t("Gider ayrımı: jüt ip, reklam, temizlik stoğa girmiyor", gider_ok, None)

    m = find("07_tedarikci_g_fis.jpg", "meyve")
    t("Belirsiz kalem: 'MEYVE 400 TL' için kg soruluyor",
      m and m.get("belirsiz") and m.get("stok_miktar") in (None, 0), m)

    sk = find("06_tedarikci_f_fis.jpg", "mis")
    t("Gramaj yok: Tedarikçi F Mis peynir işaretleniyor", sk and sk.get("belirsiz"), sk and sk.get("belirsiz"))

    inv = [i.get("tutar") for f in ("01_tedarikci_a_irsaliye.jpg", "10_tedarikci_i_irsaliye.jpg") for i in items(f)]
    t("İrsaliye: fiyat uydurulmuyor", inv and all(x in (None, 0, 0.0) for x in inv), inv)

    su = find("01_tedarikci_a_irsaliye.jpg", "sut")
    t("Süt: Tedarikçi A 180 L doğru okunuyor", su and num_eq(su.get("stok_miktar"), 180), su and su.get("stok_miktar"))
    return res
