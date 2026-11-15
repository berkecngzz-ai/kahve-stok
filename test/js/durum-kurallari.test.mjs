// Patron ekranlarının durum kuralları: sayım gecikmesi, fark durumu (oran / medyan), gün tahmini.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sayimGecikti, farkDurumu, gunTahminiVar, medyan, acikDurumu } from '../../patron-hesap.js';

const donem = (acik, kullanilan, gun = 7, baslangic = '2026-10-01') => ({ acik_tl: -acik, kullanilan_tl: kullanilan, gun, baslangic });

test('sayım gecikmesi: sıklık + 2 gün', () => {
  assert.equal(sayimGecikti('2026-11-06', '2026-11-15', 7), false);   // 9 gün = 7 + 2 → henüz değil
  assert.equal(sayimGecikti('2026-11-05', '2026-11-15', 7), true);    // 10 gün
  assert.equal(sayimGecikti('2026-11-01', '2026-11-15', 14), false);  // 2 haftalık: 14 gün
  assert.equal(sayimGecikti('2026-10-14', '2026-11-15', 30), false);  // aylık: 32 gün = 30 + 2
  assert.equal(sayimGecikti('2026-10-13', '2026-11-15', 30), true);
  assert.equal(sayimGecikti(null, '2026-11-15', 7), false);
});

test('az geçmiş (< 4 dönem): oran eşiği, normal seviye yok', () => {
  const t = [donem(389, 9725), donem(200, 9000), donem(210, 9000)];
  const d = farkDurumu(t, 5, 500);
  assert.equal(d.mod, 'oran'); assert.equal(d.normal, null);
  assert.equal(Math.round(d.oran * 1000) / 10, 4);   // %4
  assert.equal(d.sorun, false);
  assert.equal(farkDurumu([donem(600, 9725), donem(200, 9000)], 5, 10000).sorun, true);   // %6,2 > %5
  assert.equal(farkDurumu([donem(600, 9725)], 8, 10000).sorun, false);              // eşik %8, sınır yüksek
});

test('yeterli geçmiş (≥ 4 dönem): son 8 dönemin medyanı, 1,5 katını aşarsa sorun', () => {
  const onceki = [200, 220, 180, 250, 210, 190, 205, 230, 5000].map((x) => donem(x, 9000));   // 9. (5000) dışarıda kalır
  const d = farkDurumu([donem(389, 9725), ...onceki], 5);
  assert.equal(d.mod, 'normal');
  assert.equal(d.normal, medyan([200, 220, 180, 250, 210, 190, 205, 230]));   // 207,5
  assert.equal(d.sorun, true);                                                 // 389 > 311
  assert.equal(farkDurumu([donem(300, 9725), ...onceki], 5).sorun, false);   // 300 < 311
  // Oran %4 olsa bile medyan kuralı geçerli (az geçmiş kuralı uygulanmaz)
  assert.equal(farkDurumu([donem(389, 9725), ...onceki], 50).sorun, true);
});

test('eşit olmayan dönemler dışlanır', () => {
  // 4 önceki dönemin 2'si 14 günlük: aynı uzunlukta yalnız 2 dönem → oran kuralı
  const t = [donem(389, 9725, 7), donem(200, 9000, 7), donem(210, 9000, 14), donem(220, 9000, 7), donem(900, 18000, 14)];
  assert.equal(farkDurumu(t, 5).mod, 'oran');
  // ±1 gün aynı sayılır (6–8 gün haftalık)
  const t2 = [donem(389, 9725, 7), donem(200, 9000, 6), donem(210, 9000, 8), donem(220, 9000, 7), donem(230, 9000, 7)];
  assert.equal(farkDurumu(t2, 5).mod, 'normal');
  // Satışı girilmemiş dönem (kullanılan 0) geçerli sayılmaz
  const t3 = [donem(389, 9725), donem(200, 0), donem(210, 9000), donem(220, 9000), donem(230, 9000)];
  assert.equal(farkDurumu(t3, 5).mod, 'oran');
});

test('kullanım bilinmiyorsa dayanaksız yargı yok', () => {
  const d = farkDurumu([donem(389, 0)], 5);
  assert.equal(d.oran, null); assert.equal(d.sorun, false);
  assert.equal(farkDurumu([], 5), null);
});

test('satış raporu 3 günden eskiyse gün tahmini gizlenir', () => {
  assert.equal(gunTahminiVar('2026-11-13T09:00:00+00:00', '2026-11-15'), true);
  assert.equal(gunTahminiVar('2026-11-12', '2026-11-15'), true);    // 3 gün
  assert.equal(gunTahminiVar('2026-11-11', '2026-11-15'), false);   // 4 gün
  assert.equal(gunTahminiVar(null, '2026-11-15'), false);           // hiç yüklenmedi
});

test('malzeme durumu mekânın eşiğiyle', () => {
  const x = { fark: -600, satis: 10000, fire: 0, fark_tl: -60, birim: 'ml', fiyat: 100 };   // %6, 60 TL
  assert.equal(acikDurumu(x, 0.05), 'buyuk');
  assert.equal(acikDurumu(x, 0.08), 'normal');
});

test('haftalık TL sınırı: oran eşiği aşılmasa da sınır aşılırsa sorun; hangisi aşıldı bilinir', () => {
  // 915 TL fark, kullanımın %3,2'si: %5 eşiğin altında ama 500 TL sınırın üstünde
  const d = farkDurumu([donem(915, 28472)], 5, 500);
  assert.equal(d.sorun, true); assert.equal(d.neden, 'tl'); assert.equal(d.tlSiniri, 500);
  // Sınır 1000 TL: ikisi de aşılmadı
  assert.equal(farkDurumu([donem(915, 28472)], 5, 1000).sorun, false);
  // Oran aşıldı, sınır aşılmadı → neden oran
  const o = farkDurumu([donem(400, 5000)], 5, 500);
  assert.equal(o.sorun, true); assert.equal(o.neden, 'oran');
  // Satış girilmemiş (oran yok) dönemde de TL sınırı çalışır
  assert.equal(farkDurumu([donem(915, 0)], 5, 500).neden, 'tl');
  // 14 günlük dönemde haftalık sınır 2 katına ölçeklenir
  const iki = farkDurumu([donem(915, 28472, 14)], 5, 500);
  assert.equal(iki.tlSiniri, 1000); assert.equal(iki.sorun, false);
  // Yeterli geçmişte (medyan modu) de TL sınırı geçerli
  const onceki = [600, 620, 580, 610].map((x) => donem(x, 28000));
  const m = farkDurumu([donem(700, 28000), ...onceki], 5, 500);
  assert.equal(m.mod, 'normal'); assert.equal(m.neden, 'tl'); assert.equal(m.sorun, true);
});
