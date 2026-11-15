// Patron ekranlarının durum kuralları: sayım gecikmesi, fark durumu (oran / medyan), gün tahmini.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sayimGecikti, farkDurumu, gunTahminiVar, medyan, acikDurumu, satisEksik, farkSatiri, trendSvg } from '../../patron-hesap.js';

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

// Canlı hata (2026-11-15): 27 Eki – 15 Kas, 19 gün satış raporu yok → satılan her şey fark sayıldı, 2.479 TL kırmızı.
test('satış raporu eksik dönemde stok farkı hesaplanmaz (amber, sorun değil)', () => {
  const canli = { baslangic: '2026-10-27', bitis: '2026-11-15', gun: 19, satis_gun: 0, acik_tl: -2479, kullanilan_tl: 300 };
  assert.equal(satisEksik(canli), true);
  const d = farkDurumu([canli, donem(200, 9000)], 5, 500);
  assert.equal(d.mod, 'satis_eksik');
  assert.equal(d.sorun, false);           // TL sınırı (1.357 TL) aşılsa da kırmızı değil
  assert.equal(d.neden, null);
  assert.equal(d.gun, 19); assert.equal(d.satisGun, 0);
  // Haftada 1 kapalı gün hoş görülür: 7 günde 6, 19 günde 17 satış günü yeter
  assert.equal(satisEksik({ ...canli, gun: 7, satis_gun: 6 }), false);
  assert.equal(satisEksik({ ...canli, gun: 7, satis_gun: 5 }), true);
  assert.equal(satisEksik({ ...canli, satis_gun: 17 }), false);
  assert.equal(satisEksik({ ...canli, satis_gun: 16 }), true);
  // Sunucu alanı göndermiyorsa (eski sürüm) eski davranış
  assert.equal(satisEksik({ ...canli, satis_gun: undefined }), false);
  assert.equal(farkDurumu([{ ...canli, satis_gun: undefined }], 5, 500).sorun, true);
});

test('satış raporu eksik dönem normal seviye geçmişine girmez', () => {
  const eksik = { ...donem(5000, 9000), satis_gun: 0 };
  const t = [donem(389, 9725), eksik, donem(200, 9000), donem(210, 9000), donem(220, 9000)];
  assert.equal(farkDurumu(t, 5).mod, 'oran');   // eksik dönem sayılmadı: 3 geçerli dönem
  assert.equal(farkDurumu([donem(389, 9725), eksik, donem(200, 9000), donem(210, 9000), donem(220, 9000), donem(230, 9000)], 5).normal, 215);
});

test('grafik: satış raporu eksik dönemde sütun yok, "rapor eksik" yazar', () => {
  const svg = trendSvg([{ baslangic: '2026-10-27', bitis: '2026-11-15', gun: 19, satis_gun: 0, acik_tl: -2479 },
    { baslangic: '2026-10-20', bitis: '2026-10-27', gun: 7, satis_gun: 7, acik_tl: -200 }]);
  assert.match(svg, /rapor eksik/);
  assert.doesNotMatch(svg, /2\.479 TL/);
  assert.equal((svg.match(/<rect/g) ?? []).length, 1);
});

test('durum kartı alt satırı: tek karşılaştırma', () => {
  const canli = { baslangic: '2026-10-27', bitis: '2026-11-15', gun: 19, satis_gun: 19, acik_tl: -2479, kullanilan_tl: 90000 };
  assert.equal(farkSatiri(farkDurumu([canli], 5, 500)), '19 günde 2.479 TL fark · bu dönemin sınırı 1.357 TL');
  assert.equal(farkSatiri(farkDurumu([donem(389, 9725)], 5, 500)), "7 günde 389 TL fark · kullanımın %4'ü");
  const onceki = [200, 220, 180, 250].map((x) => donem(x, 9000));
  assert.equal(farkSatiri(farkDurumu([donem(389, 9725), ...onceki], 5, 10000)), '7 günde 389 TL fark · normali ~210 TL');
});
