import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DOMParser } from '@xmldom/xmldom';
import { aiSonucunuCevir, xmlOku, toplamKontrol } from '../../okuma.js';
import { aiIleSiniflandir, siniflandir } from '../../eslestirme.js';
import { cevapAnahtariniOku, anahtarBelgesi, karsilastir } from '../../okuma-testi.js';

const malzemeler = [['sut', 'Süt', 'ml'], ['kc', 'Kahve çekirdeği', 'g'], ['ks', 'Karamel şurubu', 'ml'], ['b', 'Bardak', 'adet']]
  .map(([id, ad, birim]) => ({ id, ad, birim, aktif: true }));
const ctx = { malzemeler, defter: [], tedarikciAnahtar: '' };
const e = (karar, malzeme_id, stok_miktari, guven) => ({ karar, malzeme_id, stok_miktari, guven });

test('AI cevabı: fatura (KDV hariç) ve fiş (KDV dahil) çevrilir', () => {
  const f = aiSonucunuCevir({ tutarlar_kdv_dahil: false, genel_toplam: 1946, kdv_haric_toplam: 1716.9, kdv_toplam: 229.1,
    indirim: null, tarih: '2026-10-14', vkn: '333 333 3333', okunabilirlik: 'iyi',
    satirlar: [{ metin: 'ACIFTLIK T.YAG SUT 1LT', miktar: 12, birim: 'adet', birim_fiyat: 38.5, tutar: 462, kdv_orani: 1, eslesme: e('malzeme', 'sut', 12000, 0.9) },
               { metin: 'PECETE 100LU', miktar: 10, birim: 'paket', birim_fiyat: 42, tutar: 420, kdv_orani: 20, eslesme: e('takip_disi', null, null, 0.95) }] });
  assert.equal(f.kaynak, 'ai');
  assert.equal(f.tedarikci_vkn, '3333333333');
  assert.equal(f.satirlar[1].birim, 'diger');          // paket → içi bilinmeden adet değil
  assert.equal(f.satirlar[0].tutar_haric, 462);
  const fis = aiSonucunuCevir({ tutarlar_kdv_dahil: true, genel_toplam: 123, kdv_toplam: 3, kdv_haric_toplam: null, indirim: null,
    satirlar: [{ metin: 'SÜT 1L', miktar: 2, birim: 'adet', birim_fiyat: 50.5, tutar: 101, kdv_orani: 1, eslesme: null },
               { metin: 'SİMİT', miktar: 1, birim: 'adet', birim_fiyat: null, tutar: 22, kdv_orani: null, eslesme: null }] });
  assert.deepEqual(fis.satirlar.map((s) => [s.tutar_haric, s.kdv_orani]), [[100, 1], [20, 10]]);   // oran KDV'den çözüldü
  assert.deepEqual(toplamKontrol(fis), { tutuyor: true });
});

test('AI ile eşleştirme', () => {
  // emin takip dışı → takip dışı; emin olmayan → kuyruk
  assert.equal(aiIleSiniflandir({ metin: 'PECETE', miktar: 1, birim: 'diger', ai: e('takip_disi', null, null, 0.95) }, ctx).sinif, 'takip_disi');
  assert.equal(aiIleSiniflandir({ metin: 'SEKER', miktar: 1, birim: 'adet', ai: e('takip_disi', null, null, 0.5) }, ctx).sinif, 'belirsiz');
  // kısaltma: kural çevirebiliyor ve AI ile aynı → soru
  assert.deepEqual(aiIleSiniflandir({ metin: 'ACIFTLIK T.YAG SUT 1LT', miktar: 12, birim: 'adet', ai: e('malzeme', 'sut', 12000, 0.9) }, ctx),
    { sinif: 'soru', malzeme_id: 'sut', carpan: 1000, aday_malzeme_id: 'sut', kaynak: 'ai' });
  // kural yok (paket), AI paket içini hesaplamış (50'li) → soru, çarpan 50
  assert.equal(aiIleSiniflandir({ metin: 'KARTON BARDAK 8OZ', miktar: 4, birim: 'diger', ai: e('malzeme', 'b', 200, 0.85) }, ctx).carpan, 50);
  // AI'nın miktarı kuralla çelişiyor (1L × 12 = 12000, AI 1200 diyor) → kuyruk
  assert.equal(aiIleSiniflandir({ metin: 'SUT 1LT', miktar: 12, birim: 'adet', ai: e('malzeme', 'sut', 1200, 0.9) }, ctx).sinif, 'belirsiz');
  // AI listede olmayan id verirse → kuyruk
  assert.equal(aiIleSiniflandir({ metin: 'X', miktar: 1, birim: 'adet', ai: e('malzeme', 'yok', 1, 0.99) }, ctx).sinif, 'belirsiz');
  // defter her zaman önce: AI ne derse desin
  const defter = [{ tedarikci_anahtar: '', metin_anahtar: 'pecete', birim: 'diger', sonuc: 'malzeme', malzeme_id: 'b', carpan: '100' }];
  assert.equal(aiIleSiniflandir({ metin: 'PECETE', miktar: 1, birim: 'diger', ai: e('takip_disi', null, null, 0.99) }, { ...ctx, defter }).sinif, 'eslesti');
});

test('cevap anahtarı + karşılaştırma (02 XML: 4/4 doğru)', () => {
  const a = cevapAnahtariniOku(readFileSync(new URL('./ornekler/cevap_anahtari.md', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(a).filter((k) => a[k].satirlar.length), ['01_sut_efatura', '02_kahve_sirup_efatura', '03_toptanci_foto', '04_market_fis']);
  assert.deepEqual(a['03_toptanci_foto'].satirlar[2].beklenen, { tur: 'takip_disi' });
  assert.deepEqual(a['03_toptanci_foto'].satirlar[4].beklenen, { tur: 'malzeme', malzeme: 'Bardak', miktar: 200, birim: 'adet' });
  const m2 = [...malzemeler, { id: 'fk', ad: 'Filtre kahve', birim: 'g', aktif: true }, { id: 'vs', ad: 'Vanilya şurubu', birim: 'ml', aktif: true }];
  const r = xmlOku(readFileSync(new URL('./ornekler/02_kahve_sirup_efatura.xml', import.meta.url), 'utf8'), DOMParser);
  r.satirlar.forEach((s) => { s.karar = siniflandir(s, { malzemeler: m2, defter: [], tedarikciAnahtar: r.tedarikci_vkn }); });
  const k = karsilastir(anahtarBelgesi(a, '02_kahve_sirup_efatura.xml'), r, new Map(m2.map((m) => [m.id, m.ad])));
  assert.deepEqual(k.ozet, { satir: 4, okuma_dogru: 4, dogru: 4, yanlis: 0, kuyruk: 0, okunamadi: 0 });
  assert.equal(k.genel.dogru, true);
});

test('gerçek AI testinden (2026-10-20): fiş öneki ve paket içi', () => {
  // nano ürün adına "6 x 41,00" önekini koymuştu: "x 41" paket sayılmamalı
  assert.equal(aiIleSiniflandir({ metin: '6 x 41,00 SUT 1LT YAĞLI', miktar: 6, birim: 'adet', ai: e('malzeme', 'sut', 6000, 0.9) }, ctx).carpan, 1000);
  // nano yanlış eşleştirme: kakao → kahve çekirdeği, miktar yok → kuyruk
  assert.equal(aiIleSiniflandir({ metin: '1 x 210,00 KAKAO TOZU 500G', miktar: 1, birim: 'diger', ai: e('malzeme', 'kc', null, 0.8) }, ctx).sinif, 'belirsiz');
  // mini "emin değilim" ama miktar kuralla doğrulanıyor → baristaya sorulur
  assert.equal(aiIleSiniflandir({ metin: 'Espresso Blend Çekirdek Kahve 1KG', miktar: 3, birim: 'adet', ai: e('emin_degil', 'kc', 3000, 0.8) }, ctx).sinif, 'soru');
  // "emin değilim" ve kuralla doğrulanamıyor → kuyruk
  assert.equal(aiIleSiniflandir({ metin: 'KAHVE', miktar: 3, birim: 'adet', ai: e('emin_degil', 'kc', 3000, 0.8) }, ctx).sinif, 'belirsiz');
  // paket: ürün adındaki 50'Lİ ile AI'nın 200 adedi uyuşuyor → soru; uyuşmuyorsa kuyruk
  assert.equal(aiIleSiniflandir({ metin: 'KARTON BARDAK 8OZ 50LI', miktar: 4, birim: 'diger', ai: e('malzeme', 'b', 200, 0.9) }, ctx).carpan, 50);
  assert.equal(aiIleSiniflandir({ metin: 'KARTON BARDAK 8OZ 50LI', miktar: 4, birim: 'diger', ai: e('malzeme', 'b', 400, 0.9) }, ctx).sinif, 'belirsiz');
});
test('AI fişi "KDV dahil" dese de hesap hariç gösteriyorsa hariç sayılır', () => {
  const f = aiSonucunuCevir({ tutarlar_kdv_dahil: true, genel_toplam: 609.75, kdv_toplam: 24.75, kdv_haric_toplam: null, indirim: null,
    satirlar: [{ metin: 'SUT 1L', miktar: 6, birim: 'adet', birim_fiyat: 41, tutar: 246, kdv_orani: 1, eslesme: null },
               { metin: 'KAKAO', miktar: 1, birim: 'adet', birim_fiyat: 210, tutar: 210, kdv_orani: 10, eslesme: null },
               { metin: 'SEKER', miktar: 2, birim: 'adet', birim_fiyat: 64.5, tutar: 129, kdv_orani: 1, eslesme: null }] });
  assert.deepEqual(f.satirlar.map((s) => s.tutar_haric), [246, 210, 129]);
  assert.deepEqual(toplamKontrol(f), { tutuyor: true });
});
