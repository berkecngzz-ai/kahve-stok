import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DOMParser } from '@xmldom/xmldom';
import { trSayi, birimNormal, xmlOku, metinCoz, parcalariSatirla, toplamKontrol, netlikOlc } from '../../okuma.js';

test('sayılar', () => {
  assert.equal(trSayi('1.188,12'), 1188.12);
  assert.equal(trSayi('1188,12'), 1188.12);
  assert.equal(trSayi('1188.12'), 1188.12);
  assert.equal(trSayi('1.200'), 1200);
  assert.equal(trSayi('49,505 TL'), 49.505);
  assert.equal(trSayi('₺ 12,00'), 12);
  assert.equal(trSayi('abc'), null);
});
test('birimler', () => {
  assert.equal(birimNormal('C62'), 'adet');
  assert.equal(birimNormal('KGM'), 'kg');
  assert.equal(birimNormal('LTR'), 'lt');
  assert.equal(birimNormal('Adet'), 'adet');
  assert.equal(birimNormal('KG'), 'kg');
  assert.equal(birimNormal('Lt'), 'lt');
  assert.equal(birimNormal('GR'), 'g');
  assert.equal(birimNormal('Koli'), 'diger');   // paket içi bilinmeden adede çevrilmez
  assert.equal(birimNormal('PK'), 'diger');
  assert.equal(birimNormal('xyz'), 'diger');
});
test('e-fatura XML', () => {
  const r = xmlOku(readFileSync(new URL('./ornekler/efatura.xml', import.meta.url), 'utf8'), DOMParser);
  assert.equal(r.ettn, 'f47ac10b-58cc-4372-a567-0e02b2c3d479');
  assert.equal(r.fatura_no, 'MGD2026000000123');
  assert.equal(r.tedarikci, 'Örnek Gıda Pazarlama Ltd. Şti.');
  assert.equal(r.tedarikci_vkn, '1234567890');
  assert.equal(r.tarih, '2026-10-15');
  assert.deepEqual(r.toplamlar, { genel: 1320, kdv_haric: 1288.12, kdv: 31.88, indirim: 0 });
  assert.equal(r.satirlar.length, 2);
  assert.deepEqual(r.satirlar[0], { metin: 'SÜTAŞ SÜT 1L', miktar: 24, birim: 'adet', birim_fiyat: 49.505, tutar_haric: 1188.12, kdv_orani: 1 });
  assert.equal(r.satirlar[1].kdv_orani, 20);
  assert.deepEqual(toplamKontrol(r), { tutuyor: true });
});
test('XML olmayan dosya', () => {
  assert.throws(() => xmlOku('<html><body/></html>', DOMParser), /e-fatura değil/);
});

// GİB e-arşiv/e-fatura PDF'inden pdf.js ile çıkan satırlara benzer metin
const pdfSatirlari = [
  'ÖRNEK GIDA PAZARLAMA LTD. ŞTİ.',
  'Atatürk Cad. No:1 Kadıköy / İSTANBUL',
  'Vergi Dairesi: Kadıköy  VKN: 1234567890',
  'SAYIN',
  'KAFE A',
  'e-FATURA',
  'Özelleştirme No:  TR1.2',
  'Fatura No:  MGD2026000000124',
  'Fatura Tarihi:  15-10-2026',
  'ETTN: 9b1deb4d-3b7d-4bad-9bdc-2b0d7b3dcb6d',
  'Sıra No  Mal Hizmet  Miktar  Birim Fiyat  İskonto Oranı  İskonto Tutarı  KDV Oranı  KDV Tutarı  Mal Hizmet Tutarı',
  '1  SÜTAŞ SÜT 1L  24 Adet  49,505 TL  %0,00  0,00 TL  %1,00  11,88 TL  1.188,12 TL',
  '2  KAHVE ÇEKİRDEĞİ 1KG  5 Adet  900,00 TL  %0,00  0,00 TL  %1,00  45,00 TL  4.500,00 TL',
  '3  BULAŞIK DETERJANI 5L  1 Adet  100,00 TL  %0,00  0,00 TL  %20,00  20,00 TL  100,00 TL',
  'Mal Hizmet Toplam Tutarı  5.788,12 TL',
  'Toplam İskonto  0,00 TL',
  'Hesaplanan KDV(%1,00)  56,88 TL',
  'Hesaplanan KDV(%20,00)  20,00 TL',
  'Vergiler Dahil Toplam Tutar  5.865,00 TL',
  'Ödenecek Tutar  5.865,00 TL',
];
test('PDF metni', () => {
  const r = metinCoz(pdfSatirlari);
  assert.equal(r.fatura_no, 'MGD2026000000124');
  assert.equal(r.tarih, '2026-10-15');
  assert.equal(r.tedarikci_vkn, '1234567890');
  assert.equal(r.ettn, '9b1deb4d-3b7d-4bad-9bdc-2b0d7b3dcb6d');
  assert.equal(r.tedarikci, 'ÖRNEK GIDA PAZARLAMA LTD. ŞTİ.');
  assert.deepEqual(r.toplamlar, { genel: 5865, kdv_haric: 5788.12, kdv: 76.88, indirim: 0 });
  assert.equal(r.satirlar.length, 3);
  assert.deepEqual(r.satirlar[0], { metin: 'SÜTAŞ SÜT 1L', miktar: 24, birim: 'adet', birim_fiyat: 49.505, tutar_haric: 1188.12, kdv_orani: 1 });
  assert.deepEqual(r.satirlar[1], { metin: 'KAHVE ÇEKİRDEĞİ 1KG', miktar: 5, birim: 'adet', birim_fiyat: 900, tutar_haric: 4500, kdv_orani: 1 });
  assert.equal(r.satirlar[2].kdv_orani, 20);
  assert.deepEqual(toplamKontrol(r), { tutuyor: true });
});
test('OCR gürültüsü: bir rakam yanlış okunursa toplam tutmaz', () => {
  const bozuk = pdfSatirlari.map((s) => s.replace('1.188,12 TL', '1.788,12 TL'));
  const r = metinCoz(bozuk);
  const k = toplamKontrol(r);
  assert.equal(k.tutuyor, false);
  assert.equal(k.sebep, 'fark');
});
test('Toplam okunamazsa', () => {
  const r = metinCoz(pdfSatirlari.filter((s) => !/Ödenecek|Vergiler Dahil/.test(s)));
  assert.ok(r.notlar.includes('toplam_yok'));
  assert.equal(toplamKontrol(r).tutuyor, false);
});
test('Basit fatura: KDV oranı satırda yok, belgede tek oran var', () => {
  const r = metinCoz([
    'YILDIZ SÜT ÜRÜNLERİ SAN. TİC. A.Ş.',
    'Fatura No: YSU2026000000045   Tarih: 03.10.2026',
    'Süt 1 Lt 12 adet 45,00 540,00',
    'Kaşar Peyniri 2 kg 380,00 760,00',
    'Ara Toplam 1.300,00',
    'Hesaplanan KDV %1 13,00',
    'Genel Toplam 1.313,00',
  ]);
  assert.equal(r.satirlar.length, 2);
  // "Süt 1 Lt 12 adet": ilk miktar-birim "1 Lt" yakalanır → paket boyu metinde kalmalı mı? Satır bekleyebilir; toplam yine de tutar
  assert.equal(r.satirlar[1].miktar, 2);
  assert.equal(r.satirlar[1].birim, 'kg');
  assert.equal(r.satirlar[1].kdv_orani, 1);
  assert.deepEqual(r.toplamlar, { genel: 1313, kdv_haric: 1300, kdv: 13, indirim: 0 });
  assert.equal(toplamKontrol(r).tutuyor, true);
});
test('pdf.js parçalarını satırlara dizme', () => {
  const s = parcalariSatirla([
    { str: '24 Adet', x: 200, y: 500, h: 10 }, { str: 'SÜT', x: 50, y: 501, h: 10 },
    { str: 'Ödenecek Tutar', x: 50, y: 300, h: 10 }, { str: '1.320,00', x: 400, y: 299, h: 10 },
  ]);
  assert.deepEqual(s, ['SÜT  24 Adet', 'Ödenecek Tutar  1.320,00']);
});
test('netlik ölçümü: düz gri bulanık, keskin kenar net', () => {
  const en = 40, boy = 40;
  const duz = new Float32Array(en * boy).fill(128);
  const keskin = new Float32Array(en * boy).map((_, i) => ((i % en) % 4 < 2 ? 0 : 255));
  assert.ok(netlikOlc(duz, en, boy) < 1);
  assert.ok(netlikOlc(keskin, en, boy) > 1000);
});

import { ocrDuzelt, kdvOranlariniCoz } from '../../okuma.js';
test('OCR karakter düzeltme', () => {
  assert.equal(ocrDuzelt('1 SÜTAŞ SÜT İL 24 Adet'), '1 SÜTAŞ SÜT 1L 24 Adet');
  assert.equal(ocrDuzelt('ESPRESSO BLEND İKG 5 Adet'), 'ESPRESSO BLEND 1KG 5 Adet');
  assert.equal(ocrDuzelt('İLK SATIR'), 'İLK SATIR');          // kelime başı İ değişmez
  assert.equal(ocrDuzelt('KILO'), 'KILO');
  assert.equal(ocrDuzelt('ESPRESSO BLEND 1İKG 5 Adet'), 'ESPRESSO BLEND 1KG 5 Adet');   // canlı OCR çıktısı
  assert.equal(ocrDuzelt('SÜT 11L'), 'SÜT 11L');
});
// Gerçek OCR çıktısı (tarayıcıda Tesseract ile okunmuş sentetik fatura): "%1" → "Yi", "(%1)" → "(11)"
const ocrCiktisi = `ÖRNEK GIDA PAZARLAMA LTD. ŞTİ.
Kadıköy V.D. VKN: 1234567890
Fatura No: MGD2026000000777
Fatura Tarihi: 16-10-2026
Sıra Mal Hizmet Miktar Birim Fiyat KDV Tutar
1 SÜTAŞ SÜT İL 24 Adet 49,505 Yi 1.188,12
2 ESPRESSO BLEND İKG 5 Adet 900,00 Yi 4.500,00
3 PEÇETE 100LÜ 1 Adet 100,00 Y020 100,00
Mal Hizmet Toplam Tutarı 5.788,12
Hesaplanan KDV(11) 56,88
Hesaplanan KDV(20) 20,00
Ödenecek Tutar 5.865,00`.split('\n');
test('gerçek OCR çıktısı: oranlar toplamlardan çözülür, toplam tutar', () => {
  const r = metinCoz(ocrCiktisi);
  assert.deepEqual(r.satirlar.map((s) => [s.metin, s.miktar, s.kdv_orani]),
    [['SÜTAŞ SÜT 1L', 24, 1], ['ESPRESSO BLEND 1KG', 5, 1], ['PEÇETE 100LÜ', 1, 20]]);
  assert.equal(r.fatura_no, 'MGD2026000000777');
  assert.deepEqual(toplamKontrol(r), { tutuyor: true });
});
test('KDV oranı: birden fazla dağılım tutarsa tahmin yok', () => {
  const u = [{ tutar_haric: 100, kdv_orani: null }, { tutar_haric: 100, kdv_orani: null }];
  kdvOranlariniCoz(u, { kdv: 11, genel: null });          // %1 + %10 ya da %10 + %1 → belirsiz
  assert.deepEqual(u.map((x) => x.kdv_orani), [null, null]);
  const v = [{ tutar_haric: 1000, kdv_orani: null }, { tutar_haric: 3000, kdv_orani: null }];
  kdvOranlariniCoz(v, { kdv: 310, genel: null });         // yalnız %1 (1000) + %10 (3000)
  assert.deepEqual(v.map((x) => x.kdv_orani), [1, 10]);
});

// ---------- Kullanıcının gerçek denemesinden (2026-10-20) OCR çıktıları ----------
const toptanOcr = "TEST BELGESİDİR - GEÇERLİ FATURA DEĞİLDİR\nÖRNEK TOPTAN GIDA (TEST) FATURA\nAlanya/ANTALYA VKN: 3333333333 (hayali) No: TST-A-000103\nTarih: 14.10.2026\nSayın: TEST KAFE\nÜrün Mkt Brm B.Fiyat KDV Tutar\nACIFTLIK T.YAG SUT 1LT 12 AD 38,50 1 462,00\nMNN KRML SRP 70CL 1 AD 265,00 9010 265,00\nPECETE 100LU 10 PK 42,00 9020 420,00\nBULASIK DETERJANI 5LT 1 AD 189,90 9020 189,90\nKARTON BARDAK 8OZ SOL! 4 PK 95,00 920 380,00\n—————————İRR\nAra Toplam 1.716,90\nKDV 941 4,62\nKDV 9010 26,50\nKDV 9420 197,98\nGENEL TOPLAM 1.946,00\n";
test('gerçek OCR: bozuk KDV oranları, KDV satırlarının tutarlarından çözülür; PK paket sayılır', () => {
  const r = metinCoz(toptanOcr.split('\n'));
  assert.equal(r.tedarikci, 'ÖRNEK TOPTAN GIDA (TEST)');
  assert.equal(r.fatura_no, 'TST-A-000103');
  assert.deepEqual(r.satirlar.map((s) => [s.miktar, s.birim, s.kdv_orani]),
    [[12, 'adet', 1], [1, 'adet', 10], [10, 'diger', 20], [1, 'adet', 20], [4, 'diger', 20]]);
  assert.deepEqual(toplamKontrol(r), { tutuyor: true });
});
const fisOcr = "** TEST FİŞİ **\nGEÇERLİ BELGE DEĞİLDİR\nDENEME MARKET (TEST)\nALANYA\n15.10.2026 FİŞ 0047\n6 x 41,00\nSUT 1L YAGLI S1 246,00\n1 x 210,00\nKAKAO TOZU 5006 “10 210,00\n2 x 64,50\nSEKER KUP 1KG &l1 129,00\nTOPKDV 24,75\nTOPLAM 609,75\nKREDİ KARTI\n";
test('gerçek OCR: fiş biçimi ("6 x 41,00" + alt satır)', () => {
  const r = metinCoz(fisOcr.split('\n'));
  assert.deepEqual(r.satirlar.map((s) => [s.metin, s.miktar, s.birim, s.tutar_haric, s.kdv_orani]),
    [['SUT 1L YAGLI', 6, 'adet', 246, 1], ['KAKAO TOZU 5006', 1, 'adet', 210, 10], ['SEKER KUP 1KG', 2, 'adet', 129, 1]]);
  assert.equal(r.toplamlar.genel, 609.75);
  assert.deepEqual(toplamKontrol(r), { tutuyor: true });
});
test('fiş: tutarlar KDV dahilse hariç tutara çevrilir', () => {
  const r = metinCoz(['MARKET A.Ş.', 'FİŞ NO: 12', '2 x 50,50', 'SUT 1L %1 101,00', 'SİMİT %10 22,00', 'TOPKDV 3,00', 'TOPLAM 123,00']);
  assert.deepEqual(r.satirlar.map((s) => [s.metin, s.miktar, s.tutar_haric, s.kdv_orani]), [['SUT 1L', 2, 100, 1], ['SİMİT', 1, 20, 10]]);
  assert.ok(r.notlar.includes('fis_kdv_dahil'));
  assert.deepEqual(toplamKontrol(r), { tutuyor: true });
});
test('tedarikçi: "A.Ş." ve sondaki "e-FATURA"', () => {
  const r = metinCoz(['DENEME KAHVE KAVURMA A.Ş.  e-FATURA', 'VKN: 2222222222']);
  assert.equal(r.tedarikci, 'DENEME KAHVE KAVURMA A.Ş.');
});
