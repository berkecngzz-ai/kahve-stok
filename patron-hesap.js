// Patron ekranlarının hesap ve yazım kuralları. Saf işlevler (ekran/veritabanı yok) → node --test ile denenir.

// Açık "büyük" sayılır: kayıp, kullanılanın (satış + fire) %3'ünden fazla VE 50 TL'den büyükse.
// İki şart birlikte: çok kullanılan malzemede küçük oran da para eder; az kullanılanda tek bir eksik oranı şişirir.
export const ACIK_ORAN_ESIGI = 0.03;
export const ACIK_TL_ESIGI = 50;

const BOLEN = { g: 1000, ml: 1000, adet: 1 };
const BUYUK = { g: 'kg', ml: 'litre', adet: 'adet' };

const sayi = (n, basamak) => new Intl.NumberFormat('tr-TR', { maximumFractionDigits: basamak }).format(n);

// Günlük dilde miktar: 12000 ml → "12 litre", 1250 g → "1,25 kg", 350 ml → "350 ml", 1500 adet → "1.500 adet".
export function okunurMiktar(miktar, birim, { isaret = false } = {}) {
  const n = miktar == null ? NaN : Number(miktar);
  if (!Number.isFinite(n)) return '—';
  const on = isaret && n > 0 ? '+' : n < 0 ? '−' : '';
  const m = Math.abs(n);
  if (birim === 'adet') return `${on}${sayi(Math.round(m), 0)} adet`;
  if (m < 1000) return `${on}${sayi(Math.round(m), 0)} ${birim}`;
  const b = m / BOLEN[birim];
  return `${on}${sayi(b, b >= 100 ? 0 : b >= 10 ? 1 : 2)} ${BUYUK[birim]}`;
}

// Para: "1.234 TL", "−62 TL" (10 TL ve üstünde kuruş gösterilmez), "−5,80 TL", "0 TL".
export function tlYaz(tutar, { isaret = false, kurus = null } = {}) {
  const n = tutar == null ? NaN : Number(tutar);
  if (!Number.isFinite(n)) return '—';
  const m = Math.abs(n);
  const basamak = kurus ?? (m >= 10 || m < 0.005 ? 0 : 2);
  const on = isaret && n > 0 ? '+' : n < 0 && Math.round(m * 10 ** basamak) !== 0 ? '−' : '';
  return `${on}${new Intl.NumberFormat('tr-TR', { minimumFractionDigits: basamak, maximumFractionDigits: basamak }).format(m)} TL`;
}

// Bir miktarın güncel fiyatla TL karşılığı (fiyat kg/litre/adet başına).
export const miktarTl = (miktar, birim, fiyat) =>
  (Number(fiyat) > 0 ? Number(miktar) * Number(fiyat) / BOLEN[birim] : null);

// Rapor satırının durumu: 'buyuk' (kırmızı), 'normal' (yeşil), 'fazla' (sarı: girilmemiş satış/fatura olabilir).
export function acikDurumu(x) {
  const fark = Number(x.fark);
  const kullanilan = Number(x.satis || 0) + Number(x.fire || 0);
  const oran = kullanilan > 0 ? Math.abs(fark) / kullanilan : (fark ? Infinity : 0);
  const tl = Math.abs(Number(x.fark_tl ?? miktarTl(fark, x.birim, x.fiyat) ?? 0));
  if (oran <= ACIK_ORAN_ESIGI || tl <= ACIK_TL_ESIGI) return 'normal';
  return fark < 0 ? 'buyuk' : 'fazla';
}

// Kayıp oranı yüzde metni: "%17,8" (kullanım yoksa boş).
export function acikOrani(x) {
  const kullanilan = Number(x.satis || 0) + Number(x.fire || 0);
  if (!(kullanilan > 0)) return '';
  return `%${sayi(Math.abs(Number(x.fark)) / kullanilan * 100, 1)}`;
}

// "16–23 Ekim", ay değişirse "28 Eyl – 5 Eki".
export function donemYaz(baslangic, bitis) {
  const t = (s) => new Date(`${s}T12:00:00`);
  const a = t(baslangic), b = t(bitis);
  const ay = (d, uzun) => d.toLocaleDateString('tr-TR', { month: uzun ? 'long' : 'short' });
  if (!baslangic) return `${b.getDate()} ${ay(b, true)}`;
  if (a.getMonth() === b.getMonth()) return `${a.getDate()}–${b.getDate()} ${ay(b, true)}`;
  return `${a.getDate()} ${ay(a)} – ${b.getDate()} ${ay(b)}`;
}

// Stok kaç gün yeter → 'az' (≤2 gün), 'dikkat' (≤5 gün), 'iyi'. Tahmin yoksa null.
export function yeterDurumu(gun) {
  if (gun == null) return null;
  return gun <= 2 ? 'az' : gun <= 5 ? 'dikkat' : 'iyi';
}

// Haftalık açık TL trendi için sade SVG çubuk grafiği (eski → yeni, soldan sağa). Ekran okuyucu için başlık + özet.
export function trendSvg(donemler, { genislik = 320, yukseklik = 120 } = {}) {
  const liste = [...donemler].reverse();
  if (!liste.length) return '';
  const deger = liste.map((d) => Math.abs(Number(d.acik_tl) || 0));
  const enBuyuk = Math.max(...deger, 1);
  const alt = 22, ust = 18, aralik = genislik / liste.length;
  const cubukG = Math.min(36, aralik * 0.6);
  const cubuklar = liste.map((d, i) => {
    const h = Math.max(2, (deger[i] / enBuyuk) * (yukseklik - alt - ust));
    const x = i * aralik + (aralik - cubukG) / 2;
    const y = yukseklik - alt - h;
    const sinif = d.buyuk ? 'cubuk-kirmizi' : 'cubuk-normal';
    const etiket = new Date(`${d.bitis}T12:00:00`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
    return `<rect class="${sinif}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${cubukG.toFixed(1)}" height="${h.toFixed(1)}" rx="4"></rect>
      <text class="grafik-deger" x="${(x + cubukG / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle">${deger[i] >= 1000 ? sayi(deger[i] / 1000, 1) + 'b' : sayi(deger[i], 0)}</text>
      <text class="grafik-etiket" x="${(x + cubukG / 2).toFixed(1)}" y="${yukseklik - 6}" text-anchor="middle">${etiket}</text>`;
  }).join('');
  const ozet = liste.map((d, i) => `${donemYaz(d.baslangic, d.bitis)}: ${tlYaz(-deger[i])}`).join(', ');
  return `<svg class="grafik" viewBox="0 0 ${genislik} ${yukseklik}" role="img" aria-label="Haftalık açık (TL): ${ozet}">
    <line class="grafik-taban" x1="0" x2="${genislik}" y1="${yukseklik - alt}" y2="${yukseklik - alt}"></line>${cubuklar}</svg>`;
}
