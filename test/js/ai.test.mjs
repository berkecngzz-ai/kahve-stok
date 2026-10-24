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
  // emin takip dışı → takip dışı; emin olmayan → kurallar: listede benzeyen yoksa sessizce geçilir
  assert.equal(aiIleSiniflandir({ metin: 'PECETE', miktar: 1, birim: 'diger', ai: e('takip_disi', null, null, 0.95) }, ctx).sinif, 'takip_disi');
  assert.equal(aiIleSiniflandir({ metin: 'SEKER', miktar: 1, birim: 'adet', ai: e('takip_disi', null, null, 0.5) }, ctx).sinif, 'belirsiz');
  // kısaltma: kural çevirebiliyor ve AI ile aynı → soru
  assert.deepEqual(aiIleSiniflandir({ metin: 'ACIFTLIK T.YAG SUT 1LT', miktar: 12, birim: 'adet', ai: e('malzeme', 'sut', 12000, 0.9) }, ctx),
    { sinif: 'soru', malzeme_id: 'sut', carpan: 1000, aday_malzeme_id: 'sut', kaynak: 'ai' });
  // kural yok (paket), AI paket içini hesaplamış (50'li) → soru, çarpan 50
  assert.equal(aiIleSiniflandir({ metin: 'KARTON BARDAK 8OZ', miktar: 4, birim: 'diger', ai: e('malzeme', 'b', 200, 0.85) }, ctx).carpan, 50);
  // AI'nın miktarı kuralla çelişiyor (1L × 12 = 12000, AI 1200 diyor) → hangisi doğru belli değil: barista sayar
  assert.deepEqual(aiIleSiniflandir({ metin: 'SUT 1LT', miktar: 12, birim: 'adet', ai: e('malzeme', 'sut', 1200, 0.9) }, ctx),
    { sinif: 'soru', malzeme_id: 'sut', carpan: 1000, aday_malzeme_id: 'sut', kaynak: 'ai', say: true });
  // aynı çelişki ama AI emin değil → yine barista sayar (değilse "değil" der); kuyruk yok
  const ed = aiIleSiniflandir({ metin: 'SUT 1LT', miktar: 12, birim: 'adet', ai: e('emin_degil', 'sut', 1200, 0.9) }, ctx);
  assert.ok(ed.sinif === 'soru' && ed.say === true && ed.carpan === 1000);
  // AI listede olmayan id verirse → kurallar; benzeyen yoksa sessizce geçilir
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
  // nano yanlış eşleştirme: kakao → kahve çekirdeği, çarpan yok → barista stok biriminde sayar ya da "değil" der
  const kk = aiIleSiniflandir({ metin: '1 x 210,00 KAKAO TOZU 500G', miktar: 1, birim: 'diger', ai: e('malzeme', 'kc', null, 0.8) }, ctx);
  assert.ok(kk.sinif === 'soru' && (kk.stokBirimi === true || kk.carpan > 0));
  // mini "emin değilim" ama miktar kuralla doğrulanıyor → baristaya sorulur
  assert.equal(aiIleSiniflandir({ metin: 'Espresso Blend Çekirdek Kahve 1KG', miktar: 3, birim: 'adet', ai: e('emin_degil', 'kc', 3000, 0.8) }, ctx).sinif, 'soru');
  // "emin değilim" ve kuralla doğrulanamıyor → AI'nın hesabıyla barista sayar (kuyruk yok)
  assert.equal(aiIleSiniflandir({ metin: 'KAHVE', miktar: 3, birim: 'adet', ai: e('emin_degil', 'kc', 3000, 0.8) }, ctx).sinif, 'soru');
  // paket: ürün adındaki 50'Lİ ile AI'nın 200 adedi uyuşuyor → soru; uyuşmuyorsa barista paket sayar
  assert.equal(aiIleSiniflandir({ metin: 'KARTON BARDAK 8OZ 50LI', miktar: 4, birim: 'diger', ai: e('malzeme', 'b', 200, 0.9) }, ctx).carpan, 50);
  const say = aiIleSiniflandir({ metin: 'KARTON BARDAK 8OZ 50LI', miktar: 4, birim: 'diger', ai: e('malzeme', 'b', 400, 0.9) }, ctx);
  assert.ok(say.sinif === 'soru' && say.say === true && say.carpan === 50);
  // fiş: "25LI" 3 adet, AI 3 bardak diyor (3 paket = 75 olabilir) → barista sayar, 1 paket = 25
  const fis = aiIleSiniflandir({ metin: 'KARTON BARDAK 12OZ 25LI %20', miktar: 3, birim: 'adet', ai: e('malzeme', 'b', 3, 0.8) }, ctx);
  assert.ok(fis.sinif === 'soru' && fis.say === true && fis.carpan === 25);
  // koli "(500'lü)" 1000 adet, AI 1000 bardak → 2 koli mi 1000 koli mi belgeden belli değil → barista sayar
  const koli = aiIleSiniflandir({ metin: "Bardak 8oz koli (500'lü)", miktar: 1000, birim: 'adet', ai: e('malzeme', 'b', 1000, 0.9) }, ctx);
  assert.ok(koli.sinif === 'soru' && koli.say === true && koli.carpan === 500);
  // başka ürün (bardak kapağı) çelişkide de sorulmaz → listede yok, geçilir
  assert.equal(aiIleSiniflandir({ metin: "BARDAK KAPAĞI 12OZ 100'LÜ", miktar: 2, birim: 'adet', ai: e('malzeme', 'b', 2, 0.9) }, ctx).sinif, 'belirsiz');
});
test('AI takip dışı dese de satır malzemenin adını taşıyorsa barista sayar; türevse takip dışı', () => {
  assert.equal(aiIleSiniflandir({ metin: 'KARTON BARDAK 8OZ 50LI', miktar: 2, birim: 'adet', ai: e('takip_disi', null, null, 0.9) }, ctx).sinif, 'soru');
  assert.equal(aiIleSiniflandir({ metin: 'BARDAK KAPAĞI 12OZ', miktar: 1, birim: 'adet', ai: e('takip_disi', null, null, 0.9) }, ctx).sinif, 'takip_disi');
  assert.equal(aiIleSiniflandir({ metin: 'PECETE 100LU', miktar: 1, birim: 'adet', ai: e('takip_disi', null, null, 0.9) }, ctx).sinif, 'takip_disi');
  // AI süt dese de krema süte bağlanmaz (geçilir); iade satırı kuruluma
  assert.equal(aiIleSiniflandir({ metin: 'YAYLA SÜT KREMASI 200 ML', miktar: 10, birim: 'adet', ai: e('malzeme', 'sut', 2000, 0.9) }, ctx).sinif, 'belirsiz');
  assert.equal(aiIleSiniflandir({ metin: 'IADE SUT 1L', miktar: -2, birim: 'adet', ai: e('malzeme', 'sut', -2000, 0.9) }, ctx).sinif, 'kurulum');
});
test('KDV yazmayan el yazısı fiş: tutarlar ödenen (KDV dahil) tutar, oran uydurulmaz, toplam tutar', () => {
  const f = aiSonucunuCevir({ belge_turu: 'fis', okunabilirlik: 'iyi', tutarlar_kdv_dahil: true, genel_toplam: 1280, kdv_toplam: null, kdv_haric_toplam: null, indirim: null,
    satirlar: [{ metin: 'Süt 1 lt', miktar: 20, birim: 'adet', birim_fiyat: 33, tutar: 660, kdv_orani: null, eslesme: null },
               { metin: 'Karamel şurup 700ml', miktar: 2, birim: 'adet', birim_fiyat: 310, tutar: 620, kdv_orani: null, eslesme: null }] });
  assert.deepEqual(f.satirlar.map((s) => [s.tutar_dahil, s.tutar_haric, s.kdv_orani]), [[660, null, null], [620, null, null]]);
  assert.equal(toplamKontrol(f).tutuyor, true);
});
test('KDV hariç yazılmış belge iskontosu KDV dahil karşılığına çevrilir', () => {
  const f = aiSonucunuCevir({ belge_turu: 'fatura', okunabilirlik: 'iyi', tutarlar_kdv_dahil: false, genel_toplam: 1045, kdv_toplam: 95, kdv_haric_toplam: 950, indirim: 50,
    satirlar: [{ metin: 'A', miktar: 1, birim: 'adet', birim_fiyat: 600, tutar: 600, kdv_orani: 10, eslesme: null },
               { metin: 'B', miktar: 1, birim: 'adet', birim_fiyat: 400, tutar: 400, kdv_orani: 10, eslesme: null }] });
  assert.equal(f.toplamlar.indirim, 55);
  assert.equal(f.toplamlar.kdv_haric, null);
  assert.equal(toplamKontrol(f).tutuyor, true);
});
test('görünmeyen toplam kullanılmaz; fatura olmayan belge ve karışık fiş satırı işaretlenir', () => {
  const temel = { belge_turu: 'fatura', okunabilirlik: 'iyi', tutarlar_kdv_dahil: true, genel_toplam: 300, kdv_toplam: null, kdv_haric_toplam: null, indirim: null,
    satirlar: [{ metin: 'SUT 1L', miktar: 6, birim: 'adet', birim_fiyat: 50, tutar: 300, kdv_orani: 1, eslesme: null }] };
  assert.equal(aiSonucunuCevir({ ...temel, okunabilirlik: 'eksik' }).toplamlar.genel, null);
  assert.ok(aiSonucunuCevir({ ...temel, belge_turu: 'diger' }).notlar.includes('fatura_degil'));
  assert.ok(!aiSonucunuCevir(temel).notlar.includes('satir_karisik'));
  for (const metin of ['12 X 39,75', 'KAKAO TOZU 200G 2 X 46,50', '3 X 41,00 SUT 1L']) {
    assert.ok(aiSonucunuCevir({ ...temel, satirlar: [{ ...temel.satirlar[0], metin }] }).notlar.includes('satir_karisik'), metin);
  }
  assert.ok(!aiSonucunuCevir({ ...temel, satirlar: [{ ...temel.satirlar[0], metin: '6 X 50,00 SUT 1L' }] }).notlar.includes('satir_karisik'));
});
test('AI fişi "KDV dahil" dese de hesap hariç gösteriyorsa hariç sayılır', () => {
  const f = aiSonucunuCevir({ tutarlar_kdv_dahil: true, genel_toplam: 609.75, kdv_toplam: 24.75, kdv_haric_toplam: null, indirim: null,
    satirlar: [{ metin: 'SUT 1L', miktar: 6, birim: 'adet', birim_fiyat: 41, tutar: 246, kdv_orani: 1, eslesme: null },
               { metin: 'KAKAO', miktar: 1, birim: 'adet', birim_fiyat: 210, tutar: 210, kdv_orani: 10, eslesme: null },
               { metin: 'SEKER', miktar: 2, birim: 'adet', birim_fiyat: 64.5, tutar: 129, kdv_orani: 1, eslesme: null }] });
  assert.deepEqual(f.satirlar.map((s) => s.tutar_haric), [246, 210, 129]);
  assert.deepEqual(toplamKontrol(f), { tutuyor: true });
});

test('AI takip dışı dese de malzemenin baş ismini taşıyan satır sessizce düşmez (Set C, 2026-10-23)', () => {
  // "ESPRESSO HARMANI ÇEKİRDEK 1 KG": "kahve" yazmıyor ama tür (çekirdek) yazıyor → barista sayar, takip dışı değil
  const eh = aiIleSiniflandir({ metin: 'ESPRESSO HARMANI ÇEKİRDEK 1 KG', miktar: 4, birim: 'adet', ai: e('takip_disi', null, null, 0.8) }, ctx);
  assert.ok(eh.sinif === 'soru' && eh.malzeme_id === 'kc');
  // türev ürün (bardak kapağı) ya da başka ürün (kargo) AI'nın takip dışı kararıyla kalır
  assert.equal(aiIleSiniflandir({ metin: 'BARDAK KAPAĞI 12 OZ', miktar: 1, birim: 'adet', ai: e('takip_disi', null, null, 0.9) }, ctx).sinif, 'takip_disi');
  assert.equal(aiIleSiniflandir({ metin: 'KARGO BEDELİ', miktar: 1, birim: 'adet', ai: e('takip_disi', null, null, 0.9) }, ctx).sinif, 'takip_disi');
  // -lı sıfatı ürünün çeşididir, farklı ürün değil: "ÇİFT CİDARLI KARTON BARDAK" takip dışına düşmez (Set D, 2026-10-23)
  assert.equal(aiIleSiniflandir({ metin: "ÇİFT CİDARLI KARTON BARDAK 8 OZ 25'Lİ", miktar: 20, birim: 'diger', ai: e('takip_disi', null, null, 0.9) }, ctx).sinif, 'soru');
  // kısaltma (SRP) AI'nın takip dışı kararını bozmaz; tam baş isim gerekir
  assert.equal(aiIleSiniflandir({ metin: 'NANE SRP 70CL', miktar: 1, birim: 'adet', ai: e('takip_disi', null, null, 0.9) }, ctx).sinif, 'takip_disi');
});

test('tedarikçi adındaki kelime marka sayılır, -lu/-li ile bitse de türev değildir', () => {
  const s = { metin: 'ANADOLU TAM YAĞLI SÜT 1 LT', miktar: 36, birim: 'adet', ai: e('malzeme', 'sut', 36000, 0.9) };
  assert.equal(aiIleSiniflandir(s, ctx).sinif, 'soru');                           // tedarikçi bilinmiyorsa da sessizce geçilmez
  const k = aiIleSiniflandir(s, { ...ctx, tedarikciAdi: 'ANADOLU SÜT DAĞITIM A.Ş.' });
  assert.ok(k.sinif === 'soru' && k.malzeme_id === 'sut' && k.carpan === 1000);
  // -lı sıfatlı çeşit ("VANİLYALI SÜT") sessizce bağlanmaz da geçilmez de: barista sayar ya da "Bu ürün süt değil" der
  assert.equal(aiIleSiniflandir({ metin: 'ANADOLU VANİLYALI SÜT 1 LT', miktar: 6, birim: 'adet', ai: e('malzeme', 'sut', 6000, 0.9) },
    { ...ctx, tedarikciAdi: 'ANADOLU SÜT DAĞITIM A.Ş.' }).sinif, 'soru');
  // kural yolunda da (AI'sız okuma) aynı
  assert.equal(siniflandir({ metin: 'ANADOLU SÜT 1 LT', miktar: 12, birim: 'adet' }, { ...ctx, tedarikciAdi: 'Anadolu Süt Dağıtım' }).sinif, 'soru');
});
