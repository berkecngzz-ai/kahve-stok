// Gerçek tedarikçi belgelerinden (2026-11-13 testi: toptancı termal e-fatura, dondurma dağıtıcısı, süt ve su e-irsaliyesi,
// şurup e-faturası) çıkan kurallar. Satırlar belgelerdeki yazımla aynı; fiyatlar örnek.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiIleSiniflandir, carpanBul, boyutCelisir, farkliTamlama, benzerlik } from '../../eslestirme.js';
import { aiSonucunuCevir, toplamKontrol } from '../../okuma.js';

const malzemeler = [
  { id: 'sut', ad: 'Süt', birim: 'ml', aktif: true },
  { id: 'don', ad: 'Dondurma', birim: 'ml', aktif: true },
  { id: 'bad', ad: 'Badem şurubu', birim: 'ml', aktif: true },
  { id: 'k33', ad: 'Kaynak suyu 33 cl', birim: 'adet', aktif: true },
  { id: 'k40', ad: 'Kaynak suyu 40 cl', birim: 'adet', aktif: true },
  { id: 'mad', ad: 'Maden suyu', birim: 'adet', aktif: true },
  { id: 'van', ad: 'Vanilya şurubu', birim: 'ml', aktif: true },
];
const ctx = { malzemeler, defter: [], tedarikciAnahtar: 'x', tedarikciAdi: 'TEST TOPTAN' };
const ai = (id, stok, karar = 'malzeme', guven = 0.9) => ({ karar, malzeme_id: id, stok_miktari: stok, guven });
const stok = (s, k) => (k.miktarDuzelt ?? s.miktar) * k.carpan;

test('"SU" kelimesi: çamaşır suyu ve maden suyu kaynak suyu değildir', () => {
  assert.equal(farkliTamlama('Kaynak suyu 33 cl', 'DOMESTOS PRO ÇAM. SUYU 10L'), true);
  assert.equal(farkliTamlama('Kaynak suyu 33 cl', 'PRE.MADEN SUYU 25CL TYN 6BSX4'), true);
  assert.equal(farkliTamlama('Kaynak suyu 33 cl', 'PRE.KAY.SUYU 33CL TYN 12TV'), false);      // kısaltma
  assert.equal(farkliTamlama('Vanilya şurubu', 'MONIN KARAMEL ŞURUBU 70CL'), true);
  assert.equal(farkliTamlama('Espresso çekirdeği', 'ESPRESSO HARMANI ÇEKİRDEK 1KG'), false); // tamlama değil
  // AI "takip dışı" dese de baş isim ("suyu") yüzünden çamaşır suyu kaynak suyuna bağlanmaz
  const k = aiIleSiniflandir({ metin: 'DOMESTOS PRO ÇAM. SUYU 10L', miktar: 1, birim: 'adet', ai: ai(null, null, 'takip_disi') }, ctx);
  assert.equal(k.sinif, 'takip_disi');
});

test('Boyut: 40 cl satır 33 cl malzeme değildir; AI karıştırırsa doğru boyuta geçilir', () => {
  assert.equal(boyutCelisir('Kaynak suyu 33 cl', 'PRE.KAY.SUYU 40CL PET 12TV'), true);
  assert.equal(boyutCelisir('Kaynak suyu 33 cl', 'PRE.KAY.SUYU 33CL TYN 12TV'), false);
  assert.equal(boyutCelisir('Maden suyu', 'MADEN SUYU 25CL'), false);
  const s = { metin: 'PRE.KAY.SUYU 40CL PET 12TV', miktar: 10, birim: 'diger', ai: ai('k33', 120) };
  const k = aiIleSiniflandir(s, ctx);
  assert.equal(k.malzeme_id, 'k40'); assert.equal(stok(s, k), 120);
});

test('Tek harf farkı yarım eşleşmede sayılmaz: KAYMAK ≠ KAYNAK', () => {
  assert.equal(benzerlik('Kaynak suyu 33 cl', 'CDO. PANTHEON. KAYMAK 5.5 LT.'), 0);
  assert.equal(benzerlik('Kahve', 'KAHYE 1KG'), 1);   // tam eşleşmede okuma hatası hâlâ tolere edilir
});

test('Paket yazıları: 12TV, 6BSX4, 1X5.5L, 750 ML*12', () => {
  assert.equal(carpanBul('diger', 'adet', 'PRE.KAY.SUYU 33CL TYN 12TV'), 12);
  assert.equal(carpanBul('diger', 'adet', 'PRE.MADEN SUYU 25CL TYN 6BSX4'), 24);
  assert.equal(carpanBul('adet', 'ml', 'CARTEDOR BELCIKA RUYASI 1X5.5L'), 5500);
  assert.equal(carpanBul('adet', 'ml', 'DVG ŞURUP ROASTED ALMOND 750 ML*12'), 750);
  const s = { metin: 'PRE.MADEN SUYU 25CL TYN 6BSX4', miktar: 5, birim: 'diger', ai: ai('mad', null, 'takip_disi', 0.8) };
  const k = aiIleSiniflandir(s, ctx);       // AI takip dışı dese de ad birebir malzeme: sorulur, 5 kutu × 24
  assert.equal(k.malzeme_id, 'mad'); assert.equal(stok(s, k), 120); assert.equal(k.say, undefined);
});

test('AI miktarı koli içiyle çarpmış (4 Adet → 48 ml): faturanın matematiği 4 şişe, 3 L', () => {
  const s = { metin: 'DVG ŞURUP ROASTED ALMOND 750 ML*12', miktar: 48, birim: 'ml', birim_fiyat: 613.069, tutar_haric: 2452.28, ai: ai('bad', 48) };
  const k = aiIleSiniflandir(s, ctx);
  assert.equal(k.miktarDuzelt, 4); assert.equal(k.birimDuzelt, 'adet'); assert.equal(k.carpan, 750);
  assert.equal(stok(s, k), 3000); assert.equal(k.say, undefined);
});

test('Kova birimi "lt" okunmuş (1 AD 5.5LT): birim adet, 5,5 L', () => {
  const s = { metin: 'CDO. PANTHEON. ANTEP. 5.5LT.', miktar: 1, birim: 'lt', birim_fiyat: 1717.82, tutar_haric: 1546.04, ai: ai('don', 5500) };
  const k = aiIleSiniflandir(s, ctx);
  assert.equal(k.birimDuzelt, 'adet'); assert.equal(stok(s, k), 5500); assert.equal(k.say, undefined);
});

test('Satır hesabı tutmuyor (tutar > miktar × fiyat): miktara güvenilmez, barista sayar', () => {
  const k = aiIleSiniflandir({ metin: 'VANİLYA ŞURUBU 70CL', miktar: 3, birim: 'adet', birim_fiyat: 24.75, tutar_dahil: 129.9, ai: ai('van', 2100) }, ctx);
  assert.equal(k.say, true);
  // İskonto tutarı küçültür: bu tutarsızlık sayılmaz
  const k2 = aiIleSiniflandir({ metin: 'CDO. PANTHEON. ANTEP. 5.5 LT', miktar: 1, birim: 'adet', birim_fiyat: 1717.82, tutar_haric: 1546.04, ai: ai('don', 5500) }, ctx);
  assert.equal(k2.say, undefined);
});

test('İrsaliye: fiyatsız belge irsaliye sayılır, toplam istenmez', () => {
  const r = aiSonucunuCevir({ belge_turu: 'irsaliye', okunabilirlik: 'iyi', tedarikci: 'SÜT A.Ş.', vkn: '1234567890', fatura_no: 'S1',
    tarih: '2026-07-11', tutarlar_kdv_dahil: false, genel_toplam: null, kdv_haric_toplam: null, kdv_toplam: null, indirim: null,
    satirlar: [{ metin: 'SÜT YARIM YAĞLI 1 L', miktar: 180, birim: 'adet', birim_fiyat: null, tutar: null, kdv_orani: null, eslesme: ai('sut', 180000) }] });
  assert.equal(r.irsaliye, true);
  assert.ok(!r.notlar.includes('toplam_yok')); assert.ok(!r.notlar.includes('fatura_degil'));
  // Sipariş formu (diger) fiyatsız olsa da irsaliye sayılmaz
  const d = aiSonucunuCevir({ belge_turu: 'diger', okunabilirlik: 'iyi', tutarlar_kdv_dahil: false, genel_toplam: null, satirlar: [{ metin: 'SÜT', miktar: 5, birim: 'adet', birim_fiyat: null, tutar: null, eslesme: ai('sut', 5000) }] });
  assert.equal(d.irsaliye, false); assert.ok(d.notlar.includes('fatura_degil'));
});

test('Satırda iskonto düşülmüş + altta "Fat. İnd." yazıyor: indirim iki kez düşülmez, toplam tutar', () => {
  const satir = (t, bf) => ({ metin: 'DONDURMA 5.5LT', miktar: 1, birim: 'adet', birim_fiyat: bf, tutar: t, kdv_orani: null, eslesme: ai('don', 5500) });
  const r = aiSonucunuCevir({ belge_turu: 'fatura', okunabilirlik: 'iyi', tutarlar_kdv_dahil: false, genel_toplam: 9035.99, kdv_haric_toplam: 8946.52,
    kdv_toplam: 89.47, indirim: 994.06, satirlar: [satir(1546.04, 1717.82), satir(1546.04, 1717.82), satir(1546.04, 1717.82),
      satir(1381.18, 1534.65), satir(1381.18, 1534.65), satir(1546.04, 1717.82)] });
  assert.equal(r.toplamlar.indirim, 0);
  assert.equal(toplamKontrol(r).tutuyor, true);
});

test('Buruşuk fişte ara toplam yanlış okunmuş (1.183 → 1.163) ama satırlar genel toplamı veriyor: kontrol tutar', () => {
  const l = (t, k) => ({ metin: 'TEMİZLİK', miktar: 1, birim: 'adet', birim_fiyat: t, tutar: t, kdv_orani: k, eslesme: { karar: 'takip_disi', malzeme_id: null, stok_miktari: null, guven: 0.9 } });
  const r = aiSonucunuCevir({ belge_turu: 'fatura', okunabilirlik: 'iyi', tutarlar_kdv_dahil: false, genel_toplam: 1396.3, kdv_haric_toplam: 1163.26,
    kdv_toplam: 233.04, indirim: null, satirlar: [l(2.49, 20), l(99.92, 20), l(111.5, 20), l(99.92, 20), l(236.18, 10), l(633.25, 20)] });
  assert.equal(toplamKontrol(r).tutuyor, true);
  assert.equal(r.toplamlar.kdv_haric, 1183.26);
  assert.ok(r.notlar.includes('ara_toplam_duzeltildi'));
  // Satırlar genel toplamı vermiyorsa düzeltilmez
  const r2 = aiSonucunuCevir({ belge_turu: 'fatura', okunabilirlik: 'iyi', tutarlar_kdv_dahil: false, genel_toplam: 1500, kdv_haric_toplam: 1163.26,
    kdv_toplam: 233.04, indirim: null, satirlar: [l(2.49, 20), l(99.92, 20), l(111.5, 20), l(99.92, 20), l(236.18, 10), l(633.25, 20)] });
  assert.equal(toplamKontrol(r2).tutuyor, false);
});
