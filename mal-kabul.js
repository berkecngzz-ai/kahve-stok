// Mal kabul (kör sayım) kararları. Ekrandan ve sunucudan bağımsız; testlerle doğrulanır.
//
// Akış: barista faturadaki miktarı GÖRMEDEN gelen malı sayar. Sayılan, faturadan okunanla karşılaştırılır:
//   aynı                         → teslimat tam
//   farklı                       → barista bir kez daha sayar (yine faturadaki sayıyı görmez)
//   hâlâ farklı                  → fark okumadan mı, teslimattan mı?
//       belge kesin (XML / metinli PDF)           → teslimat farkı
//       fotoğraf: ikinci okuma sayılanla aynı      → okuma hatası (ilk okuma yanlıştı; fark kaydı AÇILMAZ)
//       fotoğraf: ikinci okuma ilk okumayla aynı   → teslimat farkı
//       fotoğraf: ikinci okuma yok / üçüncü bir sayı → belirsiz (fark kaydı açılır, "okuma şüpheli": patron
//                                                       faturanın fotoğrafına bakıp karar verir)
// Stok her durumda SAYILAN kadar artar (rafta olan budur); karar yalnız "patrona görev açılsın mı" sorusudur.

import { benzerlik, anahtar } from './eslestirme.js?v=b8a55f4b16';

// İki miktar aynı mı? Adet/paket tam sayıdır; kg/litre küsuratlı olabilir (%0,5 pay).
export function ayniMiktar(a, b) {
  const x = Number(a), y = Number(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return Math.abs(x - y) <= Math.max(1e-9, 0.005 * Math.max(Math.abs(x), Math.abs(y)));
}

// Okuma kaynağı kesin mi? (e-fatura XML ve metinli PDF: sayılar dosyadan gelir, okuma hatası olmaz)
export const kesinKaynak = (kaynak) => kaynak === 'xml' || kaynak === 'pdf';

// faturadaki: ilk okumadaki miktar (belge birimi) · sayilan: baristanın son sayımı (aynı birim)
// ikinci: ikinci okumada aynı satırın miktarı (yoksa null)
// Dönen: { karar: 'tam'|'okuma_hatasi'|'teslimat_farki'|'belirsiz', faturadaki }  — faturadaki = fark hesabında
//         esas alınacak fatura miktarı (okuma hatasında sayılana eşitlenir).
export function teslimatKarari({ kaynak, faturadaki, sayilan, ikinci = null }) {
  if (ayniMiktar(faturadaki, sayilan)) return { karar: 'tam', faturadaki };
  if (kesinKaynak(kaynak)) return { karar: 'teslimat_farki', faturadaki };
  if (ikinci != null && ayniMiktar(ikinci, sayilan)) return { karar: 'okuma_hatasi', faturadaki: sayilan };
  if (ikinci != null && ayniMiktar(ikinci, faturadaki)) return { karar: 'teslimat_farki', faturadaki };
  return { karar: 'belirsiz', faturadaki };
}

// İkinci okumada aynı satırı bulur: önce eşleşen malzeme (AI'nın önerisi), sonra ad benzerliği.
// Birden çok aday eşit benzerse (aynı ürün iki satırda) sıradaki kullanılmamış olan alınır.
export function satirEsle(satir, satirlar, kullanilan = new Set()) {
  let enIyi = -1, puan = 0;
  satirlar.forEach((s, i) => {
    if (kullanilan.has(i)) return;
    let p = Math.max(benzerlik(satir.metin, s.metin), benzerlik(s.metin, satir.metin));
    if (anahtar(satir.metin) === anahtar(s.metin)) p = 1.01;
    const mal = satir.karar?.malzeme_id ?? satir.ai?.malzeme_id;
    if (mal && (s.ai?.malzeme_id === mal || s.karar?.malzeme_id === mal)) p += 0.5;
    if (p > puan) { puan = p; enIyi = i; }
  });
  return puan >= 0.5 ? enIyi : -1;
}

// Eksik/fazla teslimatın TL karşılığı (KDV dahil): satırın fatura tutarından birim fiyat × fark.
export function farkTutari(satir, faturadaki, gelen) {
  if (satir.tutar_haric == null || satir.kdv_orani == null || !(Number(faturadaki) > 0)) return null;
  const birimDahil = (satir.tutar_haric * (1 + satir.kdv_orani / 100)) / Number(faturadaki);
  return Math.round(birimDahil * (Number(faturadaki) - Number(gelen)) * 100) / 100;
}
