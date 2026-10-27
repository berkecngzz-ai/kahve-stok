// Görsel okuma (CANLI AI, fatura-oku): yalnız mevcut Örnek Kahve TEST baristasıyla; okuma stoğa dokunmaz.
// Uygulamanın kendi çeviricisi (aiSonucunuCevir) kullanılır; sonuç kaynak belgeyle karşılaştırılır.
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { SUPABASE_URL, SUPABASE_KEY } from '../../config.js';
import { aiSonucunuCevir } from '../../okuma.js';
const C = new URL('./cikti/belge/', import.meta.url);
const K = JSON.parse(readFileSync(new URL('kaynak.json', C), 'utf8'));
const giris = JSON.parse(readFileSync(new URL('../../.local-work/ornek-kahve-giris.json', import.meta.url), 'utf8'));
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
const r0 = await sb.auth.signInWithPassword({ email: giris.barista.eposta, password: giris.barista.sifre });
if (r0.error) throw r0.error;
const durl = (f) => `data:image/jpeg;base64,${readFileSync(new URL(f, C)).toString('base64')}`;
const DENEME = [['F1', 'temiz', ['F1.jpg']], ['F1', 'yeniden kaydedilmiş küçük', ['F1-kucuk.jpg']], ['F1', 'eğik + düşük kontrast foto', ['F1-foto.jpg']],
  ['F1', 'iki sayfa', ['F1-sayfa1.jpg', 'F1-sayfa2.jpg']], ['F2', 'temiz', ['F2.jpg']], ['F2', 'eğik + düşük kontrast foto', ['F2-foto.jpg']],
  ['F2', 'iki sayfa', ['F2-sayfa1.jpg', 'F2-sayfa2.jpg']]];
const sonuc = [];
for (const [ad, tur, dosyalar] of DENEME) {
  const t = Date.now();
  const { data, error } = await sb.functions.invoke('fatura-oku', { body: { gorseller: dosyalar.map(durl) } });
  if (error) { let g = null; try { g = await error.context?.json?.(); } catch {} sonuc.push({ ad, tur, hata: g?.mesaj ?? error.message }); console.log(ad, tur, 'HATA', g?.mesaj ?? error.message); continue; }
  const r = aiSonucunuCevir(data.sonuc), k = K[ad], fark = [];
  const esit = (a, b, alan) => { if (String(a) !== String(b)) fark.push(`${alan}: belge ${b} / okunan ${a}`); };
  esit(r.fatura_no, k.fatura_no, 'no'); esit(r.tedarikci, k.tedarikci, 'tedarikçi'); esit(r.tarih, k.tarih, 'tarih');
  esit(r.toplamlar.genel, k.genel, 'genel'); esit(r.satirlar.length, k.satirlar.length, 'satır sayısı');
  k.satirlar.forEach((s, i) => {
    const o = r.satirlar[i] ?? {};
    esit(o.miktar, s.miktar, `s${i + 1} miktar`);
    const tut = o.tutar_haric ?? (o.tutar_dahil != null && o.kdv_orani != null ? Math.round(o.tutar_dahil / (1 + o.kdv_orani / 100) * 100) / 100 : o.tutar_dahil);
    if (Math.abs((tut ?? 0) - s.tutar) > 0.02) fark.push(`s${i + 1} tutar: belge ${s.tutar} / okunan ${tut}`);
  });
  sonuc.push({ ad, tur, sure_ms: Date.now() - t, model: data.model, maliyet_usd: data.maliyet_usd, fark,
    okunan: { no: r.fatura_no, ted: r.tedarikci, tarih: r.tarih, toplamlar: r.toplamlar, satirlar: r.satirlar } });
  console.log(ad, tur, fark.length ? `✗ ${fark.join(' · ')}` : '✓ birebir', `(${data.model}, $${data.maliyet_usd})`);
}
writeFileSync(new URL('ai-canli.json', C), JSON.stringify(sonuc, null, 1));
await sb.auth.signOut();
