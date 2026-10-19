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

// Kaba kök: yaygın ekleri atar, sondaki ğ/g → k (çekirdeği → çekirdek, kahvesi → kahve).
const kok = (w) => w.replace(/(lari|leri|lar|ler|si|su|i|u)$/, '').replace(/g$/, 'k');

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
  const ham = String(metin ?? '').replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase();
  // Çoklu paket: "x12", "12x", "12'li", "12 li", "12 adet"
  let coklu = 1;
  const c1 = ham.match(/(?:^|\s|\*)x\s*(\d{1,4})\b/) || ham.match(/\b(\d{1,4})\s*x(?:\s|$)/)
          || ham.match(/\b(\d{1,4})\s*['’]?\s*l[iıuü](?![a-zçğıöşü])/);
  if (c1) coklu = Number(c1[1]);
  // Paket boyu
  const boy = ham.match(/(\d+(?:[.,]\d+)?)\s*(kg|gr|g|lt|l|ml|cl)(?![a-zçğıöşü])/);
  const boyMiktar = boy ? Number(boy[1].replace(',', '.')) : null;
  const boyBirim = boy?.[2];
  const kat = { kg: ['g', 1000], gr: ['g', 1], g: ['g', 1], lt: ['ml', 1000], l: ['ml', 1000], ml: ['ml', 1], cl: ['ml', 10] };

  if (belgeBirimi === 'kg') return malzemeBirimi === 'g' ? 1000 : null;
  if (belgeBirimi === 'g') return malzemeBirimi === 'g' ? 1 : null;
  if (belgeBirimi === 'lt') return malzemeBirimi === 'ml' ? 1000 : null;
  if (belgeBirimi === 'ml') return malzemeBirimi === 'ml' ? 1 : null;
  if (belgeBirimi === 'adet') {
    if (malzemeBirimi === 'adet') return coklu;
    if (boyMiktar && kat[boyBirim]?.[0] === malzemeBirimi) return boyMiktar * kat[boyBirim][1] * coklu;
    return null;
  }
  return null;
}

// Defterde bu satır için kayıt: önce bu tedarikçiye özel, sonra tedarikçiden bağımsız.
function defterBul(defter, tedarikciAnahtar, metinAnahtar, birim) {
  const uyan = defter.filter((d) => d.metin_anahtar === metinAnahtar && d.birim === birim);
  return uyan.find((d) => d.tedarikci_anahtar === tedarikciAnahtar)
      ?? uyan.find((d) => d.tedarikci_anahtar === '') ?? null;
}

// Bir satırı sınıflandırır.
//   satir: { metin, miktar, birim }
//   ctx:   { malzemeler: [{id, ad, birim, aktif}], defter: [...], tedarikciAnahtar }
export function siniflandir(satir, ctx) {
  const metinAnahtar = anahtar(satir.metin) || '-';
  const birim = satir.birim || 'diger';
  const malzemeBul = new Map(ctx.malzemeler.map((m) => [m.id, m]));

  const d = defterBul(ctx.defter, ctx.tedarikciAnahtar, metinAnahtar, birim);
  if (d?.sonuc === 'takip_disi') return { sinif: 'takip_disi' };
  if (d?.sonuc === 'malzeme' && malzemeBul.get(d.malzeme_id)?.aktif !== false && malzemeBul.has(d.malzeme_id)) {
    return { sinif: 'eslesti', malzeme_id: d.malzeme_id, carpan: Number(d.carpan), kaynak: 'defter' };
  }

  // Benzerlik: malzeme adları + defterde bir malzemeye bağlanmış eski satır metinleri.
  const puan = new Map();
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
    if (p >= 0.6) puan.set(k.malzeme_id, Math.max(puan.get(k.malzeme_id) ?? 0, p * 0.9));
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
  const carpan = carpanBul(birim, m.birim, satir.metin);
  if (!carpan || !(Number(satir.miktar) > 0)) return { sinif: 'belirsiz', aday_malzeme_id: enIyi };
  return { sinif: 'soru', malzeme_id: enIyi, carpan, aday_malzeme_id: enIyi };
}
