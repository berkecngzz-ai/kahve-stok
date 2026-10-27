// CANLI tek doğrulama: aynı faturanın PDF okuması → görsel okuması (Örnek Kahve TEST baristası). İlk kayıt hemen geri alınır.
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { SUPABASE_URL, SUPABASE_KEY } from '../../config.js';
import { metinCoz } from '../../okuma.js';
const C = new URL('./cikti/belge/', import.meta.url);
const K = JSON.parse(readFileSync(new URL('kaynak.json', C), 'utf8')), AI = JSON.parse(readFileSync(new URL('ai-canli.json', C), 'utf8'));
const giris = JSON.parse(readFileSync(new URL('../../.local-work/ornek-kahve-giris.json', import.meta.url), 'utf8'));
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
const g = await sb.auth.signInWithPassword({ email: giris.barista.eposta, password: giris.barista.sifre });
if (g.error) throw g.error;
const { data: mz } = await sb.from('malzemeler').select('id, ad, birim').eq('aktif', true);
const bul = (re) => mz.find((m) => re.test(m.ad))?.id;
const ESLE = [[bul(/süt/i), 12000], [bul(/süt|yulaf/i), 1000], [bul(/çikolata/i), 1000]];
const { data: uye } = await sb.from('uyeler').select('mekan_id').limit(1).single();
async function gonder(okuma, kaynak, dosya, ext) {
  const icerik = readFileSync(new URL(dosya, C));
  const yol = `${uye.mekan_id}/${randomUUID()}/1.${ext}`;
  const up = await sb.storage.from('fatura-belgeleri').upload(yol, icerik, { contentType: ext === 'pdf' ? 'application/pdf' : 'image/jpeg' });
  if (up.error) throw up.error;
  const satirlar = okuma.satirlar.map((s, i) => ({ metin: s.metin, miktar: s.miktar, birim: s.birim, birim_fiyat: s.birim_fiyat,
    tutar_haric: s.tutar_haric ?? null, kdv_orani: s.kdv_orani ?? null, tutar_dahil: s.tutar_dahil ?? null, sinif: 'eslesti',
    malzeme_id: ESLE[i][0], carpan: kaynak === 'ai' && s.ai?.stok_miktari ? s.ai.stok_miktari / s.miktar : ESLE[i][1],
    barista_onayi: true, gelen_miktar: s.miktar, sayim: 'sayildi', teslimat: 'tam' }));
  const { data, error } = await sb.rpc('belge_kaydet', { p: { istek_id: randomUUID(), tur: 'fatura', kaynak, dosya_ozeti: createHash('sha256').update(icerik).digest('hex'),
    fatura_no: okuma.fatura_no, tedarikci: okuma.tedarikci, tedarikci_vkn: okuma.tedarikci_vkn ?? null, tarih: okuma.tarih, toplamlar: okuma.toplamlar,
    ayni_olabilir_onay: false, dosyalar: [yol], okunan: { kaynak, not: 'kabul testi — kurgusal belge' }, satirlar } });
  return error ? { red: error.message } : { id: data.id, durum: data.durum };
}
const pdf = { ...metinCoz(K.F2.metin) };
const ai = AI.find((x) => x.ad === 'F2' && x.tur === 'temiz').okunan;
const ilk = await gonder(pdf, 'pdf', 'F2-tarama.pdf', 'pdf');
const ikinci = await gonder(ai, 'ai', 'F2-foto.jpg', 'jpg');
const geri = [];
for (const r of [ikinci, ilk]) if (r.id) geri.push((await sb.rpc('kaydi_geri_al', { p_tur: 'belge', p_id: r.id })).error?.message ?? 'geri alındı');
const sonuc = { pdf_okunan: { no: pdf.fatura_no, ted: pdf.tedarikci }, ilk, ikinci, geri, gecti: Boolean(ilk.id && ikinci.red && /yüklenmiş/.test(ikinci.red)) };
writeFileSync(new URL('mukerrer-canli.json', C), JSON.stringify(sonuc, null, 1));
console.log(JSON.stringify(sonuc));
await sb.auth.signOut();
