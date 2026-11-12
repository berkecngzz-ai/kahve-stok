// Fatura satırlarını mekânın stok listesindeki malzemelerle eşleştirme: defter (hafıza) + AI kararı + kurallar.
//
// Sonuç her satır için:
//   eslesti     → defterde doğrulanmış kayıt var (soru yok, barista yine sayar)
//   soru        → bir malzemeye benziyor: barista sayar ("Kaç süt geldi?"), değilse "Bu ürün süt değil" der.
//                 Çarpan bilinmiyorsa (koli içi yazmıyor) stokBirimi: barista kg / litre / adet olarak sayar.
//   belirsiz    → stok listesinde karşılığı yok (deterjan, peçete, ilk kez gelen ürün): stoğa girmez, sessizce
//                 geçilir. Otomatik yeni malzeme açılmaz; neyin takip edileceğine mekân karar verir.
//   takip_disi  → defterde ya da AI'ya göre (eminse) takip edilmeyen ürün → stoğa girmez
//   kurulum     → iade / eksi satır: stoktan düşme desteklenmiyor, kurulum bakar

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
// lev: false → tek harf farkı sayılmaz ("KAYMAK" ≠ "KAYNAK": iki ayrı gerçek kelime).
function kelimeUyar(a, b, lev = true) {
  if (a.length < 3 || b.length < 3) return a === b;
  if (a.startsWith(b) || b.startsWith(a)) return true;
  const ka = kok(a), kb = kok(b);
  if (ka.length >= 3 && kb.length >= 3 && (ka === kb || ka.startsWith(kb) || kb.startsWith(ka))) return true;
  return lev && Math.min(a.length, b.length) >= 4 && levenshtein(a, b) <= 1;
}

// Malzeme adının satır metnine benzerliği (0–1): malzeme kelimelerinin kaçı satırda var.
// Tek harf farkı yalnız TÜM kelimeler tutuyorsa sayılır (okuma hatası); yarım eşleşmede "KAYMAK"ı "KAYNAK" yapmaz.
export function benzerlik(malzemeAdi, satirMetni) {
  const mk = kelimeler(malzemeAdi);
  const sk = kelimeler(satirMetni);
  if (!mk.length || !sk.length) return 0;
  const gevsek = mk.filter((m) => sk.some((s) => kelimeUyar(m, s))).length;
  if (gevsek === mk.length) return 1;
  return mk.filter((m) => sk.some((s) => kelimeUyar(m, s, false))).length / mk.length;
}

// Paket boyutları (ml / g / oz cinsinden): "Kaynak suyu 33 cl" → [{tur:'ml', d:330}]
function boyutlar(metin) {
  const ham = String(metin ?? '').replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase();
  const kat = { kg: ['g', 1000], gr: ['g', 1], g: ['g', 1], lt: ['ml', 1000], l: ['ml', 1000], ml: ['ml', 1], cl: ['ml', 10], oz: ['oz', 1] };
  return [...ham.matchAll(/(\d+(?:[.,]\d+)?)\s*(kg|gr|g|lt|l|ml|cl|oz)(?![a-zçğıöşü])/g)]
    .map((x) => ({ tur: kat[x[2]][0], d: Math.round(Number(x[1].replace(',', '.')) * kat[x[2]][1] * 1000) / 1000 }));
}
// Malzeme adında boyut yazıyorsa ("Kaynak suyu 33 cl") satırda aynı türden BAŞKA bir boyut var ve aynısı yok → farklı ürün.
export function boyutCelisir(malzemeAdi, satirMetni) {
  const mb = boyutlar(malzemeAdi);
  if (!mb.length) return false;
  const sb = boyutlar(satirMetni);
  return mb.some((m) => sb.some((x) => x.tur === m.tur) && !sb.some((x) => x.tur === m.tur && Math.abs(x.d - m.d) < 1e-6));
}

// Malzemenin baş ismi satırda tamlama olarak başka bir belirtilenle geçiyor mu: "Kaynak suyu" ↔ "ÇAMAŞIR SUYU",
// "MADEN SUYU"; "Vanilya şurubu" ↔ "KARAMEL ŞURUBU". Aynı tür değil, başka ürün. (Kısaltma: "KAY.SUYU" kaynak suyudur.)
// Baş isim satırda eksiz geçiyorsa ("ESPRESSO HARMANI ÇEKİRDEK") tamlama değildir; bu kural uygulanmaz.
export function farkliTamlama(malzemeAdi, satirMetni, markaKelimeleri = []) {
  const mk = kelimeler(malzemeAdi);
  if (mk.length < 2) return false;
  const bas = mk[mk.length - 1], belirten = mk.slice(0, -1);
  const marka = new Set(markaKelimeleri);
  const sk = kelimeler(satirMetni);
  return sk.some((w, j) => {
    if (j === 0 || !kelimeUyar(bas, w, false) || !/[iu]$/.test(w) || w.length < 4) return false;
    const onceki = sk[j - 1];
    if (marka.has(onceki) || belirten.some((b) => kelimeUyar(b, onceki, false))) return false;
    // Satırda malzemenin belirteni başka yerde de geçiyorsa (ör. "KAYNAK DOĞAL SUYU") farklı ürün sayılmaz.
    return !belirten.some((b) => sk.some((x) => kelimeUyar(b, x, false)));
  });
}
// Bu satır bu malzeme OLAMAZ mı (boyut farkı ya da başka tamlama)?
export function baskaUrun(malzemeAdi, satirMetni, marka = []) {
  return boyutCelisir(malzemeAdi, satirMetni) || farkliTamlama(malzemeAdi, satirMetni, marka);
}

// Belge birimi → malzeme birimi çarpanı (1 belge birimi = kaç g / ml / adet). Bulunamazsa null.
// Paket boyu ve çoklu paket metinden okunur: "SÜT 1L X 12", "KAHVE 250 GR", "BARDAK 50'Lİ".
export function carpanBul(belgeBirimi, malzemeBirimi, metin) {
  const ham = String(metin ?? '').replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase()
    .replace(/^\s*\d+(?:[.,]\d+)?\s*[x×*]\s*\d[\d.]*(?:,\d+)?\s*/, '');   // fişteki "6 x 41,00 " öneki ürün adı değil
  // Çoklu paket: "x12", "12x", "12'li", "12 li" (fiyat değil: "x 41,00" sayılmaz)
  let coklu = 1;
  // İç içe paket: "6BSX4" (6'lı × 4), "6 LI X 4" → 24
  const ic = ham.match(/\b(\d{1,2})\s*[a-zçğıöşü'’]{0,3}\s*x\s*(\d{1,2})(?![\d.,a-zçğıöşü])/);
  const c1 = (ic && Number(ic[1]) > 1 && Number(ic[2]) > 1 ? [ic[0], String(Number(ic[1]) * Number(ic[2]))] : null)
          || ham.match(/(?:^|\s|\*)x\s*(\d{1,4})(?![\d.,])/) || ham.match(/\b(\d{1,4})\s*x(?:\s|$)/)
          // Dağıtıcı kısaltması: "12TV" (kutuda 12)
          || ham.match(/\b(\d{1,3})\s*tv\b/)
          || ham.match(/\b(\d{1,4})\s*['’]?\s*l[iıuü](?![a-zçğıöşü])/)
          // Paket içi dilim / porsiyon ("San Sebastian (12 dilim)") ya da parantez içinde adet ("(6 adet)").
          // Parantezsiz "12 adet" sipariş miktarı olabilir: paket içi sayılmaz.
          || ham.match(/\b(\d{1,4})\s*(?:dilim|porsiyon|parça|parca|slices?)(?![a-zçğıöşü])/)
          || ham.match(/\((\d{1,4})\s*(?:adet|ad\.?|pcs|pc|tane)\)/);
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

// Baş isim (son kelime) satırda kısaltmasız geçiyor mu: "Kahve çekirdeği" → "ÇEKİRDEK", "Süt" → "SÜT".
// basIsimVarMi'den farkı: "SRP" gibi kısaltma kabul edilmez (AI'nın kararını bozmak için daha sıkı kanıt).
export function basIsimTamVarMi(malzemeAdi, satirMetni) {
  const mk = kelimeler(malzemeAdi);
  if (!mk.length) return false;
  const bas = mk[mk.length - 1];
  return bas.length >= 3 && kelimeler(satirMetni).some((w) => kelimeUyar(bas, w));
}

// Satır, malzemenin adını içerse bile başka bir ürün mü? (Türkçe tamlama ve sıfat yapısına bakar)
//   "BADEM SÜTÜ", "TÜRK KAHVESİ"  → malzeme kelimesi iyelik ekiyle, önünde başka bir isim: X'in sütü
//   "SÜT KREMASI", "BARDAK KAPAĞI" → malzeme kelimesinden sonra iyelik ekli başka bir isim: sütün kreması
//   "VANİLYALI SÜT", "AROMALI …"   → -lı/-li sıfatı: çeşnili / türev ürün
// Böyle satır malzemeye otomatik bağlanmaz; karar kurulumda verilir.
const IYELIK = /^(s?[iu])$/;
// markaKelimeleri: tedarikçinin adındaki kelimeler. Satırda da geçiyorsa marka/üretici adıdır ("ANADOLU SÜT DAĞITIM"
// faturasında "ANADOLU TAM YAĞLI SÜT"): -lu/-li ile bitse bile sıfat (türev) sayılmaz.
// sifat: false → yalnız tamlama/iyelik (farklı ürün: kapağı, kreması, X'in sütü) aranır; -lı/-li sıfatı (çeşit:
// cidarlı bardak, aromalı şurup) türev sayılmaz. AI'nın "takip dışı" kararını bozarken bu dar anlam kullanılır.
export function turevUrunMu(malzemeAdi, satirMetni, markaKelimeleri = [], { sifat = true } = {}) {
  const mk = kelimeler(malzemeAdi);
  const marka = new Set(markaKelimeleri);
  const sk = kelimeler(satirMetni).filter((k) => !marka.has(k) || mk.some((m) => kelimeUyar(m, k)));
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
    if (sifat && s.length >= 5 && /l[iu]$/.test(s)) return true;              // -lı/-li/-lu/-lü sıfatı
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
// Benzeyen malzeme için barista sorusu: çarpan biliniyorsa paket/adet sayılır, bilinmiyorsa stok biriminde.
function soruSor(m, carpan, ek = {}) {
  return carpan > 0
    ? { sinif: 'soru', malzeme_id: m.id, carpan, aday_malzeme_id: m.id, ...ek }
    : { sinif: 'soru', malzeme_id: m.id, carpan: null, stokBirimi: true, aday_malzeme_id: m.id, ...ek };
}

export function aiIleSiniflandir(satir, ctx) {
  const metinAnahtar = anahtar(satir.metin) || '-';
  const birim = satir.birim || 'diger';
  const malzemeBul = new Map(ctx.malzemeler.filter((m) => m.aktif !== false).map((m) => [m.id, m]));
  const d = defterBul(ctx.defter, ctx.tedarikciAnahtar, metinAnahtar, birim);
  const yeniMalzeme = takipDisiEskimis(d, satir.metin, ctx.malzemeler);
  if (yeniMalzeme) return soruSor(yeniMalzeme, carpanBul(birim, yeniMalzeme.birim, satir.metin));
  if (d?.sonuc === 'takip_disi') return { sinif: 'takip_disi', kaynak: 'defter' };
  if (d?.sonuc === 'malzeme' && malzemeBul.has(d.malzeme_id)) {
    const carpan = Number(d.carpan), miktar = Number(satir.miktar), aiStok = Number(satir.ai?.stok_miktari);
    const karar = { sinif: 'eslesti', malzeme_id: d.malzeme_id, carpan, kaynak: 'defter' };
    // Defterdeki paket içi doğrudur ama AI bu kez miktarı başka birimde okumuş olabilir ("3 koli" yerine 36): stok hesabı
    // çelişiyorsa faturanın matematiğine (tutar ÷ birim fiyat) bakılır; o da çözmezse barista sayar.
    if (miktar > 0 && aiStok > 0 && Math.abs(miktar * carpan - aiStok) > 0.01 * aiStok) {
      const tutar = Number(satir.tutar_haric ?? satir.tutar_belge ?? satir.tutar_dahil), bf = Number(satir.birim_fiyat);
      const paket = tutar > 0 && bf > 0 ? tutar / bf : NaN, n = Math.round(paket);
      const tamMi = n >= 1 && Math.abs(paket - n) <= 0.02 * n;
      if (tamMi && Math.abs(n * carpan - aiStok) <= 0.01 * aiStok) return { ...karar, ...(n === miktar ? {} : { miktarDuzelt: n }) };
      if (tamMi && n === miktar && aiStok > miktar * carpan) return karar;   // AI paket içini büyük hesaplamış: miktar doğru
      return { ...karar, say: true };
    }
    return karar;
  }
  if (!satir.ai) return siniflandir(satir, ctx);
  const ai = { ...satir.ai };
  const marka = kelimeler(ctx.tedarikciAdi);
  if (ai.karar === 'takip_disi' && ai.guven >= AI_TAKIP_DISI_GUVEN) {
    // Satır bir malzemenin adını ya da türünü söyleyen baş ismini ("ESPRESSO HARMANI ÇEKİRDEK" → çekirdek) taşıyor ve
    // başka bir ürün (tamlama: "bardak kapağı", "süt kreması") değilse AI'nın "takip dışı" kararına güvenilmez:
    // yanlış "takip dışı" malzemeyi sessizce stoktan düşürür. Barista sayar ya da "değil" der.
    const benzeyen = [...malzemeBul.values()].find((x) => (benzerlik(x.ad, satir.metin) === 1 || basIsimTamVarMi(x.ad, satir.metin))
      && !turevUrunMu(x.ad, satir.metin, marka, { sifat: false }) && !baskaUrun(x.ad, satir.metin, marka));
    if (benzeyen) return soruSor(benzeyen, carpanBul(birim, benzeyen.birim, satir.metin));
    return { sinif: 'takip_disi', kaynak: 'ai' };
  }
  let m = ai.karar !== 'takip_disi' ? malzemeBul.get(ai.malzeme_id) : null;
  // AI'nın seçtiği malzemenin boyutu satırla çelişiyor ("40CL" satır → "Kaynak suyu 33 cl"): aynı adlı, boyutu tutan
  // malzeme varsa o; yoksa bu malzeme değildir.
  if (m && boyutCelisir(m.ad, satir.metin)) {
    const ad = kelimeler(m.ad).join(' ');
    const dogru = [...malzemeBul.values()].find((x) => x !== m && kelimeler(x.ad).join(' ') === ad && !boyutCelisir(x.ad, satir.metin));
    if (!dogru) return { sinif: 'belirsiz', aday_malzeme_id: m.id };
    m = dogru;
    ai.stok_miktari = null;      // AI'nın stok hesabı öbür boyuta göreydi
  }
  // AI listede karşılık bulamadı ya da emin değil: kurallar denenir (benzeyen varsa sorulur, yoksa geçilir).
  if (!m) return siniflandir(satir, ctx);
  if (farkliTamlama(m.ad, satir.metin, marka)) return { sinif: 'belirsiz', aday_malzeme_id: m.id };
  // Okuma düzeltmeleri (bir kez): faturanın kendi matematiği ve ürün adındaki paket boyu
  //  · birim ölçü (lt/ml/kg/g) okundu ama ürün adında başka bir paket boyu var ("1 AD" 5.5LT kova → "1 lt") → birim adet
  //  · miktar paket içiyle çarpılmış okundu ("4 Adet" 750 ML*12 → 48): tutar ÷ birim fiyat tam sayı ve miktarı bölüyor →
  //    belgedeki miktar odur; AI'nın stok hesabı bu yanlış miktara dayandığı için kullanılmaz.
  if (!ctx.okumaDuzeltildi) {
    const mk = Number(satir.miktar);
    const birimD = ['lt', 'ml', 'kg', 'g'].includes(birim) && carpanBul(birim, m.birim, satir.metin) == null
      && carpanBul('adet', m.birim, satir.metin) != null ? 'adet' : null;
    const tutar = Number(satir.tutar_haric ?? satir.tutar_belge ?? satir.tutar_dahil), bf = Number(satir.birim_fiyat);
    const q = tutar > 0 && bf > 0 ? tutar / bf : NaN, rq = Math.round(q);
    const miktarD = rq >= 1 && Math.abs(q - rq) <= 0.02 * rq && mk > rq && mk % rq === 0 ? rq : null;
    if (birimD || miktarD) {
      const k = aiIleSiniflandir({ ...satir, birim: birimD ?? birim, miktar: miktarD ?? satir.miktar,
        ai: { ...satir.ai, stok_miktari: miktarD ? null : satir.ai.stok_miktari } }, { ...ctx, okumaDuzeltildi: true });
      return { ...k, ...(miktarD && k.miktarDuzelt == null ? { miktarDuzelt: miktarD } : {}), ...(birimD ? { birimDuzelt: birimD } : {}) };
    }
    // Satırın kendi hesabı tutmuyor: tutar, miktar × birim fiyattan BÜYÜK (iskonto küçültür, büyütmez). Fişte çarpan satırı
    // başka ürüne verilmiş olabilir ("3 X 24,75" peçetenin, bardağa da yazılmış). Miktara güvenilmez: barista sayar.
    if (mk > 0 && bf > 0 && tutar > mk * bf * 1.02 + 0.05) {
      const k = aiIleSiniflandir(satir, { ...ctx, okumaDuzeltildi: true });
      return ['soru', 'eslesti'].includes(k.sinif) ? { ...k, say: true } : k;
    }
  }
  // Satır başka bir ürün (tamlama: süt kreması, bardak kapağı, badem sütü): o malzeme değil → geçilir.
  // Yalnız -lı/-li sıfatı (vanilyalı süt; ama marka da olabilir: "ANADOLU") → sessizce geçilmez, barista sayar ya da "değil" der.
  if (turevUrunMu(m.ad, satir.metin, marka, { sifat: false })) return { sinif: 'belirsiz', aday_malzeme_id: m.id };
  // İade / eksi satır: stoktan düşme henüz desteklenmiyor → kurulum.
  if (Number(satir.miktar) < 0 || Number(satir.tutar_belge) < 0) return { sinif: 'kurulum', aday_malzeme_id: m.id };
  const miktar = Number(satir.miktar);
  const kural = carpanBul(birim, m.birim, satir.metin);
  // Miktar okunamadı: barista stok biriminde sayar.
  if (!(miktar > 0)) return soruSor(m, null, { kaynak: 'ai' });
  // Belge birimi paket/diğer ise: ürün adında paket içi yazıyorsa ("50'Lİ", "1L") AI'nın hesabıyla karşılaştırılır.
  const paketYazili = /\d\s*(?:kg|gr|g|lt|l|ml|cl)(?![a-zçğıöşü])|(?:^|\s)x\s*\d|\d\s*x(?:\s|$)|\d\s*['’]?\s*l[iıuü](?![a-zçğıöşü])/i
    .test(String(satir.metin ?? '').replace(/^\s*\d+(?:[.,]\d+)?\s*[x×*]\s*\d[\d.]*(?:,\d+)?\s*/, ''));
  const paketIci = kural ?? (paketYazili ? carpanBul('adet', m.birim, satir.metin) : null);
  const aiCarpan = Number(ai.stok_miktari) > 0 ? Number(ai.stok_miktari) / miktar : null;
  // Ürün adındaki paket içi ("25'Lİ", "(500'lü)") AI'nın stok hesabıyla çelişiyor: hangisinin doğru olduğu belgeden
  // anlaşılmaz (3 paket mi 3 bardak mı?). Barista geleni sayar: "Kaç paket geldi? 1 paket = 25 adet".
  if (paketIci && aiCarpan && Math.abs(paketIci - aiCarpan) / paketIci > 0.01) {
    // Önce faturanın kendi matematiği: tutar ÷ birim fiyat, belgedeki gerçek paket sayısıdır. Tam sayıysa çelişki çözülür:
    //  · okunan miktarla aynı → miktar doğru, AI'nın stok hesabı yanlış ("10 adet 1 kg" → AI 100 kg dese de 10 kg)
    //  · farklı ama paket sayısı × paket içi = AI'nın stoğu → AI miktarı stok birimine çevirmiş ("3 koli" → 36 lt)
    const tutar = Number(satir.tutar_haric ?? satir.tutar_belge ?? satir.tutar_dahil), bf = Number(satir.birim_fiyat);
    const paket = tutar > 0 && bf > 0 ? tutar / bf : NaN;
    const n = Math.round(paket);
    if (n >= 1 && Math.abs(paket - n) <= 0.02 * n && paketIci > 1) {
      // AI paket içini daha büyük hesaplamışsa yanılmıştır. Daha küçükse ("36 adet × 44,55", 12'li koli) miktar şişe de koli
      // de olabilir: matematik ikisini de doğrular, tahmin edilmez, barista sayar.
      if (n === miktar) return aiCarpan > paketIci ? soruSor(m, paketIci, { kaynak: 'ai' }) : soruSor(m, paketIci, { kaynak: 'ai', say: true });
      if (Math.abs(n * paketIci - Number(ai.stok_miktari)) <= 0.01 * Number(ai.stok_miktari)) {
        return soruSor(m, paketIci, { kaynak: 'ai', miktarDuzelt: n });
      }
    }
    return paketIci > 1 ? soruSor(m, paketIci, { kaynak: 'ai', say: true }) : soruSor(m, null, { kaynak: 'ai' });
  }
  // AI emin değil, düşük güven ya da baş isim yok: yine barista sayar (değilse "değil" der).
  // Çarpan yalnızca kuralla ya da AI'nın hesabıyla bulunduysa kullanılır; ikisi de yoksa stok biriminde sayılır.
  const carpan = kural ?? (aiCarpan ? Math.round(aiCarpan * 1e6) / 1e6 : null);
  return soruSor(m, carpan, { kaynak: 'ai' });
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
  if (yeniMalzeme) return soruSor(yeniMalzeme, carpanBul(birim, yeniMalzeme.birim, satir.metin));
  if (d?.sonuc === 'takip_disi') return { sinif: 'takip_disi' };
  if (d?.sonuc === 'malzeme' && malzemeBul.get(d.malzeme_id)?.aktif !== false && malzemeBul.has(d.malzeme_id)) {
    return { sinif: 'eslesti', malzeme_id: d.malzeme_id, carpan: Number(d.carpan), kaynak: 'defter' };
  }

  // Benzerlik: malzeme adları + defterde bir malzemeye bağlanmış eski satır metinleri.
  const puan = new Map();
  const defterden = new Set();     // daha önce doğrulanmış bir satıra benzediği için aday olan malzemeler
  const marka = kelimeler(ctx.tedarikciAdi);
  for (const m of ctx.malzemeler) {
    if (m.aktif === false || baskaUrun(m.ad, satir.metin, marka)) continue;
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
  // Hiçbir malzemeye benzemiyor: stok listesinde karşılığı yok → sessizce geçilir (otomatik malzeme açılmaz).
  if (!puan.size) return { sinif: 'belirsiz' };

  const sirali = [...puan.entries()].sort((a, b) => b[1] - a[1]);
  const [enIyi] = sirali[0];
  const m = malzemeBul.get(enIyi);
  // Başka ürün (tamlama: "SÜT KREMASI", "TÜRK KAHVESİ"): o malzeme değil → geçilir. Diğer adaylarda (yarım eşleşme, iki yakın
  // aday) barista sayar; yanlışsa "Bu ürün X değil" der ve satır geçilir: barista malı elinde görüyor.
  if (turevUrunMu(m.ad, satir.metin, kelimeler(ctx.tedarikciAdi), { sifat: false })) return { sinif: 'belirsiz', aday_malzeme_id: enIyi };
  if (Number(satir.miktar) < 0) return { sinif: 'kurulum', aday_malzeme_id: enIyi };
  const carpan = Number(satir.miktar) > 0 ? carpanBul(birim, m.birim, satir.metin) : null;
  return soruSor(m, carpan);
}
