// Okuma testi: cevap anahtarı (Markdown) ile okuma sonucunu satır satır karşılaştırır. Hiçbir şey kaydetmez.
//
// Cevap anahtarı biçimi (00_CEVAP_ANAHTARI.md):
//   ### 01_sut_efatura  (TEDARİKÇİ)
//   | Satır | Miktar | Tutar | Beklenen sonuç |
//   | Ak Çiftlik Tam Yağlı Süt 1L | 24 Adet | 924,00 | Süt 24 L |
//   Ara toplam **1.776,00**, KDV **17,76**, genel toplam **1.793,76 TL**

import { anahtar, kelimeler } from './eslestirme.js?v=b8a55f4b16';
import { trSayi } from './okuma.js?v=b8a55f4b16';

const BIRIM_CEVIR = { l: ['ml', 1000], lt: ['ml', 1000], litre: ['ml', 1000], ml: ['ml', 1],
  kg: ['g', 1000], g: ['g', 1], gr: ['g', 1], adet: ['adet', 1] };

// "Süt 24 L", "Kahve çekirdeği 3.000 g", "Takip dışı (…)", "Bardak 200 adet (…), yoksa takip dışı"
export function beklenenOku(metin) {
  const t = String(metin).trim();
  if (/^takip\s*dışı/i.test(t)) return { tur: 'takip_disi' };
  const m = t.match(/^(.+?)\s+([\d.,]+)\s*(l|lt|litre|ml|kg|g|gr|adet)(?![a-zçğıöşü])/i);
  if (!m) return { tur: 'bilinmiyor', metin: t };
  const [birim, kat] = BIRIM_CEVIR[m[3].toLowerCase()];
  return { tur: 'malzeme', malzeme: m[1].trim(), miktar: trSayi(m[2]) * kat, birim };
}

export function cevapAnahtariniOku(md) {
  const belgeler = {};
  let simdiki = null;
  for (const satir of String(md).split(/\r?\n/)) {
    const baslik = satir.match(/^###\s+([0-9A-Za-z_\-]+)/);
    if (baslik) { simdiki = { satirlar: [], genel: null }; belgeler[baslik[1]] = simdiki; continue; }
    if (!simdiki) continue;
    const genel = satir.match(/genel\s*toplam\s*\*\*([\d.,]+)/i);
    if (genel) simdiki.genel = trSayi(genel[1]);
    if (!satir.trim().startsWith('|')) continue;
    const h = satir.split('|').slice(1, -1).map((x) => x.trim());
    if (h.length < 4 || /^satır$/i.test(h[0]) || /^-+$/.test(h[0].replace(/[:\s]/g, ''))) continue;
    const mk = h[1].match(/([\d.,]+)\s*(\S+)?/);
    simdiki.satirlar.push({ metin: h[0], miktar: mk ? trSayi(mk[1]) : null, birim_yazisi: mk?.[2] ?? '',
                            tutar: trSayi(h[2]), beklenen: beklenenOku(h[3]), beklenen_yazi: h[3] });
  }
  return belgeler;
}

// Dosya adı → anahtardaki belge ("02_kahve_sirup_efatura.pdf" → "02_kahve_sirup_efatura")
export function anahtarBelgesi(belgeler, dosyaAdi) {
  const kok = dosyaAdi.replace(/\.[^.]+$/, '');
  return belgeler[kok] ?? Object.entries(belgeler).find(([k]) => kok.startsWith(k) || k.startsWith(kok.split('_').slice(0, 2).join('_')))?.[1] ?? null;
}

function metinBenzerligi(a, b) {
  const x = kelimeler(a), y = kelimeler(b);
  if (!x.length || !y.length) return anahtar(a) === anahtar(b) ? 1 : 0;
  const ortak = x.filter((k) => y.some((z) => z === k || (k.length >= 4 && (z.startsWith(k) || k.startsWith(z))))).length;
  return ortak / Math.max(x.length, y.length);
}

// sonuc: okuma sonucu (satirlar[].karar dolu). malzemeAdi: id → ad
export function karsilastir(beklenen, sonuc, malzemeAdi) {
  const kullanildi = new Set();
  const satirlar = beklenen.satirlar.map((b) => {
    let enIyi = -1, puan = 0;
    sonuc.satirlar.forEach((s, i) => {
      if (kullanildi.has(i)) return;
      const p = metinBenzerligi(b.metin, s.metin);
      if (p > puan) { puan = p; enIyi = i; }
    });
    if (enIyi < 0 || puan < 0.5) {
      return { beklenen: b, okunan: null, okuma: 'okunamadi', sonuc: 'okunamadi', aciklama: 'Satır okunamadı' };
    }
    kullanildi.add(enIyi);
    const s = sonuc.satirlar[enIyi];
    const tutarOkunan = s.tutar_belge ?? s.tutar_dahil ?? s.tutar_haric;
    const miktarDogru = b.miktar == null || Number(s.miktar) === b.miktar;
    const tutarDogru = b.tutar == null || (tutarOkunan != null && Math.abs(tutarOkunan - b.tutar) <= 0.011);
    const okuma = miktarDogru && tutarDogru ? 'dogru' : 'yanlis';
    const okumaNotu = okuma === 'dogru' ? '' : `okunan: ${s.miktar ?? '?'} / ${tutarOkunan ?? '?'}`;
    const k = s.karar ?? { sinif: 'belirsiz' };
    const evet = k.sinif === 'eslesti' || k.sinif === 'soru';
    let durum, aciklama;
    if (k.sinif === 'belirsiz') {
      durum = 'kuyruk'; aciklama = 'Kurulum kuyruğuna düştü';
    } else if (k.sinif === 'takip_disi') {
      durum = b.beklenen.tur === 'takip_disi' ? 'dogru' : 'yanlis';
      aciklama = durum === 'dogru' ? 'Takip dışı' : 'Yanlışlıkla takip dışı sayıldı';
    } else if (evet) {
      const ad = malzemeAdi.get(k.malzeme_id) ?? '?';
      const stok = Number(s.miktar) * k.carpan;
      if (b.beklenen.tur === 'takip_disi') { durum = 'yanlis'; aciklama = `${ad} ${stok} sayıldı (takip dışı olmalıydı)`; }
      else if (b.beklenen.tur === 'malzeme') {
        const adTutar = anahtar(ad) === anahtar(b.beklenen.malzeme);
        const miktarTutar = Math.abs(stok - b.beklenen.miktar) <= Math.max(0.5, b.beklenen.miktar * 0.005);
        durum = adTutar && miktarTutar ? 'dogru' : 'yanlis';
        aciklama = `${ad} ${stok} ${b.beklenen.birim}${k.sinif === 'soru' ? ' (baristaya sorulur)' : ' (otomatik)'}`
          + (durum === 'yanlis' ? ` — beklenen ${b.beklenen.malzeme} ${b.beklenen.miktar}` : '');
      } else { durum = 'bilinmiyor'; aciklama = `${ad} ${stok}`; }
    }
    return { beklenen: b, okunan: s, okuma, okumaNotu, sonuc: durum, aciklama };
  });
  const fazla = sonuc.satirlar.filter((_, i) => !kullanildi.has(i)).map((s) => s.metin);
  const say = (alan, deger) => satirlar.filter((x) => x[alan] === deger).length;
  return {
    satirlar, fazla,
    ozet: { satir: satirlar.length, okuma_dogru: say('okuma', 'dogru'), dogru: say('sonuc', 'dogru'),
            yanlis: say('sonuc', 'yanlis'), kuyruk: say('sonuc', 'kuyruk'), okunamadi: say('sonuc', 'okunamadi') },
    genel: { beklenen: beklenen.genel, okunan: sonuc.toplamlar?.genel ?? null,
             dogru: beklenen.genel == null || Math.abs((sonuc.toplamlar?.genel ?? -1) - beklenen.genel) <= 0.011 },
  };
}
