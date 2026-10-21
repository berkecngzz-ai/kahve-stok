// Fatura satırlarını takip edilen malzemelerle eşleştirme. Sunucu yok, yapay zeka yok: kurallar + defter.
//
// Sonuç her satır için:
//   eslesti     → defterde doğrulanmış kayıt var (soru yok)
//   soru        → bir malzemeye benziyor, baristaya "Bu ürün süt mü?" sorulur
//   belirsiz    → ilk kez görülen ya da emin olunamayan satır (iki aday, birim çevrilemiyor…) → kurulum kuyruğu
//   takip_disi  → YALNIZCA defterde "takip dışı" diye işaretlenmişse (peçete, deterjan…) → stoğa girmez

// Veritabanındaki metin_anahtari() ile AYNI kural.
export function anahtar(s) {
  return String(s ?? '')
    .replace(/İ/g, 'i').replace(/I/g, 'ı').replace(/Ğ/g, 'ğ').replace(/Ü/g, 'ü').replace(/Ş/g, 'ş')
    .replace(/Ö/g, 'ö').replace(/Ç/g, 'ç')
    .toLowerCase()
    .replace(/[ığüşöçâîû]/g, (c) => ({ ı: 'i', ğ: 'g', ü: 'u', ş: 's', ö: 'o', ç: 'c', â: 'a', î: 'i', û: 'u' }[c]))
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Paket boyu, çarpan ve sayı gibi ürünü tanımlamayan parçaları atar: "sutas sut 1l x12" → ["sutas", "sut"]
const BOYUT = /^(\d+([.,]\d+)?)?(kg|gr|g|lt|l|ml|cl|li|lu|lik|luk|x|adet|ad|pk|paket|koli)?$/;
const DOLGU = new Set(['ve', 'ile', 'icin', 'adet', 'koli', 'paket', 'kutu', 'kg', 'gr', 'lt', 'ml', 'tam', 'yagli', 'li', 'lu']);
export function kelimeler(s) {
  return anahtar(s).split(' ')
    .filter((k) => k.length >= 2 && !BOYUT.test(k) && !/^x\d+$|^\d+x$/.test(k) && !DOLGU.has(k));
}

function levenshtein(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

// Kaba kök: yaygın ekleri atar, ünsüz yumuşamasını geri alır: ğ/g → k, b → p, d → t
// (çekirdeği → çekirdek, şurubu → şurup, kahvesi → kahve).
const kok = (w) => w.replace(/(lari|leri|lar|ler|si|su|i|u)$/, '').replace(/g$/, 'k').replace(/b$/, 'p').replace(/d$/, 't');

// İki kelime "aynı" mı: biri ötekinin başı (süt / sütü), aynı kök ya da tek harf farkı (okuma hatası).
function kelimeUyar(a, b) {
  if (a.length < 3 || b.length < 3) return a === b;
  if (a.startsWith(b) || b.startsWith(a)) return true;
  const ka = kok(a), kb = kok(b);
  if (ka.length >= 3 && kb.length >= 3 && (ka === kb || ka.startsWith(kb) || kb.startsWith(ka))) return true;
  return Math.min(a.length, b.length) >= 4 && levenshtein(a, b) <= 1;
}

// Malzeme adının satır metnine benzerliği (0–1): malzeme kelimelerinin kaçı satırda var.
export function benzerlik(malzemeAdi, satirMetni) {
  const mk = kelimeler(malzemeAdi);
  const sk = kelimeler(satirMetni);
  if (!mk.length || !sk.length) return 0;
  const tutan = mk.filter((m) => sk.some((s) => kelimeUyar(m, s))).length;
  return tutan / mk.length;
}

// Belge birimi → malzeme birimi çarpanı (1 belge birimi = kaç g / ml / adet). Bulunamazsa null.
// Paket boyu ve çoklu paket metinden okunur: "SÜT 1L X 12", "KAHVE 250 GR", "BARDAK 50'Lİ".
export function carpanBul(belgeBirimi, malzemeBirimi, metin) {
  const ham = String(metin ?? '').replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase()
    .replace(/^\s*\d+(?:[.,]\d+)?\s*[x×*]\s*\d[\d.]*(?:,\d+)?\s*/, '');   // fişteki "6 x 41,00 " öneki ürün adı değil
  // Çoklu paket: "x12", "12x", "12'li", "12 li" (fiyat değil: "x 41,00" sayılmaz)
  let coklu = 1;
  const c1 = ham.match(/(?:^|\s|\*)x\s*(\d{1,4})(?![\d.,])/) || ham.match(/\b(\d{1,4})\s*x(?:\s|$)/)
          || ham.match(/\b(\d{1,4})\s*['’]?\s*l[iıuü](?![a-zçğıöşü])/);
  if (c1) coklu = Number(c1[1]);
  // Paket boyu
  const boy = ham.match(/(\d+(?:[.,]\d+)?)\s*(kg|gr|g|lt|l|ml|cl)(?![a-zçğıöşü])/);
  const boyMiktar = boy ? Number(boy[1].replace(',', '.')) : null;
  const boyBirim = boy?.[2];
  const kat = { kg: ['g', 1000], gr: ['g', 1], g: ['g', 1], lt: ['ml', 1000], l: ['ml', 1000], ml: ['ml', 1], cl: ['ml', 10] };

  // Ölçü birimi (kg/g/lt/ml): ürün adında başka bir paket boyu yazıyorsa miktarın paket mi ölçü mü olduğu belli değil.
  // "SODA 200ML" × 24 birim ml okunduysa 24 şişe (4.800 ml) mi 24 ml mi? → bilinmez, kurulum karar verir.
  // "TOZ ŞEKER 1KG" × 4 birim kg → paket = 1 kg, çelişki yok.
  const olcu = { kg: ['g', 1000], g: ['g', 1], lt: ['ml', 1000], ml: ['ml', 1] }[belgeBirimi];
  if (olcu) {
    if (malzemeBirimi !== olcu[0]) return null;
    if (boyMiktar && kat[boyBirim]?.[0] === olcu[0] && Math.abs(boyMiktar * kat[boyBirim][1] - olcu[1]) > 1e-9) return null;
    return olcu[1];
  }
  if (belgeBirimi === 'adet') {
    if (malzemeBirimi === 'adet') return coklu;
    if (boyMiktar && kat[boyBirim]?.[0] === malzemeBirimi) return boyMiktar * kat[boyBirim][1] * coklu;
    return null;
  }
  // Paket / koli / kutu (e-faturada BX, PA…): içindeki adet ürün adında açıkça yazıyorsa çevrilir
  // ("50'Lİ", "12'Lİ KOLİ", "X 12"); yazmıyorsa bilinmez → null (kurulum).
  if (belgeBirimi === 'diger' && c1 && coklu > 1) {
    if (malzemeBirimi === 'adet') return coklu;
    if (boyMiktar && kat[boyBirim]?.[0] === malzemeBirimi) return boyMiktar * kat[boyBirim][1] * coklu;
  }
  return null;
}

// Türkçede ürünün türünü son kelime söyler: "Karamel şurubu" → şurup, "Kahve çekirdeği" → çekirdek, "Süt" → süt.
// Satırda bu baş isim ya da kısaltması ("SRP", "ŞRP", "BRDK") var mı? "KRML SOS"ta yok → sos, şurup değildir.
const sessiz = (w) => w.replace(/[aeiou]/g, '');
function altDizi(k, u) { let i = 0; for (const c of u) if (c === k[i]) i++; return i === k.length; }
export function basIsimVarMi(malzemeAdi, satirMetni) {
  const mk = kelimeler(malzemeAdi);
  if (!mk.length) return false;
  const bas = mk[mk.length - 1];
  const iskelet = [sessiz(bas), sessiz(kok(bas))];
  return kelimeler(satirMetni).some((w) => kelimeUyar(bas, w)
    || ((w.match(/[aeiou]/g) ?? []).length <= 1 && sessiz(w).length >= 2
        && iskelet.some((s) => s.startsWith(sessiz(w)) || (sessiz(w)[0] === s[0] && altDizi(sessiz(w), s)))));
}

// Satır, malzemenin adını içerse bile başka bir ürün mü? (Türkçe tamlama ve sıfat yapısına bakar)
//   "BADEM SÜTÜ", "TÜRK KAHVESİ"  → malzeme kelimesi iyelik ekiyle, önünde başka bir isim: X'in sütü
//   "SÜT KREMASI", "BARDAK KAPAĞI" → malzeme kelimesinden sonra iyelik ekli başka bir isim: sütün kreması
//   "VANİLYALI SÜT", "AROMALI …"   → -lı/-li sıfatı: çeşnili / türev ürün
// Böyle satır malzemeye otomatik bağlanmaz; karar kurulumda verilir.
const IYELIK = /^(s?[iu])$/;
export function turevUrunMu(malzemeAdi, satirMetni) {
  const mk = kelimeler(malzemeAdi);
  const sk = kelimeler(satirMetni);
  if (!mk.length || !sk.length) return false;
  const eslesen = new Set();
  for (const m of mk) {
    const i = sk.findIndex((s, j) => !eslesen.has(j) && kelimeUyar(m, s));
    if (i < 0) continue;
    eslesen.add(i);
    const s = sk[i];
    // iyelik: satırdaki kelime = malzeme kelimesi + (s)ı/i/u/ü, malzemede ek yok, önünde eşleşmeyen bir kelime var
    if (s.length > m.length && s.startsWith(m) && IYELIK.test(s.slice(m.length)) && i > 0 && !eslesen.has(i - 1)
        && !mk.some((x) => x === s)) return true;
  }
  if (!eslesen.size) return false;
  const son = Math.max(...eslesen);
  // Malzeme adı zaten tamlamaysa ("Kahve çekirdeği", "Karamel şurubu") ardındaki kelime yeni bir tamlama değildir
  // (menşe, çeşit: "ÇEKİRDEĞİ PERU") → yalnız -lı/-li kuralı uygulanır.
  const adTamlama = mk.length >= 2 && /[^aeiou](s?[iu])$|[aeiou]s[iu]$/.test(mk[mk.length - 1]);
  for (const [j, s] of sk.entries()) {
    if (eslesen.has(j) || mk.some((m) => kelimeUyar(m, s))) continue;
    if (s.length >= 5 && /l[iu]$/.test(s)) return true;                       // -lı/-li/-lu/-lü sıfatı
    // tamlama: malzeme kelimesinin HEMEN ardından iyelik ekli isim ("süt kreması", "bardak kapağı", "süt tozu")
    if (!adTamlama && j === son + 1 && s.length >= 4 && /[^aeiou](s?[iu])$|[aeiou]s[iu]$/.test(s) && /[aeiou]/.test(s.slice(0, -1))) return true;
  }
  return false;
}

// Defterde bu satır için kayıt: önce bu tedarikçiye özel, sonra tedarikçiden bağımsız.
function defterBul(defter, tedarikciAnahtar, metinAnahtar, birim) {
  const uyan = defter.filter((d) => d.metin_anahtar === metinAnahtar && d.birim === birim);
  return uyan.find((d) => d.tedarikci_anahtar === tedarikciAnahtar)
      ?? uyan.find((d) => d.tedarikci_anahtar === '') ?? null;
}

// Defterdeki "takip dışı" kararı, karar verildikten SONRA eklenen bir malzemeyi kapsıyorsa artık geçerli sayılmaz:
// "Karton bardak 12 oz / 50'li" takip dışı işaretlendi, sonra "Karton bardak 12 oz" malzemesi açıldı → satır sessizce
// stok dışı kalmasın, kurulum yeniden karar versin. (Karardan önce var olan malzeme bilerek dışarıda bırakılmıştır.)
export function takipDisiEskimis(d, satirMetni, malzemeler) {
  if (d?.sonuc !== 'takip_disi' || !d.guncelleme) return null;
  const karar = Date.parse(d.guncelleme);
  return malzemeler.find((m) => m.aktif !== false && m.olusturma && Date.parse(m.olusturma) > karar
    && benzerlik(m.ad, satirMetni) === 1 && !turevUrunMu(m.ad, satirMetni)) ?? null;
}

// AI ile okunan satır: önce defter (doğrulanmış kayıt her zaman önce gelir), sonra AI'nın kararı.
//   AI "takip dışı" (güven ≥ 0,8)  → takip_disi  (sunucu da kendi AI kaydından doğrular)
//   AI "malzeme"   (güven ≥ 0,6)  → soru: barista "Bu ürün süt mü? 12 litre" onaylar
//      Çarpan: kuralla bulunabiliyorsa kural; AI'nın stok miktarı kuralla %1'den fazla çelişirse → belirsiz
//   diğer her durum → belirsiz (kurulum kuyruğu)
export const AI_TAKIP_DISI_GUVEN = 0.8;
export const AI_MALZEME_GUVEN = 0.6;
export function aiIleSiniflandir(satir, ctx) {
  const metinAnahtar = anahtar(satir.metin) || '-';
  const birim = satir.birim || 'diger';
  const malzemeBul = new Map(ctx.malzemeler.filter((m) => m.aktif !== false).map((m) => [m.id, m]));
  const d = defterBul(ctx.defter, ctx.tedarikciAnahtar, metinAnahtar, birim);
  const yeniMalzeme = takipDisiEskimis(d, satir.metin, ctx.malzemeler);
  if (yeniMalzeme) return { sinif: 'belirsiz', aday_malzeme_id: yeniMalzeme.id };
  if (d?.sonuc === 'takip_disi') return { sinif: 'takip_disi', kaynak: 'defter' };
  if (d?.sonuc === 'malzeme' && malzemeBul.has(d.malzeme_id)) {
    return { sinif: 'eslesti', malzeme_id: d.malzeme_id, carpan: Number(d.carpan), kaynak: 'defter' };
  }
  const ai = satir.ai;
  if (!ai) return siniflandir(satir, ctx);
  if (ai.karar === 'takip_disi' && ai.guven >= AI_TAKIP_DISI_GUVEN) {
    // Satır bir malzemenin adını tam içeriyor ve türev ürün değilse AI'nın "takip dışı" kararına güvenilmez:
    // yanlış "takip dışı" malzemeyi sessizce stoktan düşürür. Kurulumda karar verilir.
    const benzeyen = [...malzemeBul.values()].find((x) => benzerlik(x.ad, satir.metin) === 1 && !turevUrunMu(x.ad, satir.metin));
    if (benzeyen) return { sinif: 'belirsiz', aday_malzeme_id: benzeyen.id };
    return { sinif: 'takip_disi', kaynak: 'ai' };
  }
  const m = ai.karar !== 'takip_disi' ? malzemeBul.get(ai.malzeme_id) : null;
  if (!m || !(ai.guven >= AI_MALZEME_GUVEN)) return { sinif: 'belirsiz', aday_malzeme_id: m?.id ?? null };
  // Satır malzemenin türevi (krema, bitkisel/aromalı süt, kapak…) görünüyorsa AI'ya rağmen otomatik bağlanmaz.
  if (turevUrunMu(m.ad, satir.metin) || !basIsimVarMi(m.ad, satir.metin)) return { sinif: 'belirsiz', aday_malzeme_id: m.id };
  // İade / eksi satır: stoktan düşme henüz desteklenmiyor → kurulum.
  if (Number(satir.miktar) < 0 || Number(satir.tutar_belge) < 0) return { sinif: 'belirsiz', aday_malzeme_id: m.id };
  const miktar = Number(satir.miktar);
  if (!(miktar > 0)) return { sinif: 'belirsiz', aday_malzeme_id: m.id };
  const kural = carpanBul(birim, m.birim, satir.metin);
  // Belge birimi paket/diğer ise: ürün adında paket içi yazıyorsa ("50'Lİ", "1L") AI'nın hesabıyla karşılaştırılır.
  const paketYazili = /\d\s*(?:kg|gr|g|lt|l|ml|cl)(?![a-zçğıöşü])|(?:^|\s)x\s*\d|\d\s*x(?:\s|$)|\d\s*['’]?\s*l[iıuü](?![a-zçğıöşü])/i
    .test(String(satir.metin ?? '').replace(/^\s*\d+(?:[.,]\d+)?\s*[x×*]\s*\d[\d.]*(?:,\d+)?\s*/, ''));
  const paketIci = kural ?? (paketYazili ? carpanBul('adet', m.birim, satir.metin) : null);
  const aiCarpan = Number(ai.stok_miktari) > 0 ? Number(ai.stok_miktari) / miktar : null;
  if (paketIci && aiCarpan && Math.abs(paketIci - aiCarpan) / paketIci > 0.01) return { sinif: 'belirsiz', aday_malzeme_id: m.id };
  // AI "emin değilim" dediyse yalnızca miktar kuralla da doğrulanıyorsa baristaya sorulur; yoksa kuyruk.
  if (ai.karar === 'emin_degil' && !(kural && aiCarpan)) return { sinif: 'belirsiz', aday_malzeme_id: m.id };
  const carpan = kural ?? (aiCarpan ? Math.round(aiCarpan * 1e6) / 1e6 : null);
  if (!carpan) return { sinif: 'belirsiz', aday_malzeme_id: m.id };
  return { sinif: 'soru', malzeme_id: m.id, carpan, aday_malzeme_id: m.id, kaynak: 'ai' };
}

// Bir satırı sınıflandırır.
//   satir: { metin, miktar, birim }
//   ctx:   { malzemeler: [{id, ad, birim, aktif}], defter: [...], tedarikciAnahtar }
export function siniflandir(satir, ctx) {
  const metinAnahtar = anahtar(satir.metin) || '-';
  const birim = satir.birim || 'diger';
  const malzemeBul = new Map(ctx.malzemeler.map((m) => [m.id, m]));

  const d = defterBul(ctx.defter, ctx.tedarikciAnahtar, metinAnahtar, birim);
  const yeniMalzeme = takipDisiEskimis(d, satir.metin, ctx.malzemeler);
  if (yeniMalzeme) return { sinif: 'belirsiz', aday_malzeme_id: yeniMalzeme.id };
  if (d?.sonuc === 'takip_disi') return { sinif: 'takip_disi' };
  if (d?.sonuc === 'malzeme' && malzemeBul.get(d.malzeme_id)?.aktif !== false && malzemeBul.has(d.malzeme_id)) {
    return { sinif: 'eslesti', malzeme_id: d.malzeme_id, carpan: Number(d.carpan), kaynak: 'defter' };
  }

  // Benzerlik: malzeme adları + defterde bir malzemeye bağlanmış eski satır metinleri.
  const puan = new Map();
  const defterden = new Set();     // daha önce doğrulanmış bir satıra benzediği için aday olan malzemeler
  for (const m of ctx.malzemeler) {
    if (m.aktif === false) continue;
    const p = benzerlik(m.ad, satir.metin);
    if (p >= 0.5) puan.set(m.id, Math.max(puan.get(m.id) ?? 0, p));
  }
  for (const k of ctx.defter) {
    if (k.sonuc !== 'malzeme' || !malzemeBul.has(k.malzeme_id)) continue;
    const ek = kelimeler(k.metin_anahtar);
    const sk = kelimeler(satir.metin);
    if (!ek.length || !sk.length) continue;
    const ortak = ek.filter((e) => sk.some((s) => kelimeUyar(e, s))).length;
    const p = ortak / Math.max(ek.length, sk.length);
    if (p >= 0.6) { puan.set(k.malzeme_id, Math.max(puan.get(k.malzeme_id) ?? 0, p * 0.9)); defterden.add(k.malzeme_id); }
  }
  // Hiçbir malzemeye benzemiyor: yine de sessizce atlanmaz. "Takip dışı" kararı yalnızca defterden gelir
  // (kurulum bir kez işaretler, sonra hatırlanır). İlk kez görülen satır kurulum kuyruğuna gider.
  if (!puan.size) return { sinif: 'belirsiz' };

  const sirali = [...puan.entries()].sort((a, b) => b[1] - a[1]);
  const [enIyi, enIyiPuan] = sirali[0];
  const m = malzemeBul.get(enIyi);
  // İki aday birbirine çok yakınsa soru sormak yanıltır → kurulum
  if (sirali.length > 1 && sirali[1][1] >= enIyiPuan - 0.1) {
    return { sinif: 'belirsiz', aday_malzeme_id: enIyi };
  }
  // Kuralla öneri yalnızca malzeme adının tamamı satırda varsa ve satır türev ürün değilse
  // ("Kahve çekirdeği" için "ESPRESSO ÇEKİRDEK" yarım eşleşme; "SÜT KREMASI" türev) — yoksa kurulum.
  const tam = benzerlik(m.ad, satir.metin) === 1 || defterden.has(enIyi);
  if (!tam || turevUrunMu(m.ad, satir.metin)) return { sinif: 'belirsiz', aday_malzeme_id: enIyi };
  const carpan = carpanBul(birim, m.birim, satir.metin);
  if (!carpan || !(Number(satir.miktar) > 0)) return { sinif: 'belirsiz', aday_malzeme_id: enIyi };
  return { sinif: 'soru', malzeme_id: enIyi, carpan, aday_malzeme_id: enIyi };
}
