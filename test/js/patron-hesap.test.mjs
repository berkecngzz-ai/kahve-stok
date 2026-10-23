import { test } from 'node:test';
import assert from 'node:assert/strict';
import { okunurMiktar, tlYaz, miktarTl, acikDurumu, acikOrani, donemYaz, yeterDurumu, trendSvg } from '../../patron-hesap.js';

test('miktar günlük birimle yazılır (12.000 ml değil 12 litre)', () => {
  assert.equal(okunurMiktar(12000, 'ml'), '12 litre');
  assert.equal(okunurMiktar(17360, 'ml'), '17,4 litre');
  assert.equal(okunurMiktar(1250, 'g'), '1,25 kg');
  assert.equal(okunurMiktar(350, 'ml'), '350 ml');
  assert.equal(okunurMiktar(118, 'g'), '118 g');
  assert.equal(okunurMiktar(108000, 'ml'), '108 litre');
  assert.equal(okunurMiktar(1500, 'adet'), '1.500 adet');
  assert.equal(okunurMiktar(-4000, 'ml'), '−4 litre');
  assert.equal(okunurMiktar(5, 'adet', { isaret: true }), '+5 adet');
  assert.equal(okunurMiktar(0, 'g', { isaret: true }), '0 g');
  assert.equal(okunurMiktar(null, 'g'), '—');
});

test('TL: 10 TL üstünde kuruşsuz, altında kuruşlu, sıfır sade', () => {
  assert.equal(tlYaz(-898.39), '−898 TL');
  assert.equal(tlYaz(-62.48), '−62 TL');
  assert.equal(tlYaz(24290.4), '24.290 TL');
  assert.equal(tlYaz(-5.8), '−5,80 TL');
  assert.equal(tlYaz(16.1, { isaret: true }), '+16 TL');
  assert.equal(tlYaz(0), '0 TL');
  assert.equal(tlYaz(-0.001), '0 TL');
});

test('miktarın TL karşılığı fiyat birimine göre', () => {
  assert.equal(miktarTl(17360, 'ml', 44), 763.84);
  assert.equal(miktarTl(3, 'adet', 1.1), 3.3000000000000003);
  assert.equal(miktarTl(100, 'g', 0), null);
});

test('açık eşiği: oran %3 ve 50 TL birlikte', () => {
  // 3. hafta süt: 17,36 litre / 105,6 litre kullanım → %16, 764 TL → kırmızı
  assert.equal(acikDurumu({ fark: -17360, satis: 104800, fire: 800, fark_tl: -763.84, birim: 'ml' }), 'buyuk');
  // kahve: 118 g / 13.800 g → %0,9 → normal (TL büyük olsa da)
  assert.equal(acikDurumu({ fark: -118, satis: 13773, fire: 60, fark_tl: -135.7, birim: 'g' }), 'normal');
  // kapak: %40 ama 4,4 TL → normal (az kullanılan malzemede tek eksik oranı şişirmez)
  assert.equal(acikDurumu({ fark: -4, satis: 10, fire: 0, fark_tl: -4.4, birim: 'adet' }), 'normal');
  // sayılan fazla ve büyük → sarı
  assert.equal(acikDurumu({ fark: 5000, satis: 40000, fire: 0, fark_tl: 220, birim: 'ml' }), 'fazla');
  // hiç kullanım yokken kayıp → kırmızı
  assert.equal(acikDurumu({ fark: -2000, satis: 0, fire: 0, fark_tl: -88, birim: 'ml' }), 'buyuk');
  // fark_tl yoksa fiyattan hesaplanır
  assert.equal(acikDurumu({ fark: -3000, satis: 10000, fire: 0, fiyat: 40, birim: 'ml' }), 'buyuk');
  assert.equal(acikOrani({ fark: -17360, satis: 104800, fire: 800 }), '%16,4');
  assert.equal(acikOrani({ fark: -10, satis: 0, fire: 0 }), '');
});

test('dönem ve kaç gün yeter', () => {
  assert.equal(donemYaz('2026-10-16', '2026-10-23'), '16–23 Ekim');
  assert.equal(donemYaz('2026-09-25', '2026-10-02'), '25 Eyl – 2 Eki');
  assert.equal(yeterDurumu(null), null);
  assert.equal(yeterDurumu(0), 'az');
  assert.equal(yeterDurumu(2), 'az');
  assert.equal(yeterDurumu(5), 'dikkat');
  assert.equal(yeterDurumu(6), 'iyi');
});

test('trend grafiği: eski hafta solda, kırmızı hafta işaretli, ekran okuyucu özeti', () => {
  const svg = trendSvg([
    { baslangic: '2026-10-16', bitis: '2026-10-23', acik_tl: -215 },
    { baslangic: '2026-10-09', bitis: '2026-10-16', acik_tl: -914, buyuk: true },
  ]);
  assert.match(svg, /aria-label="Haftalık açık \(TL\): 9–16 Ekim: −914 TL, 16–23 Ekim: −215 TL"/);
  assert.equal((svg.match(/cubuk-kirmizi/g) || []).length, 1);
  assert.ok(svg.indexOf('16 Eki') < svg.indexOf('23 Eki'));
  assert.equal(trendSvg([]), '');
});
