// KDV kullanıcıdan gizlenir (sql/23 ile birlikte): oran uydurulmaz, karekoddaki vergi bilgisi sessizce kullanılır,
// toplam kontrolü kullanıcıya vergi sormadan çalışır.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { karekodCoz, karekoduUygula } from '../../karekod.js';
import { toplamKontrol, satirDahil, aiSonucunuCevir } from '../../okuma.js';

const kk = (ek) => karekodCoz(JSON.stringify({ vkntckn: '5555555555', senaryo: 'TEMELFATURA', tip: 'SATIS', tarih: '2026-10-24',
  no: 'TPT2026000000001', ettn: '11111111-2222-3333-4444-555555555555', ...ek }));

test('(a) KDV\'si net okunan fatura: toplam tutar, dahil tutar hariç + orandan', () => {
  const s = { toplamlar: { genel: 484.8, kdv_haric: 480 }, satirlar: [{ tutar_haric: 480, kdv_orani: 1 }] };
  assert.equal(satirDahil(s.satirlar[0]), 484.8);
  assert.deepEqual(toplamKontrol(s), { tutuyor: true });
});

test('(b) KDV\'si okunamayan fatura: oran uydurulmaz, hariç toplam tutuyorsa toplam tutar (kdv belirsiz)', () => {
  const s = { toplamlar: { genel: 2520, kdv_haric: 2100 }, satirlar: [{ tutar_haric: 2100, kdv_orani: null }] };
  assert.equal(satirDahil(s.satirlar[0]), null);
  assert.deepEqual(toplamKontrol(s), { tutuyor: true, kdv_belirsiz: true });
  assert.equal(s.satirlar[0].kdv_orani, null);
  // hariç toplam da yoksa: tutmuyor (vergi sorulmaz, satır tutarı bilinmiyor)
  assert.equal(toplamKontrol({ toplamlar: { genel: 2520 }, satirlar: [{ tutar_haric: 2100, kdv_orani: null }] }).tutuyor, false);
});

test('(c) KDV yazmayan fiş: dahil tutar saklanır, oran boş (eskiden %0 sayılıyordu)', () => {
  const f = aiSonucunuCevir({ belge_turu: 'fis', okunabilirlik: 'iyi', tutarlar_kdv_dahil: true, genel_toplam: 300,
    kdv_toplam: null, kdv_haric_toplam: null, indirim: null,
    satirlar: [{ metin: 'KAKAO 1KG', miktar: 1, birim: 'adet', birim_fiyat: 300, tutar: 300, kdv_orani: null, eslesme: null }] });
  assert.deepEqual([f.satirlar[0].tutar_dahil, f.satirlar[0].tutar_haric, f.satirlar[0].kdv_orani], [300, null, null]);
  assert.deepEqual(toplamKontrol(f), { tutuyor: true });
});

test('(d) toplamı tutmayan fatura: tutmuyor + fark, vergi alanı istenmez', () => {
  const r = toplamKontrol({ toplamlar: { genel: 999 }, satirlar: [{ tutar_haric: 480, kdv_orani: 1 }, { tutar_dahil: 1010 }] });
  assert.equal(r.tutuyor, false);
  assert.equal(r.sebep, 'fark');
});

test('(e) karekodlu fatura: tek oran sessizce satırlara yazılır, KDV toplamı alınır', () => {
  const k = kk({ malhizmettoplam: '2100.00', 'kdvmatrah(20)': '2100.00', 'hesaplanankdv(20)': '420.00', vergidahil: '2520.00', odenecek: '2520.00' });
  const s = { toplamlar: { genel: 2520, kdv_haric: 2100, kdv: null }, satirlar: [{ tutar_haric: 2100, kdv_orani: null }], notlar: [] };
  karekoduUygula(k, s);
  assert.equal(s.satirlar[0].kdv_orani, 20);
  assert.equal(s.toplamlar.kdv, 420);
  assert.deepEqual(toplamKontrol(s), { tutuyor: true });
});

test('(e) karekodda iki oran: yalnız tek dağılım tutarsa atanır, yoksa oran boş kalır', () => {
  const k = kk({ malhizmettoplam: '1100.00', 'kdvmatrah(1)': '1000.00', 'hesaplanankdv(1)': '10.00',
    'kdvmatrah(20)': '100.00', 'hesaplanankdv(20)': '20.00', vergidahil: '1130.00', odenecek: '1130.00' });
  const s = { toplamlar: { genel: 1130, kdv_haric: 1100, kdv: null },
    satirlar: [{ tutar_haric: 1000, kdv_orani: null }, { tutar_haric: 100, kdv_orani: null }], notlar: [] };
  karekoduUygula(k, s);
  assert.deepEqual(s.satirlar.map((x) => x.kdv_orani), [1, 20]);
  // aynı tutarlı iki satır: hangisinin %1 hangisinin %20 olduğu belli değil → atanmaz
  const s2 = { toplamlar: { genel: 1220, kdv_haric: 1000, kdv: null },
    satirlar: [{ tutar_haric: 500, kdv_orani: null }, { tutar_haric: 500, kdv_orani: null }], notlar: [] };
  karekoduUygula(kk({ malhizmettoplam: '1000', 'kdvmatrah(1)': '500', 'hesaplanankdv(1)': '5', 'kdvmatrah(20)': '500',
    'hesaplanankdv(20)': '100', vergidahil: '1105', odenecek: '1105' }), s2);
  assert.deepEqual(s2.satirlar.map((x) => x.kdv_orani), [null, null]);
});
