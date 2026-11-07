import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anahtar, kelimeler, benzerlik, carpanBul, siniflandir, turevUrunMu, basIsimVarMi, aiIleSiniflandir } from '../../eslestirme.js';

test('anahtar SQL ile aynı', () => {
  assert.equal(anahtar('SÜTAŞ Süt 1L x12, İÇİM!'), 'sutas sut 1l x12 icim');
  assert.equal(anahtar('ŞEKER  ı/İ'), 'seker i i');
});
test('kelimeler boyutları atar', () => {
  assert.deepEqual(kelimeler('SÜTAŞ SÜT 1L X12'), ['sutas', 'sut']);
  assert.deepEqual(kelimeler('Kahve Çekirdeği 1 KG'), ['kahve', 'cekirdegi']);
  assert.deepEqual(kelimeler('Bardak 50\'li'), ['bardak']);
});
test('benzerlik', () => {
  assert.equal(benzerlik('Süt', 'SÜTAŞ SÜT 1L'), 1);
  assert.equal(benzerlik('Kahve çekirdeği', 'ESPRESSO KAHVE ÇEKİRDEK 1KG'), 1);
  assert.equal(benzerlik('Süt', 'DETERJAN 5L'), 0);
  assert.equal(benzerlik('Karton bardak', 'KARTON BARDAK 8OZ 50LI'), 1);
  assert.equal(benzerlik('Süt', 'SUT 1L'), 1);        // okuma: Türkçe harf kayıp
  assert.equal(benzerlik('Kahve', 'KAHYE 1KG'), 1);   // okuma: tek harf hatası
});
test('çarpan', () => {
  assert.equal(carpanBul('adet', 'ml', 'SÜTAŞ SÜT 1L'), 1000);
  assert.equal(carpanBul('adet', 'ml', 'SÜT 1,5 LT'), 1500);
  assert.equal(carpanBul('adet', 'ml', 'SÜT 1L X 12'), 12000);
  assert.equal(carpanBul('adet', 'g', 'KAHVE 250 GR'), 250);
  assert.equal(carpanBul('adet', 'g', 'ŞEKER 1KG'), 1000);
  assert.equal(carpanBul('kg', 'g', 'KAHVE'), 1000);
  assert.equal(carpanBul('lt', 'ml', 'SÜT'), 1000);
  assert.equal(carpanBul('lt', 'g', 'ŞURUP'), null);          // birim uyumsuz
  assert.equal(carpanBul('adet', 'ml', 'SÜT'), null);         // paket boyu yok
  assert.equal(carpanBul('adet', 'adet', "BARDAK 50'Lİ"), 50);
  assert.equal(carpanBul('adet', 'adet', 'KAPAK'), 1);
});
const malzemeler = [
  { id: 'sut', ad: 'Süt', birim: 'ml', aktif: true },
  { id: 'kahve', ad: 'Kahve çekirdeği', birim: 'g', aktif: true },
  { id: 'bardak', ad: 'Karton bardak', birim: 'adet', aktif: true },
  { id: 'eski', ad: 'Şurup', birim: 'ml', aktif: false },
];
test('sınıflandırma', () => {
  const ctx = { malzemeler, defter: [], tedarikciAnahtar: '1234567890' };
  assert.deepEqual(siniflandir({ metin: 'SÜTAŞ SÜT 1L', miktar: 24, birim: 'adet' }, ctx),
    { sinif: 'soru', malzeme_id: 'sut', carpan: 1000, aday_malzeme_id: 'sut' });
  // Hiçbir malzemeye benzemeyen satır: stok listesinde karşılığı yok → sessizce geçilir (otomatik malzeme açılmaz)
  assert.deepEqual(siniflandir({ metin: 'DETERJAN 5L', miktar: 1, birim: 'adet' }, ctx), { sinif: 'belirsiz' });
  assert.deepEqual(siniflandir({ metin: 'ESPRESSO BLEND 1KG', miktar: 1, birim: 'adet' }, ctx), { sinif: 'belirsiz' });
  assert.equal(siniflandir({ metin: 'ŞURUP KARAMEL', miktar: 1, birim: 'adet' }, ctx).sinif, 'belirsiz'); // pasif malzeme
  // benziyor ama paket boyu yok → barista stok biriminde (litre) sayar
  assert.deepEqual(siniflandir({ metin: 'SÜT', miktar: 5, birim: 'adet' }, ctx),
    { sinif: 'soru', malzeme_id: 'sut', carpan: null, stokBirimi: true, aday_malzeme_id: 'sut' });
  // kg → g çevrilebilir
  assert.equal(siniflandir({ metin: 'KAHVE ÇEKİRDEĞİ', miktar: 5, birim: 'kg' }, ctx).carpan, 1000);
});
test('defter önceliği', () => {
  const defter = [
    { tedarikci_anahtar: '1234567890', metin_anahtar: 'sutas sut 1l', birim: 'adet', sonuc: 'malzeme', malzeme_id: 'sut', carpan: '1000' },
    { tedarikci_anahtar: '', metin_anahtar: 'sut tozu', birim: 'adet', sonuc: 'takip_disi' },
  ];
  const ctx = { malzemeler, defter, tedarikciAnahtar: '1234567890' };
  assert.deepEqual(siniflandir({ metin: 'Sütaş Süt 1L', miktar: 24, birim: 'adet' }, ctx),
    { sinif: 'eslesti', malzeme_id: 'sut', carpan: 1000, kaynak: 'defter' });
  // defterde "takip dışı" denmiş (süte benzese de)
  assert.equal(siniflandir({ metin: 'SÜT TOZU', miktar: 1, birim: 'adet' }, ctx).sinif, 'takip_disi');
  // başka tedarikçi: defter otomatik uygulanmaz, soru sorulur
  assert.equal(siniflandir({ metin: 'SÜTAŞ SÜT 1L', miktar: 24, birim: 'adet' }, { ...ctx, tedarikciAnahtar: '999' }).sinif, 'soru');
  // farklı birim: defter uygulanmaz
  assert.notEqual(siniflandir({ metin: 'SÜTAŞ SÜT 1L', miktar: 24, birim: 'kg' }, ctx).sinif, 'eslesti');
});
test('paket/koli birimi: içindeki adet adda yazıyorsa çevrilir', () => {
  assert.equal(carpanBul('diger', 'adet', "KARTON BARDAK 8 OZ 50'Lİ"), 50);
  assert.equal(carpanBul('diger', 'ml', "TAM YAĞLI SÜT 1L (12'Lİ KOLİ)"), 12000);
  assert.equal(carpanBul('diger', 'ml', 'SÜT 1L'), null);          // koli içi yazmıyor
  assert.equal(carpanBul('diger', 'adet', 'BARDAK KOLİ'), null);
});
test('türev ürün malzemeye bağlanmaz', () => {
  for (const [ad, metin] of [['Süt', 'SÜT KREMASI 1 LT'], ['Süt', 'BADEM SÜTÜ 1LT'], ['Süt', 'VANİLYALI SÜT 200ML'],
    ['Bardak', 'BARDAK KAPAĞI 12OZ'], ['Süt', 'SÜT TOZU 500G']]) assert.equal(turevUrunMu(ad, metin), true, metin);
  for (const [ad, metin] of [['Süt', 'YAYLA TAM YAĞLI SÜT 1 LT'], ['Süt', 'SUT YARIM YAGLI 1LT'], ['Karton bardak', 'KARTON BARDAK 8OZ 50LI'],
    ['Vanilya şurubu', 'VANİLYA ŞURUBU 700 ML'], ['Süt', "TAM YAĞLI SÜT 1L (12'Lİ KOLİ)"], ['Kahve çekirdeği', 'KAHVE ÇEKİRDEĞİ 1KG']])
    assert.equal(turevUrunMu(ad, metin), false, metin);
  const ctx = { malzemeler, defter: [], tedarikciAnahtar: '' };
  assert.equal(siniflandir({ metin: 'SÜT KREMASI 1 LT', miktar: 2, birim: 'adet' }, ctx).sinif, 'belirsiz');
  assert.equal(siniflandir({ metin: "TAM YAĞLI SÜT 1L (12'Lİ KOLİ)", miktar: 3, birim: 'diger' }, ctx).carpan, 12000);
  // daha önce onaylanmış "YAYLA TAM YAĞLI SÜT"e benzese de krema süte bağlanmaz
  const defter = [{ tedarikci_anahtar: '', metin_anahtar: 'yayla tam yagli sut 1 lt', birim: 'adet', sonuc: 'malzeme', malzeme_id: 'sut', carpan: '1000' }];
  assert.equal(siniflandir({ metin: 'YAYLA SÜT KREMASI 200 ML', miktar: 10, birim: 'adet' }, { ...ctx, defter }).sinif, 'belirsiz');
});
test('baş isim / kısaltma', () => {
  assert.equal(basIsimVarMi('Karamel şurubu', 'MNN KRML SRP 70CL'), true);
  assert.equal(basIsimVarMi('Vanilya şurubu', 'Vanilya şrp 700ml'), true);
  assert.equal(basIsimVarMi('Karamel şurubu', 'Karamel şurup 700ml'), true);
  assert.equal(basIsimVarMi('Karamel şurubu', 'MNN KRML SOS 1,89LT'), false);
  assert.equal(basIsimVarMi('Kahve çekirdeği', 'ESPRESSO BLEND ÇEKİRDEK 1 KG'), true);
  assert.equal(basIsimVarMi('Süt', 'SUT TAM YAGLI 1L'), true);
  assert.equal(basIsimVarMi('Süt', 'SU 0,5LT 24LU'), false);
  assert.equal(basIsimVarMi('Bardak', 'KARTON BRDK 50LI'), true);
});
test('kural yolunda başka ürün geçilir, yarım eşleşmeyi barista doğrular', () => {
  const ctx = { malzemeler: [...malzemeler, { id: 'fk', ad: 'Filtre kahve', birim: 'g', aktif: true }], defter: [], tedarikciAnahtar: '' };
  assert.equal(siniflandir({ metin: 'TÜRK KAHVESİ 100 GR', miktar: 10, birim: 'adet' }, ctx).sinif, 'belirsiz');
  assert.equal(siniflandir({ metin: 'ESPRESSO ÇEKİRDEK 1 KG', miktar: 3, birim: 'adet' }, ctx).sinif, 'soru');
});
test('iki yakın aday → en iyisi baristaya sorulur (yanlışsa "değil" der)', () => {
  const m2 = [...malzemeler, { id: 'sutk', ad: 'Süt kremalı', birim: 'ml', aktif: true }, { id: 'sutl', ad: 'Süt laktozsuz', birim: 'ml', aktif: true }];
  const r = siniflandir({ metin: 'SÜT 1L', miktar: 1, birim: 'adet' }, { malzemeler: m2, defter: [], tedarikciAnahtar: '' });
  assert.equal(r.sinif, 'soru');   // "Süt" tam tutuyor (1.0), diğerleri 0.5
  const r2 = siniflandir({ metin: 'LAKTOZSUZ KREMALI SÜT 1L', miktar: 1, birim: 'adet' }, { malzemeler: m2, defter: [], tedarikciAnahtar: '' });
  assert.equal(r2.sinif, 'soru');
});

test('paket içi dilim/porsiyon ve parantezli adet çarpanı; parantezsiz "12 adet" sipariş miktarıdır', async () => {
  const { carpanBul } = await import('../../eslestirme.js');
  assert.equal(carpanBul('adet', 'adet', 'San Sebastian Cheesecake (12 dilim)'), 12);
  assert.equal(carpanBul('adet', 'adet', 'Havuçlu Kek 8 Porsiyon'), 8);
  assert.equal(carpanBul('adet', 'adet', 'Brownie (6 adet)'), 6);
  assert.equal(carpanBul('adet', 'adet', 'Cookie 12 adet'), 1);
  assert.equal(carpanBul('adet', 'adet', 'Brownie'), 1);
});

// Canlı AI (2026-11-08): aynı görselde paket içi hesabı değişebiliyor. Faturanın matematiği (tutar ÷ birim fiyat) çözer.
{
  const mz = [{ id: 'S', ad: 'Süt (tam yağlı)', birim: 'ml', aktif: true }, { id: 'E', ad: 'Espresso çekirdeği', birim: 'g', aktif: true }];
  const ctx = { malzemeler: mz, defter: [], tedarikciAnahtar: 'x', tedarikciAdi: 'TEST' };
  const ai = (id, stok) => ({ karar: 'malzeme', malzeme_id: id, stok_miktari: stok, guven: 0.9 });
  const ES = 'Espresso Çekirdek Kahve 1 kg', SU = "Tam Yağlı Süt 1 L (12'li koli)";
  const stok = (s, k) => (k.miktarDuzelt ?? s.miktar) * k.carpan;
  test('AI paket içini yanlış hesaplar (10 adet 1 kg → 100 kg): miktar × birim fiyat tutuyorsa 10 kg, sayım yok', () => {
    const s = { metin: ES, miktar: 10, birim: 'adet', birim_fiyat: 1090.91, tutar_haric: 10909.1, ai: ai('E', 100000) };
    const k = aiIleSiniflandir(s, ctx);
    assert.equal(k.say, undefined); assert.equal(stok(s, k), 10000);
  });
  test('AI miktarı stok birimine çevirir (10.000 g): belgedeki 10 pakete döner, stok 10 kg', () => {
    const s = { metin: ES, miktar: 10000, birim: 'g', birim_fiyat: 1090.91, tutar_haric: 10909.1, ai: ai('E', 10000) };
    const k = aiIleSiniflandir(s, ctx);
    assert.equal(k.say, undefined); assert.equal(k.miktarDuzelt, 10); assert.equal(stok(s, k), 10000);
  });
  test('AI koliyi şişeye çevirir (36 adet, koli fiyatı): 3 koli, stok 36 L', () => {
    const s = { metin: SU, miktar: 36, birim: 'adet', birim_fiyat: 534.65, tutar_haric: 1603.95, ai: ai('S', 36000) };
    const k = aiIleSiniflandir(s, ctx);
    assert.equal(k.miktarDuzelt, 3); assert.equal(k.carpan, 12000); assert.equal(stok(s, k), 36000);
  });
  test('Miktar koli mi şişe mi belirsiz (36 adet × 44,55, 12li koli): tahmin yok, barista sayar', () => {
    const k = aiIleSiniflandir({ metin: SU, miktar: 36, birim: 'adet', birim_fiyat: 44.55, tutar_haric: 1603.8, ai: ai('S', 36000) }, ctx);
    assert.equal(k.say, true);
  });
  const dctx = { ...ctx, defter: [{ tedarikci_anahtar: 'x', metin_anahtar: anahtar(SU), birim: 'adet', sonuc: 'malzeme', malzeme_id: 'S', carpan: 12000, guncelleme: '2026-11-01' }] };
  test('Defter: normal okuma (3 adet = 3 koli) değişmez', () => {
    const s = { metin: SU, miktar: 3, birim: 'adet', birim_fiyat: 534.65, tutar_haric: 1603.95, ai: ai('S', 36000) };
    const k = aiIleSiniflandir(s, dctx);
    assert.equal(k.sinif, 'eslesti'); assert.equal(k.say, undefined); assert.equal(k.miktarDuzelt, undefined); assert.equal(stok(s, k), 36000);
  });
  test('Defter: AI 36 okudu, koli fiyatından 3 koli çıkar, stok 36 L', () => {
    const s = { metin: SU, miktar: 36, birim: 'adet', birim_fiyat: 534.65, tutar_haric: 1603.95, ai: ai('S', 36000) };
    const k = aiIleSiniflandir(s, dctx);
    assert.equal(k.miktarDuzelt, 3); assert.equal(stok(s, k), 36000);
  });
  test('Defter: 36 × 44,55 belirsiz: barista sayar', () => {
    const k = aiIleSiniflandir({ metin: SU, miktar: 36, birim: 'adet', birim_fiyat: 44.55, tutar_haric: 1603.8, ai: ai('S', 36000) }, dctx);
    assert.equal(k.say, true);
  });
  test('Faturanın matematiği çözemiyorsa (birim fiyat yok) barista sayar', () => {
    const k = aiIleSiniflandir({ metin: ES, miktar: 10, birim: 'adet', birim_fiyat: null, tutar_haric: 10909.1, ai: ai('E', 100000) }, ctx);
    assert.equal(k.say, true);
  });
}
