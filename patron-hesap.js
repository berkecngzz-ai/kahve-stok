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
// esik: oran (0,05 = %5); mekânın "fark eşiği" ayarı. Verilmezse eski sabit.
export function acikDurumu(x, esik = ACIK_ORAN_ESIGI) {
  const fark = Number(x.fark);
  const kullanilan = Number(x.satis || 0) + Number(x.fire || 0);
  const oran = kullanilan > 0 ? Math.abs(fark) / kullanilan : (fark ? Infinity : 0);
  const tl = Math.abs(Number(x.fark_tl ?? miktarTl(fark, x.birim, x.fiyat) ?? 0));
  if (oran <= esik || tl <= ACIK_TL_ESIGI) return 'normal';
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
  return gun < 2 ? 'az' : gun <= 5 ? 'dikkat' : 'iyi';     // < 2 gün kırmızı, 2–5 amber, sonrası nötr
}

// Haftalık stok farkı grafiği (eski → yeni, soldan sağa): her sütunun üstünde tutarı ("1.267 TL"); normal seviye verilirse
// ince kesik çizgi. Sütunlar nötr; yalnız normalden yüksek hafta kırmızı. Ekran okuyucu için başlık + özet.
export function trendSvg(donemler, { genislik = 340, yukseklik = 150, normal = null } = {}) {
  const liste = [...donemler].reverse();
  if (!liste.length) return '';
  const deger = liste.map((d) => Math.abs(Number(d.acik_tl) || 0));
  const enBuyuk = Math.max(...deger, normal ?? 0, 1);
  const alt = 22, ust = 20, aralik = genislik / liste.length;
  const cubukG = Math.min(34, aralik * 0.56);
  const yBul = (v) => yukseklik - alt - (v / enBuyuk) * (yukseklik - alt - ust);
  const kisa = (v) => `${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(Math.round(v))} TL`;
  const cubuklar = liste.map((d, i) => {
    const y = Math.min(yBul(deger[i]), yukseklik - alt - 2);
    const x = i * aralik + (aralik - cubukG) / 2;
    const etiket = new Date(`${d.bitis}T12:00:00`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
    return `<rect class="${d.buyuk ? 'cubuk-kirmizi' : 'cubuk-normal'}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${cubukG.toFixed(1)}"
        height="${(yukseklik - alt - y).toFixed(1)}" rx="4"></rect>
      <text class="grafik-deger" x="${(x + cubukG / 2).toFixed(1)}" y="${(y - 5).toFixed(1)}" text-anchor="middle">${kisa(deger[i])}</text>
      <text class="grafik-etiket" x="${(x + cubukG / 2).toFixed(1)}" y="${yukseklik - 6}" text-anchor="middle">${etiket}</text>`;
  }).join('');
  const normalCizgi = normal != null && normal > 0
    ? `<line class="grafik-normal" x1="0" x2="${genislik}" y1="${yBul(normal).toFixed(1)}" y2="${yBul(normal).toFixed(1)}"></line>` : '';
  const ozet = liste.map((d, i) => `${donemYaz(d.baslangic, d.bitis)}: ${kisa(deger[i])}`).join(', ');
  return `<svg class="grafik" viewBox="0 0 ${genislik} ${yukseklik}" role="img" aria-label="Haftalık stok farkı: ${ozet}${normal != null
    ? `; normal seviye ${kisa(normal)}` : ''}">
    <line class="grafik-taban" x1="0" x2="${genislik}" y1="${yukseklik - alt}" y2="${yukseklik - alt}"></line>${normalCizgi}${cubuklar}</svg>`;
}

// Haftalık raporu Excel'in Türkçe ayarında doğrudan açılan CSV'ye çevirir (noktalı virgül, ondalık virgül, BOM).
// Miktarlar günlük birimle (kg / litre / adet), TL bugünkü fiyatla.
export function raporCsv(r, mekanAdi = '') {
  const BUYUK_AD = { g: 'kg', ml: 'litre', adet: 'adet' };
  const sayi = (n, b = 3) => (n == null || !Number.isFinite(Number(n)) ? ''
    : new Intl.NumberFormat('tr-TR', { maximumFractionDigits: b, useGrouping: false }).format(Number(n)));
  const tarihTr = (t) => (t ? String(t).split('-').reverse().join('.') : '');
  // Formül gibi başlayan metin ("=…", "+…", "@…") Excel'de çalışmasın diye başına ' eklenir; sayılar ("-17,36") dokunulmaz.
  const hucre = (v) => {
    let t = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(t) && !/^-?\d+(,\d+)?$/.test(t)) t = `'${t}`;
    return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const satirlar = [
    [`${mekanAdi} stok farkı raporu`, `${tarihTr(r.baslangic)} – ${tarihTr(r.bitis)}`],
    ['Malzeme', 'Birim', 'Önceki sayım', 'Gelen', 'Kullanılan (satış)', 'Fire', 'Olması gereken', 'Sayılan',
      'Fark (miktar)', 'Fark (TL)', 'Durum'],
  ];
  const DURUM = { buyuk: 'Normalden yüksek fark', normal: 'Normal', fazla: 'Fazla çıktı' };
  for (const x of r.satirlar.filter((y) => y.durum === 'tamam')) {
    const b = BOLEN[x.birim];
    satirlar.push([x.ad, BUYUK_AD[x.birim], sayi(x.baslangic / b), sayi(x.gelen / b), sayi(x.satis / b), sayi(x.fire / b),
      sayi(x.beklenen / b), sayi(x.sayilan / b), sayi(x.fark / b), sayi(x.fark_tl, 2), DURUM[acikDurumu(x)]]);
  }
  satirlar.push([], ['Toplam eksik (TL)', sayi(Math.abs(Number(r.toplam_acik_tl) || 0), 2)], ['Toplam fazla (TL)', sayi(r.toplam_fazla_tl, 2)]);
  for (const u of r.uyarilar ?? []) satirlar.push(['Uyarı', u]);
  return `﻿${satirlar.map((s) => s.map(hucre).join(';')).join('\r\n')}\r\n`;
}

// ---------- Durum kuralları (Özet / Stok / Rapor) ----------
const gunArasi = (a, b) => Math.round((new Date(`${a}T12:00:00`) - new Date(`${b}T12:00:00`)) / 864e5);

// Sayım gecikti: son sayımdan bu yana geçen gün > sayım sıklığı + 2 gün.
export function sayimGecikti(sonSayim, bugun, siklik = 7) {
  if (!sonSayim) return false;
  return gunArasi(bugun, sonSayim) > Number(siklik) + 2;
}

// Ortanca
export function medyan(dizi) {
  const d = [...dizi].sort((x, y) => x - y);
  if (!d.length) return null;
  const o = Math.floor(d.length / 2);
  return d.length % 2 ? d[o] : (d[o - 1] + d[o]) / 2;
}

// Geçerli dönem: başlangıcı var ve dönemde kullanılan mal değeri bilinir (satış/fire girilmiş).
const gecerliDonem = (d) => Boolean(d?.baslangic) && Number(d.kullanilan_tl) > 0;

// Dönemin fark durumu. trend: yeni → eski (ilk eleman değerlendirilen dönem). esikYuzde: mekânın fark eşiği (%).
// sinirTl: haftalık fark sınırı (TL); dönem uzunluğuna göre ölçeklenir (14 günlük dönemde 2 katı).
// Sorun = (aşağıdaki kural) VEYA fark TL sınırını aştı. neden: 'tl' | 'normal' | 'oran' | null (hangisi aşıldı).
//  · Değerlendirilen dönemle AYNI uzunlukta (±1 gün) önceki geçerli dönem sayısı ≥ 4 → normal = son 8'inin medyanı;
//    fark medyanın 1,5 katını aşarsa sorun.
//  · Daha azsa → oran = fark ÷ kullanılan mal değeri; eşiği aşarsa sorun. Normal seviye gösterilmez.
//  · Kullanılan mal değeri yoksa (satış girilmemiş) oran hesaplanamaz: oran kuralı sorun demez (TL sınırı yine geçerli).
export function farkDurumu(trend, esikYuzde = 5, sinirTl = 500) {
  const d = trend?.[0];
  if (!d) return null;
  const fark = Math.abs(Number(d.acik_tl) || 0);
  const gun = Number(d.gun);
  const tlSiniri = Number(sinirTl) > 0 ? Math.round(Number(sinirTl) * (gun > 0 ? Math.max(1, gun / 7) : 1)) : null;
  const tlAsildi = tlSiniri != null && fark > tlSiniri;
  const onceki = trend.slice(1).filter((x) => gecerliDonem(x) && (!Number.isFinite(gun) || Math.abs(Number(x.gun) - gun) <= 1));
  if (gecerliDonem(d) && onceki.length >= 4) {
    const normal = medyan(onceki.slice(0, 8).map((x) => Math.abs(Number(x.acik_tl) || 0)));
    const normalAsildi = fark > normal * 1.5;
    return { mod: 'normal', fark, normal, oran: fark / Number(d.kullanilan_tl), tlSiniri, haftalikSinir: Number(sinirTl),
      sorun: normalAsildi || tlAsildi, neden: tlAsildi ? 'tl' : normalAsildi ? 'normal' : null };
  }
  const oran = gecerliDonem(d) ? fark / Number(d.kullanilan_tl) : null;
  const oranAsildi = oran != null && oran * 100 > Number(esikYuzde);
  return { mod: 'oran', fark, normal: null, oran, tlSiniri, haftalikSinir: Number(sinirTl),
    sorun: oranAsildi || tlAsildi, neden: tlAsildi ? 'tl' : oranAsildi ? 'oran' : null };
}

// Gün tahmini yalnız satış raporu son 3 gün içinde yüklendiyse (yoksa kullanım bilinmez, tahmin dayanaksız).
export function gunTahminiVar(sonSatisYukleme, bugun) {
  if (!sonSatisYukleme) return false;
  return gunArasi(bugun, String(sonSatisYukleme).slice(0, 10)) <= 3;
}
