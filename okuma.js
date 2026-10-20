// Fatura okuma — tamamen telefonun tarayıcısında. Hiçbir belge ya da veri dışarı gönderilmez.
//   e-fatura XML (UBL-TR) → en güvenilir: miktar, birim, tutar, KDV doğrudan okunur
//   PDF (metinli)         → PDF'in içindeki yazı alınır, satırlara bölünür
//   taranmış PDF / foto   → OCR (Tesseract, Türkçe) ile yazıya çevrilir
// Hepsi aynı sonucu döner: { kaynak, ettn, fatura_no, tedarikci, tedarikci_vkn, tarih, toplamlar, satirlar, guven, notlar }

// ---------- Sayılar ve birimler ----------

// "1.188,12" → 1188.12 · "1188,12" → 1188.12 · "1188.12" (XML) → 1188.12 · okunamazsa null
export function trSayi(s) {
  if (s == null) return null;
  let t = String(s).replace(/[\s₺]|TL/gi, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

// UBL birim kodları ve faturada yazan birim adları → adet / kg / g / lt / ml / diger
// Paket/koli/kutu 'diger' sayılır: içinde kaç tane olduğu bilinmeden adede çevrilmez (kurulum çarpanı bir kez girer).
const BIRIM_KODLARI = { C62: 'adet', NIU: 'adet', H87: 'adet', PA: 'diger', BX: 'diger', CT: 'diger', PK: 'diger',
  KGM: 'kg', GRM: 'g', LTR: 'lt', MLT: 'ml', CLT: 'diger' };
export function birimNormal(s) {
  if (!s) return 'diger';
  const u = String(s).trim();
  if (BIRIM_KODLARI[u.toUpperCase()]) return BIRIM_KODLARI[u.toUpperCase()];
  const k = u.toLowerCase().replace(/\.$/, '').replace(/İ/g, 'i');
  if (/^(adet|ad|ade|adt|şişe|sise|bidon|tane|c62|niu)$/.test(k)) return 'adet';
  if (/^(kg|kgm|kilo|kilogram)$/.test(k)) return 'kg';
  if (/^(g|gr|gram|grm)$/.test(k)) return 'g';
  if (/^(lt|l|ltr|litre|lıtre)$/.test(k)) return 'lt';
  if (/^(ml|mlt|mililitre)$/.test(k)) return 'ml';
  return 'diger';
}

const yuvarla2 = (n) => Math.round(n * 100) / 100;

// ---------- e-fatura XML (UBL-TR) ----------

const yerel = (el) => el?.localName ?? el?.nodeName?.split(':').pop();
function cocuklar(el, ad) {
  return el ? Array.from(el.childNodes).filter((c) => c.nodeType === 1 && yerel(c) === ad) : [];
}
function ilk(el, ...yol) {
  let x = el;
  for (const ad of yol) { x = cocuklar(x, ad)[0]; if (!x) return null; }
  return x;
}
const yazi = (el) => (el?.textContent ?? '').trim() || null;
// XML'de sayılar her zaman noktalı ondalıktır ("49.505" = 49,505).
const xmlSayi = (s) => (s != null && /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null);

export function xmlOku(metin, Parser = globalThis.DOMParser) {
  const doc = new Parser().parseFromString(metin, 'application/xml');
  let kok = doc.documentElement;
  // Bazı entegratörler faturayı bir zarfın (StandardBusinessDocument) içine koyar.
  if (yerel(kok) !== 'Invoice') {
    const bul = (el) => {
      for (const c of Array.from(el.childNodes)) {
        if (c.nodeType !== 1) continue;
        if (yerel(c) === 'Invoice') return c;
        const ic = bul(c); if (ic) return ic;
      }
      return null;
    };
    kok = bul(kok);
  }
  if (!kok) throw new Error('Bu XML bir e-fatura değil.');

  const satici = ilk(kok, 'AccountingSupplierParty', 'Party');
  const kimlikler = cocuklar(satici, 'PartyIdentification').map((p) => ilk(p, 'ID'));
  const vkn = kimlikler.find((i) => /^(VKN|TCKN)$/i.test(i?.getAttribute('schemeID') ?? ''));
  const kisi = ilk(satici, 'Person');
  const tedarikci = yazi(ilk(satici, 'PartyName', 'Name'))
    ?? (kisi ? [yazi(ilk(kisi, 'FirstName')), yazi(ilk(kisi, 'FamilyName'))].filter(Boolean).join(' ') : null);

  const toplam = ilk(kok, 'LegalMonetaryTotal');
  const haric = xmlSayi(yazi(ilk(toplam, 'TaxExclusiveAmount')));
  const dahil = xmlSayi(yazi(ilk(toplam, 'TaxInclusiveAmount')));
  const odenecek = xmlSayi(yazi(ilk(toplam, 'PayableAmount')));
  const belgeIndirim = xmlSayi(yazi(ilk(toplam, 'AllowanceTotalAmount'))) ?? 0;
  const kdv = cocuklar(kok, 'TaxTotal').reduce((t, v) => t + (xmlSayi(yazi(ilk(v, 'TaxAmount'))) ?? 0), 0);

  const satirlar = cocuklar(kok, 'InvoiceLine').map((l) => {
    const q = ilk(l, 'InvoicedQuantity');
    const vergiler = cocuklar(ilk(l, 'TaxTotal'), 'TaxSubtotal');
    const kdvAlt = vergiler.find((v) => yazi(ilk(v, 'TaxCategory', 'TaxScheme', 'TaxTypeCode')) === '0015') ?? vergiler[0];
    const ad = yazi(ilk(l, 'Item', 'Name')) ?? yazi(ilk(l, 'Item', 'Description')) ?? '';
    const miktar = xmlSayi(yazi(q));
    const fiyat = xmlSayi(yazi(ilk(l, 'Price', 'PriceAmount')));
    const tutar = xmlSayi(yazi(ilk(l, 'LineExtensionAmount')));
    return {
      metin: ad,
      miktar,
      birim: birimNormal(q?.getAttribute('unitCode')),
      // Satır indirimi varsa miktar × fiyat tutarı tutmaz; e-faturada tutar kesin olduğundan fiyat kontrolü atlanır.
      birim_fiyat: fiyat != null && miktar != null && tutar != null && Math.abs(miktar * fiyat - tutar) <= 1 ? fiyat : null,
      tutar_haric: tutar,
      kdv_orani: xmlSayi(yazi(ilk(kdvAlt, 'Percent'))),
    };
  });

  // Belge düzeyinde (satırlardan sonra) indirim varsa KDV dahil karşılığı indirim olarak yazılır.
  const satirDahil = satirlar.reduce((t, s) => t + (s.tutar_haric ?? 0) * (1 + (s.kdv_orani ?? 0) / 100), 0);
  const genel = odenecek ?? dahil;
  return {
    kaynak: 'xml',
    ettn: yazi(ilk(kok, 'UUID')),
    fatura_no: yazi(ilk(kok, 'ID')),
    tedarikci,
    tedarikci_vkn: yazi(vkn),
    tarih: yazi(ilk(kok, 'IssueDate')),
    toplamlar: {
      genel,
      kdv_haric: belgeIndirim > 0 ? null : haric,
      kdv: kdv || null,
      indirim: belgeIndirim > 0 && genel != null ? Math.max(0, yuvarla2(satirDahil - genel)) : 0,
    },
    satirlar,
    guven: 1,
    notlar: [],
  };
}

// ---------- Metinden (PDF / OCR) fatura çözme ----------

const PARA = /(?<![\d.,])\d{1,3}(?:\.\d{3})*,\d{2,4}(?![\d,])|(?<![\d.,])\d+,\d{2,4}(?![\d,])/g;
const MIKTAR_BIRIM = /(?<![\d,.])(\d+(?:[.,]\d+)?)\s*(adet|ad\.?|ade|adt|kgm|kg|gr|grm|g|lt|ltr|l|litre|ml|mlt|pk|paket|koli|kutu|şişe|sise|bidon|c62|niu)(?![a-zçğıöşü])/i;
const YUZDE = /%\s*(\d{1,2})(?:[.,]0+)?(?!\d)|(?<![\d,.])(\d{1,2})(?:[.,]0+)?\s*%/g;
const KDV_ORANLARI = new Set([0, 1, 8, 10, 18, 20]);
const HARF = 'A-Za-zÇĞİÖŞÜçğıöşü';

const TOPLAM_ETIKETLERI = [
  ['genel', /(ödenecek|odenecek)\s*tutar/i, 3],
  ['genel', /vergiler\s*dahil\s*toplam/i, 2],
  ['genel', /genel\s*toplam/i, 1],
  ['kdv_haric', /mal\s*(?:\/\s*)?hizmet\s*toplam/i, 2],
  ['kdv_haric', /(ara\s*toplam|kdv\s*matrah)/i, 1],
  ['kdv', /(toplam\s*kdv|kdv\s*tutar|katma\s*değer\s*vergisi|^\s*top\.?\s*kdv)/i, 1],
  ['indirim', /(toplam\s*[iİı]skonto|[iİı]ndirim\s*toplam|toplam\s*[iİı]ndirim)/i, 1],
  ['genel', /^\s*(toplam|tutar)\s*[:*₺]?\s*\d/i, 0.5],         // fiş: "TOPLAM *609,75"
];
// Oran başına KDV satırı: "Hesaplanan KDV (%10) 506,00", fişte/OCR'da "KDV 9010 26,50" (oran bozuk okunmuş olabilir)
const KDV_SATIRI = /^\s*(?:hesaplanan\s*)?k\.?d\.?v\.?(?![a-zçğıöşü])(?!\s*(?:matrah|tutar|toplam|hari|dahil))/i;
const toplamSatiriMi = (s) => KDV_SATIRI.test(s) || TOPLAM_ETIKETLERI.some(([, re]) => re.test(s)) || /\btoplam\b/i.test(s);
// Fiş biçimi: "6 x 41,00" satırı, altında ürün adı ve tutar
const ADET_SATIRI = new RegExp(`^\\s*(\\d+(?:[.,]\\d+)?)\\s*[xX×*]\\s*(${PARA.source})\\s*\\S{0,3}\\s*$`);
const FIS_IZI = /TOPKDV|TOP\s*KDV|F[İI]Ş\s*(?:NO|\d)|\bZ\s*NO\b|EK[ÜU]\s*NO|KDV\s*DAH[İI]L/i;

// OCR'ın sık karıştırdığı karakterler: birimden önceki "İ/I/l/|" aslında "1" ("SÜT İL" → "SÜT 1L", "İKG" → "1KG").
export function ocrDuzelt(s) {
  return String(s)
    .replace(/(^|\s)[İIl|](?=(?:L|LT|KG|GR|G|ML|CL)(?![A-Za-zÇĞİÖŞÜçğıöşü]))/g, '$11')
    .replace(/(\d)[İIl|](?=(?:KG|GR|ML|CL|LT)(?![A-Za-zÇĞİÖŞÜçğıöşü]))/g, '$1');   // "1İKG" → "1KG"
}

// Satır sonundaki KDV kodu artıklarını atar: fişte "S1", OCR'da "&l1", "“10", "%1"
const kodArtigi = (s) => s.replace(/\s+(?:[%&“”"'*#]{1,2}[lI]?\d{1,2}|[A-Za-z]\d{1,2})\s*$/, '').trim();

// Satırlarda KDV oranı okunamadıysa (OCR "%10"u "9010" okur), oranları faturanın KDV tutarlarından çıkarır:
// her satıra 0/1/10/20 denenir; toplam KDV'yi, oranı belli KDV satırlarını ve (oranı okunamamış olsa bile)
// KDV satırlarının tutarlarını TEK bir dağılım tutturuyorsa o kullanılır. Birden fazla tutuyorsa tahmin yok.
//   dahil=true: satır tutarları KDV dahil (fiş) → KDV = tutar × oran / (100 + oran)
export function kdvOranlariniCoz(urunler, toplamlar, oranKdvleri = new Map(), kdvTutarlari = [], dahil = false) {
  const eksik = urunler.filter((u) => u.kdv_orani == null);
  const tutar = (u) => (dahil ? u.tutar_dahil : u.tutar_haric);
  if (!eksik.length || eksik.length > 8 || urunler.some((u) => tutar(u) == null)) return;
  let hedef = toplamlar.kdv ?? (kdvTutarlari.length ? kdvTutarlari.reduce((a, b) => a + b, 0) : null);
  if (hedef == null && !dahil && toplamlar.genel != null && toplamlar.kdv_haric != null) {
    hedef = toplamlar.genel + (toplamlar.indirim ?? 0) - toplamlar.kdv_haric;
  }
  if (hedef == null) return;
  const kdvi = (u, o) => (dahil ? (tutar(u) * o) / (100 + o) : (tutar(u) * o) / 100);
  const bilinen = urunler.filter((u) => u.kdv_orani != null);
  const secenek = [0, 1, 10, 20];
  const pay = Math.max(0.05, 0.02 * urunler.length);          // KDV kuruş yuvarlaması
  const beklenenTutarlar = [...kdvTutarlari].filter((t) => t > 0).sort((a, b) => a - b);
  const cozumler = [];
  const dene = (i, atanan) => {
    if (cozumler.length > 1) return;
    if (i === eksik.length) {
      const hepsi = [...bilinen.map((u) => [u, u.kdv_orani]), ...eksik.map((u, j) => [u, atanan[j]])];
      if (Math.abs(hepsi.reduce((t, [u, o]) => t + kdvi(u, o), 0) - hedef) > pay) return;
      for (const [o, t] of oranKdvleri) {
        if (Math.abs(hepsi.filter(([, x]) => x === o).reduce((s, [u]) => s + kdvi(u, o), 0) - t) > pay) return;
      }
      if (beklenenTutarlar.length) {
        const gruplar = new Map();
        for (const [u, o] of hepsi) if (o > 0) gruplar.set(o, (gruplar.get(o) ?? 0) + kdvi(u, o));
        const bulunan = [...gruplar.values()].sort((a, b) => a - b);
        if (bulunan.length !== beklenenTutarlar.length
            || bulunan.some((t, k) => Math.abs(t - beklenenTutarlar[k]) > pay)) return;
      }
      cozumler.push([...atanan]);
      return;
    }
    for (const o of secenek) { atanan.push(o); dene(i + 1, atanan); atanan.pop(); }
  };
  dene(0, []);
  if (cozumler.length === 1) eksik.forEach((u, j) => { u.kdv_orani = cozumler[0][j]; });
}

// Satırlar (yukarıdan aşağı metin satırları) → fatura alanları
export function metinCoz(satirlar) {
  const temiz = satirlar.map((s) => ocrDuzelt(String(s).replace(/\s+/g, ' ').trim())).filter(Boolean);
  const hepsi = temiz.join('\n');
  const notlar = [];
  const fisMi = FIS_IZI.test(hepsi);

  const ettn = hepsi.match(/ETTN\s*:?\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)?.[1] ?? null;
  const fatura_no = hepsi.match(/Fatura\s*No\s*:?\s*([A-Z0-9]{3}20\d{11}|[A-Z0-9][A-Z0-9-]{4,19})/i)?.[1]
    ?? hepsi.match(/(?:Belge|Fiş|Seri)\s*No\s*:?\s*([A-Z0-9][A-Z0-9-]{3,19})/i)?.[1]
    ?? hepsi.match(/(?:^|\s)No\s*:\s*((?=[A-Z0-9-]*[A-Z])(?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{4,19})/)?.[1] ?? null;
  const t = hepsi.match(/(?:Fatura\s*Tarihi|Düzenleme\s*Tarihi|Tarih)\s*:?\s*(\d{2})[./-](\d{2})[./-](\d{4})/i)
         ?? hepsi.match(/(\d{2})[./-](\d{2})[./-](20\d{2})/);
  const tarih = t ? `${t[3]}-${t[2]}-${t[1]}` : null;
  const vkn = hepsi.match(/(?:VKN|TCKN|Vergi\s*(?:Kimlik\s*)?(?:No|Numarası))\s*:?\s*(\d{10,11})(?!\d)/i)?.[1] ?? null;
  const unvan = new RegExp(`(?<![${HARF}])(A\\.?\\s?Ş|LTD|ŞTİ|STI|TİC|TIC|SAN|GIDA|GDA|PAZARLAMA|DAĞITIM|MARKET|TOPTAN)(?![${HARF}])`, 'i');
  const tedarikciSatiri = temiz.slice(0, 12).find((s) => unvan.test(s) && !/sayın|alıcı|müşteri/i.test(s));
  const tedarikci = tedarikciSatiri
    ? tedarikciSatiri.replace(/\s*\b(e-?\s?fatura|e-?\s?arşiv(\s*fatura)?|fatura)\s*$/i, '').trim() || null : null;

  // Toplamlar: her etiket için satırdaki son para tutarı; aynı tür için en yüksek öncelik kazanır.
  const toplamlar = { genel: null, kdv_haric: null, kdv: null, indirim: null };
  const oncelik = {};
  const belgeOranlari = new Set();
  const oranKdvleri = new Map();     // oranı okunan KDV satırları: 10 → 506,00
  const kdvTutarlari = [];           // tüm oran başına KDV satırlarının tutarları (oran okunamasa da)
  let ilkToplamSatiri = temiz.length;
  temiz.forEach((s, i) => {
    const paralar = s.match(PARA);
    if (!paralar) return;
    const deger = trSayi(paralar[paralar.length - 1]);
    if (KDV_SATIRI.test(s)) {
      kdvTutarlari.push(deger);
      const oranlar = [...s.matchAll(YUZDE)].map((m) => Number(m[1] ?? m[2])).filter((o) => KDV_ORANLARI.has(o));
      oranlar.forEach((o) => belgeOranlari.add(o));
      if (oranlar.length === 1) oranKdvleri.set(oranlar[0], deger);
      ilkToplamSatiri = Math.min(ilkToplamSatiri, i);
      return;
    }
    for (const [tur, re, p] of TOPLAM_ETIKETLERI) {
      if (!re.test(s)) continue;
      if ((oncelik[tur] ?? 0) < p) { toplamlar[tur] = deger; oncelik[tur] = p; }
      ilkToplamSatiri = Math.min(ilkToplamSatiri, i);
      break;
    }
  });
  if (toplamlar.kdv == null && kdvTutarlari.length) toplamlar.kdv = yuvarla2(kdvTutarlari.reduce((a, b) => a + b, 0));
  if (toplamlar.indirim == null) toplamlar.indirim = 0;

  const urunler = [];
  const kullanildi = new Set();
  // 1) Fiş biçimi: "6 x 41,00" + alttaki "SUT 1L YAGLI S1 246,00"
  temiz.forEach((s, i) => {
    const a = s.match(ADET_SATIRI);
    const alt = temiz[i + 1];
    if (!a || !alt || toplamSatiriMi(alt) || i + 1 >= ilkToplamSatiri) return;
    const paralar = alt.match(PARA);
    if (!paralar) return;
    const sonPara = [...alt.matchAll(PARA)].pop();
    const ad = kodArtigi(alt.slice(0, sonPara.index));
    if (ad.replace(/[^A-Za-zÇĞİÖŞÜçğıöşü]/g, '').length < 2) return;
    const agirlik = /[.,]/.test(a[1]);
    urunler.push({ metin: ad, miktar: trSayi(a[1]), birim: agirlik ? 'kg' : 'adet', birim_fiyat: trSayi(a[2]),
                   tutar: trSayi(sonPara[0]), kdv_orani: null, _fis: true });
    kullanildi.add(i); kullanildi.add(i + 1);
  });
  // 2) Fatura biçimi: miktar+birim ve en az bir para tutarı olan, toplam satırı olmayan satırlar.
  temiz.forEach((s, i) => {
    if (kullanildi.has(i) || toplamSatiriMi(s) || ADET_SATIRI.test(s)) return;
    // Miktar: ilk para tutarından hemen önceki miktar+birim ("SÜT 1L  24 Adet  49,50" → 24 Adet; 1L ürün adının parçası)
    const miktarlar = [...s.matchAll(new RegExp(MIKTAR_BIRIM.source, 'gi'))];
    const icindeMi = (k) => miktarlar.some((m) => k >= m.index && k < m.index + m[0].length);
    const ilkPara = [...s.matchAll(PARA)].find((p) => !icindeMi(p.index));
    const mb = ilkPara ? miktarlar.filter((m) => m.index + m[0].length <= ilkPara.index).pop() : null;
    if (mb) {
      const once = s.slice(0, mb.index).replace(/^\s*\d{1,3}[.)]?\s+/, '').replace(/\s+\d+(?:,\d+)?\s*$/, '').trim();
      const sonra = s.slice(mb.index + mb[0].length);
      const sonrakiParalar = sonra.match(PARA) ?? [];
      if (!sonrakiParalar.length || once.length < 2) return;
      let oran = null;
      for (const m of sonra.matchAll(YUZDE)) { const o = Number(m[1] ?? m[2]); if (KDV_ORANLARI.has(o)) oran = o; }
      urunler.push({ metin: once, miktar: trSayi(mb[1]), birim: birimNormal(mb[2]),
        birim_fiyat: sonrakiParalar.length >= 2 ? trSayi(sonrakiParalar[0]) : null,
        tutar: trSayi(sonrakiParalar[sonrakiParalar.length - 1]), kdv_orani: oran });
      return;
    }
    // 3) Fişte tek ürün: "SİMİT 15,00" (miktar yazmıyorsa 1 adet) — yalnız fişte ve toplamlardan önce
    if (fisMi && i < ilkToplamSatiri && i > 0) {
      const paralar = [...s.matchAll(PARA)];
      if (paralar.length !== 1) return;
      const ad = kodArtigi(s.slice(0, paralar[0].index));
      if (ad.replace(/[^A-Za-zÇĞİÖŞÜçğıöşü]/g, '').length < 3 || /kart|nakit|para üstü|tarih|saat/i.test(ad)) return;
      urunler.push({ metin: ad, miktar: 1, birim: 'adet', birim_fiyat: null, tutar: trSayi(paralar[0][0]), kdv_orani: null, _fis: true });
    }
  });

  // Tutarlar KDV hariç mi dahil mi? Faturada hariç; fişte çoğunlukla dahil. Toplamla hangisi tutuyorsa o.
  const toplamTutar = urunler.reduce((a, u) => a + (u.tutar ?? 0), 0);
  const pay = Math.max(1, 0.01 * urunler.length);
  const dahil = fisMi && toplamlar.genel != null && Math.abs(toplamTutar - (toplamlar.genel + toplamlar.indirim)) <= pay
    && !(toplamlar.kdv != null && Math.abs(toplamTutar + toplamlar.kdv - toplamlar.genel) <= pay && toplamlar.kdv > pay);
  for (const u of urunler) {
    if (dahil) u.tutar_dahil = u.tutar; else u.tutar_haric = u.tutar;
    delete u.tutar;
  }

  // Satırda KDV oranı yoksa ve belgede tek oran varsa onu kullan; yoksa KDV tutarlarından çöz.
  if (belgeOranlari.size === 1) {
    const [o] = belgeOranlari;
    urunler.forEach((u) => { if (u.kdv_orani == null) u.kdv_orani = o; });
  }
  kdvOranlariniCoz(urunler, toplamlar, oranKdvleri, kdvTutarlari, dahil);
  if (dahil) {
    // KDV dahil tutardan hariç tutar; oran bulunamadıysa tutar bilinmiyor sayılır (satır kuyruğa gider)
    for (const u of urunler) {
      u.tutar_haric = u.kdv_orani != null ? yuvarla2(u.tutar_dahil / (1 + u.kdv_orani / 100)) : null;
      if (u.birim_fiyat != null && u.kdv_orani != null) u.birim_fiyat = Math.round((u.birim_fiyat / (1 + u.kdv_orani / 100)) * 10000) / 10000;
    }
  }
  urunler.forEach((u) => { delete u._fis; });
  if (!urunler.length) notlar.push('satir_yok');
  if (toplamlar.genel == null) notlar.push('toplam_yok');
  if (fisMi) notlar.push(dahil ? 'fis_kdv_dahil' : 'fis');
  return { ettn, fatura_no, tedarikci, tedarikci_vkn: vkn, tarih, toplamlar, satirlar: urunler, notlar };
}

// pdf.js metin parçalarını (x, y, yazı) satırlara dizer. Büyük boşluklar korunur.
export function parcalariSatirla(parcalar) {
  const sirali = parcalar.filter((p) => p.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
  const satirlar = [];
  for (const p of sirali) {
    const son = satirlar[satirlar.length - 1];
    if (son && Math.abs(son.y - p.y) <= Math.max(2, p.h * 0.4)) son.parcalar.push(p);
    else satirlar.push({ y: p.y, parcalar: [p] });
  }
  return satirlar.map((s) => s.parcalar.sort((a, b) => a.x - b.x).map((p) => p.str.trim()).join('  '));
}

// ---------- Kontroller ----------

// Satırların toplamı faturadaki toplamla tutuyor mu? (veritabanıyla aynı kural)
export function toplamKontrol(sonuc) {
  const { genel, kdv_haric: haric, indirim } = sonuc.toplamlar;
  if (genel == null) return { tutuyor: false, sebep: 'toplam_yok' };
  if (sonuc.satirlar.some((s) => s.tutar_haric == null)) return { tutuyor: false, sebep: 'satir_tutari_yok' };
  const pay = Math.max(1, 0.01 * sonuc.satirlar.length);
  const dahil = sonuc.satirlar.reduce((t, s) => t + s.tutar_haric * (1 + (s.kdv_orani ?? 0) / 100), 0);
  const harics = sonuc.satirlar.reduce((t, s) => t + s.tutar_haric, 0);
  if (Math.abs(yuvarla2(dahil) - (indirim ?? 0) - genel) > pay) return { tutuyor: false, sebep: 'fark', fark: yuvarla2(dahil - (indirim ?? 0) - genel) };
  if (haric != null && Math.abs(harics - haric) > pay) return { tutuyor: false, sebep: 'haric_fark' };
  return { tutuyor: true };
}

// Fotoğraf net mi? Gri tonlamada Laplace farkının varyansı (düşük = bulanık).
export function netlikOlc(gri, en, boy) {
  let n = 0, top = 0, kare = 0;
  for (let y = 1; y < boy - 1; y += 2) {
    for (let x = 1; x < en - 1; x += 2) {
      const i = y * en + x;
      const l = 4 * gri[i] - gri[i - 1] - gri[i + 1] - gri[i - en] - gri[i + en];
      top += l; kare += l * l; n++;
    }
  }
  if (!n) return 0;
  const ort = top / n;
  return kare / n - ort * ort;
}
export const NETLIK_ESIGI = 40;

// ---------- Tarayıcıda dosya okuma ----------

export async function dosyaOzeti(blob) {
  const h = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const kok = new URL('./vendor/', import.meta.url).href;

let pdfjs = null;
async function pdfjsYukle() {
  if (!pdfjs) {
    pdfjs = await import(`${kok}pdfjs/pdf.min.mjs`);
    pdfjs.GlobalWorkerOptions.workerSrc = `${kok}pdfjs/pdf.worker.min.mjs`;
  }
  return pdfjs;
}

let ocrIsci = null;
let ocrIlerleme = () => {};
async function ocrHazirla(ilerleme) {
  ocrIlerleme = ilerleme ?? (() => {});
  if (!ocrIsci) {
    const mod = await import(`${kok}tesseract/tesseract.esm.min.js`);
    const createWorker = mod.createWorker ?? mod.default?.createWorker;
    ocrIsci = await createWorker('tur', 1, {
      workerPath: `${kok}tesseract/worker.min.js`,
      corePath: `${kok}tesseract/core/`,
      langPath: `${kok}tesseract/lang/`,
      gzip: true,
      workerBlobURL: false,
      logger: (m) => ocrIlerleme(m),
    });
  }
  return ocrIsci;
}

// Görseli (canvas'a çizilmiş) OCR'dan geçirir; satırlar + güven döner.
async function canvasOku(canvas, ilerleme) {
  const isci = await ocrHazirla(ilerleme);
  const { data } = await isci.recognize(canvas);
  return { satirlar: (data.text ?? '').split('\n'), guven: (data.confidence ?? 0) / 100 };
}

// Görseli tuvale çizer (uzun kenar en fazla 2400 piksel) ve netliğini ölçer.
async function goruntuHazirla(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const olcek = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * olcek);
    c.height = Math.round(img.naturalHeight * olcek);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, c.width, c.height);
    // Netlik ölçümü küçük kopyada (hızlı)
    const k = Math.min(1, 800 / Math.max(c.width, c.height));
    const kc = document.createElement('canvas');
    kc.width = Math.round(c.width * k); kc.height = Math.round(c.height * k);
    const kctx = kc.getContext('2d', { willReadFrequently: true });
    kctx.drawImage(c, 0, 0, kc.width, kc.height);
    const px = kctx.getImageData(0, 0, kc.width, kc.height).data;
    const gri = new Float32Array(kc.width * kc.height);
    for (let i = 0; i < gri.length; i++) gri[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
    return { canvas: c, netlik: netlikOlc(gri, kc.width, kc.height) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Fotoğrafları (bir faturanın sayfaları) okur.
export async function fotolariOku(bloblar, ilerleme) {
  const satirlar = [];
  let guven = 1, netlik = Infinity;
  for (const [i, b] of bloblar.entries()) {
    const g = await goruntuHazirla(b);
    netlik = Math.min(netlik, g.netlik);
    const r = await canvasOku(g.canvas, (m) => ilerleme?.({ ...m, sayfa: i + 1, sayfaSayisi: bloblar.length }));
    satirlar.push(...r.satirlar);
    guven = Math.min(guven, r.guven);
  }
  const sonuc = metinCoz(satirlar);
  if (netlik < NETLIK_ESIGI) sonuc.notlar.push('bulanik');
  if (guven < 0.6) sonuc.notlar.push('dusuk_guven');
  return { ...sonuc, kaynak: 'ocr', guven, netlik, ham_metin: satirlar.join('\n').slice(0, 20000) };
}

// PDF: metni varsa doğrudan; yoksa (taranmış) sayfaları resme çevirip OCR.
export async function pdfOku(blob, ilerleme) {
  const lib = await pdfjsYukle();
  const pdf = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
  const sayfaSayisi = Math.min(pdf.numPages, 5);
  const satirlar = [];
  let yaziUzunlugu = 0;
  for (let n = 1; n <= sayfaSayisi; n++) {
    const sayfa = await pdf.getPage(n);
    const icerik = await sayfa.getTextContent();
    const parcalar = icerik.items.map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], h: Math.abs(it.transform[3]) || 10 }));
    yaziUzunlugu += parcalar.reduce((t, p) => t + p.str.trim().length, 0);
    satirlar.push(...parcalariSatirla(parcalar));
  }
  if (yaziUzunlugu >= 40) {
    return { ...metinCoz(satirlar), kaynak: 'pdf', guven: 1, ham_metin: satirlar.join('\n').slice(0, 20000) };
  }
  // Taranmış PDF
  const ocrSatirlari = [];
  let guven = 1;
  for (let n = 1; n <= sayfaSayisi; n++) {
    const sayfa = await pdf.getPage(n);
    const vp = sayfa.getViewport({ scale: 2 });
    const c = document.createElement('canvas');
    c.width = vp.width; c.height = vp.height;
    await sayfa.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    const r = await canvasOku(c, (m) => ilerleme?.({ ...m, sayfa: n, sayfaSayisi }));
    ocrSatirlari.push(...r.satirlar);
    guven = Math.min(guven, r.guven);
  }
  const sonuc = metinCoz(ocrSatirlari);
  if (guven < 0.6) sonuc.notlar.push('dusuk_guven');
  return { ...sonuc, kaynak: 'ocr', guven, ham_metin: ocrSatirlari.join('\n').slice(0, 20000) };
}

export async function xmlDosyaOku(blob) {
  return xmlOku(await blob.text());
}

// Dosyanın türünü anlar: xml / pdf / foto
export function dosyaTuru(dosya) {
  const ad = (dosya.name ?? '').toLowerCase();
  if (dosya.type === 'application/pdf' || ad.endsWith('.pdf')) return 'pdf';
  if (/xml/.test(dosya.type) || ad.endsWith('.xml')) return 'xml';
  if (dosya.type.startsWith('image/') || /\.(jpe?g|png|webp|heic)$/.test(ad)) return 'foto';
  return 'diger';
}
