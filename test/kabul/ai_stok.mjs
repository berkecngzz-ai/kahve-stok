// CANLI: AI okumalarında asıl ölçü STOĞA GİRECEK miktar (s.ai.stok_miktari). Kaynak belgeyle karşılaştırılır. Stoğa dokunmaz.
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { SUPABASE_URL, SUPABASE_KEY } from '../../config.js';
import { aiSonucunuCevir } from '../../okuma.js';
import { aiIleSiniflandir } from '../../eslestirme.js';
const C = new URL('./cikti/belge/', import.meta.url);
const giris = JSON.parse(readFileSync(new URL('../../.local-work/ornek-kahve-giris.json', import.meta.url), 'utf8'));
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
const g = await sb.auth.signInWithPassword({ email: giris.barista.eposta, password: giris.barista.sifre });
if (g.error) throw g.error;
const { data: mz } = await sb.from('malzemeler').select('id, ad, birim, aktif');
const ctx = { malzemeler: mz, defter: [], tedarikciAnahtar: 'kabul-test', tedarikciAdi: 'TEST' };
const durl = (f) => `data:image/jpeg;base64,${readFileSync(new URL(f, C)).toString('base64')}`;
const GERCEK = { F1: [10000, 4000, 4200, 2000], F2: [36000, 12000, 2000] };
const DENEME = [['F1', ['F1.jpg']], ['F1', ['F1.jpg']], ['F1', ['F1-kucuk.jpg']], ['F1', ['F1-foto.jpg']], ['F1', ['F1-sayfa1.jpg', 'F1-sayfa2.jpg']],
  ['F2', ['F2.jpg']], ['F2', ['F2.jpg']], ['F2', ['F2-foto.jpg']], ['F2', ['F2-sayfa1.jpg', 'F2-sayfa2.jpg']]];
const sonuc = [];
for (const [ad, dosyalar] of DENEME) {
  const { data, error } = await sb.functions.invoke('fatura-oku', { body: { gorseller: dosyalar.map(durl) } });
  if (error) { console.log(ad, dosyalar[0], 'HATA', error.message); sonuc.push({ ad, hata: error.message }); continue; }
  const r = aiSonucunuCevir(data.sonuc);
  ctx.tedarikciAdi = r.tedarikci;
  // Uygulamanın kararı: stok = (düzeltilmiş miktar) × çarpan; say/stokBirimi → barista sayar; diğerleri stoğa girmez
  const satir = r.satirlar.map((x, i) => {
    const k = aiIleSiniflandir(x, ctx);
    const sayar = Boolean(k.say || k.stokBirimi || x.miktar == null);
    const stok = ['eslesti', 'soru'].includes(k.sinif) && !sayar ? (k.miktarDuzelt ?? x.miktar) * k.carpan : null;
    return { metin: x.metin, okunan: `${x.miktar} ${x.birim}`, ai_stok: x.ai?.stok_miktari, sinif: k.sinif, sayar, stok, gercek: GERCEK[ad][i] };
  });
  const yanlis = satir.filter((x) => x.stok != null && Math.abs(x.stok - x.gercek) > 0.01 * x.gercek);
  sonuc.push({ ad, dosyalar, satir, yanlis: yanlis.length });
  console.log(ad, dosyalar[0], satir.map((x) => `${x.okunan}→${x.sayar ? 'BARİSTA SAYAR' : x.stok ?? x.sinif}`).join(' | '), yanlis.length ? `✗ ${yanlis.length} YANLIŞ` : '✓');
}
writeFileSync(new URL('ai-stok.json', C), JSON.stringify(sonuc, null, 1));
await sb.auth.signOut();
