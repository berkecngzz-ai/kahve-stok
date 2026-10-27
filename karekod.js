// Fatura karekodu (GİB Karekod Standardı Kılavuzu V1.1, Temmuz 2023): e-Fatura / e-Arşiv faturanın kâğıt
// çıktısındaki karekod faturayı kesen sistemin ürettiği JSON'dur:
//   {"vkntckn":"…","avkntckn":"…","senaryo":"TEMELFATURA","tip":"SATIS","tarih":"2022-08-17","no":"GIB2022000000001",
//    "ettn":"…","parabirimi":"TRY","malhizmettoplam":"1000.00","kdvmatrah(8)":"1000.00","hesaplanankdv(8)":"80.00",
//    "vergidahil":"1080.00","odenecek":"1080.00"}
// Satır (ürün) bilgisi YOKTUR; yalnız kimlik ve toplamlar. Karekod tek başına "fatura doğru okundu" demek değildir:
// AI'nın okuduğu toplamlarla karşılaştırılır, tutmazsa okuma şüphelidir. İrsaliye karekodunda tutar yoktur.
// Çözme cihazda yapılır (internet ve AI yok).

import { kdvOranlariniCoz } from './okuma.js?v=2785cbfc8d';

const ETTN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// "1080.00", "1 080.00", "1.080,00" → 1080
function tutarOku(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v ?? '').replace(/\s/g, '');
  if (!s) return null;
  if (/,\d{1,4}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');   // Türkçe biçim
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Alan adı: boşluklar atılır, küçük harf; "kdvmatrah (8.00)" → "kdvmatrah(8.00)"
const alanAdi = (k) => String(k).replace(/\s/g, '').toLowerCase();
const yuvarla2 = (n) => Math.round(n * 100) / 100;

// Karekod metnini çözer. Fatura karekodu değilse null.
export function karekodCoz(metin) {
  if (typeof metin !== 'string' || !metin.includes('{')) return null;
  let ham;
  try { ham = JSON.parse(metin.slice(metin.indexOf('{'), metin.lastIndexOf('}') + 1)); } catch { return null; }
  if (!ham || typeof ham !== 'object' || Array.isArray(ham)) return null;
  const a = {};
  for (const [k, v] of Object.entries(ham)) a[alanAdi(k)] = typeof v === 'string' ? v.trim() : v;

  const yazi = (k) => (a[k] == null ? null : String(a[k]).replace(/\s/g, '') || null);
  const vkn = (k) => { const d = (yazi(k) ?? '').replace(/\D/g, ''); return /^\d{10,11}$/.test(d) ? d : null; };
  const ettn = (yazi('ettn') ?? '').toLowerCase();
  const tarih = yazi('tarih');
  const matrahlar = {}, kdvler = {};
  for (const [k, v] of Object.entries(a)) {
    const m = k.match(/^(kdvmatrah|hesaplanankdv)\((\d{1,2}(?:[.,]\d+)?)%?\)$/);
    if (!m) continue;
    const oran = Number(m[2].replace(',', '.'));
    const t = tutarOku(v);
    if (!Number.isFinite(oran) || t == null) continue;
    (m[1] === 'kdvmatrah' ? matrahlar : kdvler)[oran] = ((m[1] === 'kdvmatrah' ? matrahlar : kdvler)[oran] ?? 0) + t;
  }
  const senaryo = (yazi('senaryo') ?? '').toUpperCase();
  const tip = (yazi('tip') ?? '').toUpperCase();
  const k = {
    vkn: vkn('vkntckn'), alici_vkn: vkn('avkntckn'), senaryo, tip,
    tarih: /^\d{4}-\d{2}-\d{2}$/.test(tarih ?? '') ? tarih : null,
    no: (yazi('no') ?? '').toUpperCase().slice(0, 64) || null,
    ettn: ETTN.test(ettn) ? ettn : null,
    parabirimi: (yazi('parabirimi') ?? '').toUpperCase() || null,
    malhizmet: tutarOku(a.malhizmettoplam),
    matrahlar, kdvler,
    kdv_toplam: Object.keys(kdvler).length ? yuvarla2(Object.values(kdvler).reduce((t, x) => t + x, 0)) : null,
    vergidahil: tutarOku(a.vergidahil),
    odenecek: tutarOku(a.odenecek ?? Object.entries(a).find(([x]) => /^odenecek\(/.test(x))?.[1]),
  };
  k.tur = /IRSALIYE/.test(senaryo) || ['SEVK', 'MATBUDAN'].includes(tip) ? 'irsaliye'
    : /FATURA/.test(senaryo) || k.vergidahil != null || k.odenecek != null ? 'fatura' : 'diger';
  if (!k.ettn && !k.no && k.vergidahil == null && k.odenecek == null) return null;
  return k;
}

// Karekodun toplamları okunan faturanın toplamlarıyla tutuyor mu? Karekoddaki rakamlar makine verisidir:
// kuruşuna kadar aynı olmalı (yuvarlama payı 5 kuruş). Satırların KDV hariç toplamı mal/hizmet toplamına
// yaklaşık eşit olmalı (satır yuvarlamaları için pay).
// Dönen: { tutuyor, celiskiler: [{alan, karekod, okunan}] }
export function karekodlaKarsilastir(k, sonuc) {
  const celiskiler = [];
  if (!k || k.tur !== 'fatura') return { tutuyor: null, celiskiler };
  const t = sonuc?.toplamlar ?? {};
  const fark = (a, b, pay = 0.05) => a != null && b != null && Math.abs(a - b) > pay;
  const genel = k.vergidahil ?? k.odenecek;
  // Okunan genel toplam ödenecek tutar da olabilir (tevkifatlı faturada vergi dahil tutardan küçüktür).
  if (t.genel != null && genel != null && fark(t.genel, k.vergidahil ?? genel) && fark(t.genel, k.odenecek ?? genel)) {
    celiskiler.push({ alan: 'genel', karekod: genel, okunan: t.genel });
  }
  if (fark(t.kdv, k.kdv_toplam)) celiskiler.push({ alan: 'kdv', karekod: k.kdv_toplam, okunan: t.kdv });
  const satirlar = sonuc?.satirlar ?? [];
  if (k.malhizmet != null && satirlar.length && satirlar.every((s) => s.tutar_haric != null)) {
    const haric = satirlar.reduce((x, s) => x + s.tutar_haric, 0);
    if (fark(haric, k.malhizmet, Math.max(1, 0.01 * satirlar.length))) {
      celiskiler.push({ alan: 'satirlar', karekod: k.malhizmet, okunan: yuvarla2(haric) });
    }
  }
  return { tutuyor: celiskiler.length === 0, celiskiler };
}

// Karekodun kimlik bilgilerini okunan sonuca işler (AI'nın okuduğu değerler `okunan_kimlik`te saklanır).
// Toplamlar değiştirilmez — çelişki varsa okuma şüphelidir; karar akışta verilir.
export function karekoduUygula(k, sonuc) {
  if (!k || k.tur !== 'fatura') return sonuc;
  sonuc.okunan_kimlik = { fatura_no: sonuc.fatura_no ?? null, tarih: sonuc.tarih ?? null, vkn: sonuc.tedarikci_vkn ?? null };
  if (k.ettn) sonuc.ettn = k.ettn;
  if (k.no) sonuc.fatura_no = k.no;
  if (k.tarih) sonuc.tarih = k.tarih;
  if (k.vkn) sonuc.tedarikci_vkn = k.vkn;
  // Belgede toplam okunamadıysa (fotoğrafta alt kısım yok) karekodunki kullanılır: baristaya sorulmaz.
  if (sonuc.toplamlar && sonuc.toplamlar.genel == null && (k.vergidahil ?? k.odenecek) != null) {
    sonuc.toplamlar.genel = k.vergidahil ?? k.odenecek;
    if (sonuc.toplamlar.kdv == null) sonuc.toplamlar.kdv = k.kdv_toplam;
    sonuc.notlar = (sonuc.notlar ?? []).filter((n) => n !== 'toplam_yok' && n !== 'eksik_gorunuyor');
    sonuc.notlar.push('toplam_karekoddan');
  }
  karekodVergisiniUygula(k, sonuc);
  sonuc.karekod = k;
  return sonuc;
}

// Karekoddaki vergi bilgisi (oran başına matrah / KDV, makine verisi) satırların okunamayan KDV oranı için sessizce
// kullanılır; kimseye sorulmaz. Tek oran varsa bütün satırlar o orandadır. Birden fazla oran varsa yalnız KDV
// tutarlarını TEK bir dağılım tutturuyorsa atanır; tutturmuyorsa oran boş kalır (tahmin yok).
export function karekodVergisiniUygula(k, sonuc) {
  const satirlar = sonuc?.satirlar ?? [];
  const eksik = satirlar.filter((s) => s.kdv_orani == null && s.tutar_haric != null && s.tutar_dahil == null);
  const oranlar = Object.keys(k.matrahlar ?? {}).map(Number).filter((o) => Number.isFinite(o) && o >= 0 && o <= 100);
  if (sonuc.toplamlar && sonuc.toplamlar.kdv == null && k.kdv_toplam != null) sonuc.toplamlar.kdv = k.kdv_toplam;
  if (!eksik.length || !oranlar.length) return;
  if (oranlar.length === 1) { eksik.forEach((s) => { s.kdv_orani = oranlar[0]; }); return; }
  if (satirlar.some((s) => s.tutar_haric == null)) return;
  const oranKdvleri = new Map(Object.entries(k.kdvler ?? {}).map(([o, t]) => [Number(o), t]));
  kdvOranlariniCoz(satirlar, { ...sonuc.toplamlar, kdv: k.kdv_toplam }, oranKdvleri, [], false);
}

// ---------- Tarayıcı: görüntüde karekod arama ----------
// jsQR gürültülü bir fotoğrafta birkaç saniye sürebilir (ölçüm: temiz sayfa 0,2 sn, gürültülü 2–4,5 sn) →
// ayrı bir işçide (Web Worker) çalışır, ekran donmaz. Önce sayfanın üst kısmı (e-fatura karekodu başlıktadır),
// sonra bütün sayfa, en son ters renk denemesi.

const ISCI_KODU = `importScripts(${JSON.stringify(new URL('./vendor/jsqr/jsQR.js', import.meta.url).href)});
onmessage = (e) => {
  const { data, width, height } = e.data;
  const denemeler = [[0.45, 'dontInvert'], [1, 'dontInvert'], [1, 'attemptBoth']];
  for (const [oran, ters] of denemeler) {
    const h = Math.round(height * oran);
    const q = jsQR(data.subarray(0, width * h * 4), width, h, { inversionAttempts: ters });
    if (q && q.data) { postMessage(q.data); return; }
  }
  postMessage(null);
};`;

// Görüntüyü uzun kenarı `enUzun` olacak şekilde çizer (gerekirse büyütür: küçük karekodun modülleri belirginleşir).
function goruntuVerisi(kaynak, enUzun) {
  const g = kaynak.width, y = kaynak.height;
  const olcek = enUzun / Math.max(g, y);
  const c = document.createElement('canvas');
  c.width = Math.round(g * olcek); c.height = Math.round(y * olcek);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(kaynak, 0, 0, c.width, c.height);
  return ctx.getImageData(0, 0, c.width, c.height);
}

function isciyleOku(veri) {
  return new Promise((ok) => {
    let isci;
    try {
      isci = new Worker(URL.createObjectURL(new Blob([ISCI_KODU], { type: 'text/javascript' })));
    } catch { ok(null); return; }
    const bitir = (sonuc) => { clearTimeout(sure); isci.terminate(); ok(sonuc); };
    const sure = setTimeout(() => bitir(null), 20000);
    isci.onmessage = (e) => bitir(e.data);
    isci.onerror = () => bitir(null);
    isci.postMessage({ data: veri.data, width: veri.width, height: veri.height }, [veri.data.buffer]);
  });
}

// Görüntüde (Blob, ImageBitmap ya da canvas) fatura karekodunu arar. Bulamazsa null; hiçbir zaman fırlatmaz
// (karekod okunamazsa akış AI okumasıyla devam eder).
export async function karekodBul(kaynak) {
  try {
    const bmp = kaynak instanceof Blob ? await createImageBitmap(kaynak) : kaynak;
    // 1) Telefonun kendi okuyucusu (Android Chrome): hızlı ve küçük karekodda güçlü.
    if ('BarcodeDetector' in globalThis) {
      try {
        const bulunan = await new globalThis.BarcodeDetector({ formats: ['qr_code'] }).detect(bmp);
        for (const b of bulunan) { const k = karekodCoz(b.rawValue); if (k) return { metin: b.rawValue, karekod: k }; }
      } catch { /* desteklenmiyor: jsQR'a düş */ }
    }
    // 2) jsQR (iPhone dahil her yerde): önce 1600 piksel (hızlı); bulunamazsa 2800 piksel — telefon fotoğrafında
    //    küçücük kalan karekod (modül başına < 2 piksel) ancak yüksek çözünürlükte okunur.
    for (const boy of [Math.min(1600, Math.max(bmp.width, bmp.height)), 2800]) {
      const metin = await isciyleOku(goruntuVerisi(bmp, boy));
      const k = karekodCoz(metin);
      if (k) return { metin, karekod: k };
    }
  } catch (e) {
    console.warn('Karekod aranamadı:', e);
  }
  return null;
}

// Karekodu en fazla `bekle` ms bekler; o sürede bulunamazsa { hazir: null, sonra: <arama sürüyor> } döner.
// Mal kabul önce karekoda bakar (mükerrer fatura AI'ya hiç gönderilmeden yakalanır), ama barista karekod yüzünden
// beklemez: süre dolunca AI okuması başlar, karekod arka planda bulunursa yine kullanılır.
export async function karekodOnce(kaynak, bekle = 1500) {
  const arama = karekodBul(kaynak);
  const hazir = await Promise.race([arama, new Promise((r) => setTimeout(() => r(undefined), bekle))]);
  return hazir === undefined ? { hazir: null, sonra: arama } : { hazir, sonra: Promise.resolve(hazir) };
}
