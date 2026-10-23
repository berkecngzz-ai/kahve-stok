import { test } from 'node:test';
import assert from 'node:assert/strict';
import { karekodCoz, karekodlaKarsilastir, karekoduUygula } from '../../karekod.js';
import { ayniMiktar, teslimatKarari, satirEsle, farkTutari } from '../../mal-kabul.js';

// GİB Karekod Standardı Kılavuzu V1.1'deki e-Fatura örneği (alan adlarında boşluk ve "(8)" oranı ile)
const GIB_ORNEK = '{" vkntckn ":"1111111111", " avkntckn ":"2222222222", "senaryo":"TEMELFATURA", "tip":"SATIS",'
  + ' "tarih ":"2022-08-17", "no":"GIB2022000000001", " ettn ":"04E26A62-7C00-46D0-878C-6F7C60834525",'
  + ' "parabirimi":"TRY", "malhizmettoplam":"1000.00", "kdvmatrah (8) ":"1000.00", "hesaplanankdv (8) ":"80.00",'
  + ' "vergidahil":"1080.00", "odenecek":"1080.00"}';

test('karekod: GİB örneği çözülür (kimlik + toplamlar)', () => {
  const k = karekodCoz(GIB_ORNEK);
  assert.equal(k.tur, 'fatura');
  assert.equal(k.vkn, '1111111111');
  assert.equal(k.alici_vkn, '2222222222');
  assert.equal(k.no, 'GIB2022000000001');
  assert.equal(k.ettn, '04e26a62-7c00-46d0-878c-6f7c60834525');
  assert.equal(k.tarih, '2022-08-17');
  assert.equal(k.malhizmet, 1000);
  assert.deepEqual(k.matrahlar, { 8: 1000 });
  assert.equal(k.kdv_toplam, 80);
  assert.equal(k.vergidahil, 1080);
  assert.equal(k.odenecek, 1080);
});

test('karekod: birden çok KDV oranı, "(10.00)" biçimi ve Türkçe sayı', () => {
  const k = karekodCoz('{"vkntckn":"3333333333","senaryo":"EARSIVFATURA","tip":"SATIS","tarih":"2026-10-20","no":"ABC2026000000123",'
    + '"ettn":"11111111-2222-3333-4444-555555555555","malhizmettoplam":"1.195,48","kdvmatrah(10.00)":"1095.48",'
    + '"hesaplanankdv(10.00)":"109.55","kdvmatrah(1)":"100","hesaplanankdv(1)":"1","vergidahil":"1306.03","odenecek":"1306.03"}');
  assert.equal(k.malhizmet, 1195.48);
  assert.deepEqual(k.kdvler, { 10: 109.55, 1: 1 });
  assert.equal(k.kdv_toplam, 110.55);
});

test('karekod: irsaliye, bozuk ve fatura olmayan karekod', () => {
  const irs = karekodCoz('{"vkntckn":"1111111111","senaryo":"TEMELIRSALIYE","tip":"SEVK","tarih":"2022-08-17","no":"IRS2022000000001","ettn":"04e35a51-7c00-45d0-968c-6f7c60834525"}');
  assert.equal(irs.tur, 'irsaliye');
  assert.equal(karekodCoz('https://ornek.com/menu'), null);
  assert.equal(karekodCoz('{bozuk json'), null);
  assert.equal(karekodCoz('{"a":"b"}'), null);
  // Geçersiz ETTN ve tarih alınmaz ama fatura toplamı varsa karekod yine fatura sayılır
  const k = karekodCoz('{"ettn":"xyz","tarih":"17.08.2022","odenecek":"50.00"}');
  assert.equal(k.ettn, null);
  assert.equal(k.tarih, null);
  assert.equal(k.tur, 'fatura');
});

const okunan = (genel, kdv, haricler) => ({
  toplamlar: { genel, kdv, kdv_haric: null, indirim: 0 },
  satirlar: haricler.map((h, i) => ({ metin: `S${i}`, tutar_haric: h })),
});

test('karekod karşılaştırma: tutan okuma, yanlış toplam, yanlış satır', () => {
  const k = karekodCoz(GIB_ORNEK);
  assert.deepEqual(karekodlaKarsilastir(k, okunan(1080, 80, [600, 400])), { tutuyor: true, celiskiler: [] });
  // AI toplamı 1008 okudu (rakam kaydı) → çelişki
  const r1 = karekodlaKarsilastir(k, okunan(1008, 80, [600, 400]));
  assert.equal(r1.tutuyor, false);
  assert.equal(r1.celiskiler[0].alan, 'genel');
  // Toplamlar doğru ama bir satır yanlış okunmuş (900 + 400 = 1300 ≠ 1000) → çelişki: toplam tutması yetmez
  const r2 = karekodlaKarsilastir(k, okunan(1080, 80, [900, 400]));
  assert.equal(r2.tutuyor, false);
  assert.equal(r2.celiskiler[0].alan, 'satirlar');
  // İrsaliye karekodu toplam kontrolüne girmez
  assert.equal(karekodlaKarsilastir({ tur: 'irsaliye' }, okunan(1, 1, [1])).tutuyor, null);
});

test('karekod uygulama: kimlik karekoddan, okunan kimlik saklanır, eksik toplam karekoddan', () => {
  const k = karekodCoz(GIB_ORNEK);
  const s = { fatura_no: 'GIB2O22OOOOOOOO1', tarih: '2022-08-11', tedarikci_vkn: null, ettn: null,
    toplamlar: { genel: null, kdv: null }, notlar: ['toplam_yok'], satirlar: [] };
  karekoduUygula(k, s);
  assert.equal(s.fatura_no, 'GIB2022000000001');
  assert.equal(s.tarih, '2022-08-17');
  assert.equal(s.ettn, k.ettn);
  assert.equal(s.okunan_kimlik.fatura_no, 'GIB2O22OOOOOOOO1');
  assert.equal(s.toplamlar.genel, 1080);
  assert.ok(s.notlar.includes('toplam_karekoddan') && !s.notlar.includes('toplam_yok'));
  // Okunan toplam varsa DEĞİŞTİRİLMEZ (çelişki gizlenmez)
  const s2 = { toplamlar: { genel: 999, kdv: 80 }, notlar: [], satirlar: [] };
  karekoduUygula(k, s2);
  assert.equal(s2.toplamlar.genel, 999);
});

test('kör sayım kararı: tam / okuma hatası / teslimat farkı / belirsiz', () => {
  assert.equal(ayniMiktar(24, 24), true);
  assert.equal(ayniMiktar(1.033, 1.034), true);       // küsuratlı tartı payı
  assert.equal(ayniMiktar(22, 24), false);
  assert.equal(teslimatKarari({ kaynak: 'ai', faturadaki: 24, sayilan: 24 }).karar, 'tam');
  // e-fatura XML / metinli PDF: okuma kesin → fark teslimattadır
  assert.equal(teslimatKarari({ kaynak: 'xml', faturadaki: 24, sayilan: 22 }).karar, 'teslimat_farki');
  assert.equal(teslimatKarari({ kaynak: 'pdf', faturadaki: 24, sayilan: 22 }).karar, 'teslimat_farki');
  // Fotoğraf: "2 X 129" → AI 1 okudu, barista 2 saydı, ikinci okuma 2 → okuma hatası, fark kaydı YOK
  const r = teslimatKarari({ kaynak: 'ai', faturadaki: 1, sayilan: 2, ikinci: 2 });
  assert.deepEqual(r, { karar: 'okuma_hatasi', faturadaki: 2 });
  // İki okuma da 24, barista 22 → gerçek eksik teslimat
  assert.deepEqual(teslimatKarari({ kaynak: 'ai', faturadaki: 24, sayilan: 22, ikinci: 24 }), { karar: 'teslimat_farki', faturadaki: 24 });
  // İkinci okuma yok ya da üçüncü bir sayı → belirsiz (patron faturaya bakar)
  assert.equal(teslimatKarari({ kaynak: 'ai', faturadaki: 24, sayilan: 22 }).karar, 'belirsiz');
  assert.equal(teslimatKarari({ kaynak: 'ai', faturadaki: 24, sayilan: 22, ikinci: 20 }).karar, 'belirsiz');
});

test('ikinci okumada aynı satırı bulma ve fark tutarı', () => {
  const ikinci = [{ metin: 'PINAR TAM YAGLI SUT 1L', ai: { malzeme_id: 'sut' } },
                  { metin: 'ESPRESSO CEKIRDEK 1KG', ai: { malzeme_id: 'kc' } }];
  assert.equal(satirEsle({ metin: 'ESPRESSO ÇEKİRDEK 1KG', karar: { malzeme_id: 'kc' } }, ikinci), 1);
  assert.equal(satirEsle({ metin: 'PINAR TAM YAĞLI SÜT 1 L' }, ikinci), 0);
  assert.equal(satirEsle({ metin: 'PEÇETE' }, ikinci), -1);
  assert.equal(satirEsle({ metin: 'PINAR TAM YAGLI SUT 1L' }, ikinci, new Set([0])), -1);   // kullanılmış satır
  // 24 L süt 960 TL KDV hariç, %1 KDV → litre 40,40 TL; 2 L eksik → 80,80 TL
  assert.equal(farkTutari({ tutar_haric: 960, kdv_orani: 1 }, 24, 22), 80.8);
  assert.equal(farkTutari({ tutar_haric: 960, kdv_orani: 1 }, 24, 25), -40.4);   // fazla teslimat eksi
  assert.equal(farkTutari({ tutar_haric: null, kdv_orani: 1 }, 24, 22), null);
});
