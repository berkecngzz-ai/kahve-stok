// CANLI yetki/izolasyon (YALNIZ OKUMA): Örnek Kahve TEST hesapları → Starbucks Marmaris (kullanıcının diğer
// test mekanı). Hiçbir yazma denemesi yoktur; yazma yetkileri yerel testte (izolasyon.mjs) denenir.
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { SUPABASE_URL, SUPABASE_KEY } from '../../config.js';
const giris = JSON.parse(readFileSync(new URL('../../.local-work/ornek-kahve-giris.json', import.meta.url), 'utf8'));
const HEDEF = { mekan: 'dd6e3b30-0735-4b83-a5a5-2abb8442655c', iptalSayim: '5a72fa6c-caf0-49d6-ad95-1dde5fe9fbd8',
  dosya: 'dd6e3b30-0735-4b83-a5a5-2abb8442655c/e05ce156-cfef-4370-8c54-bb753dcbdce9/rapor.xlsx' };
const yeni = () => createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const sonuc = [];
const kaydet = (senaryo, hesap, beklenen, gercek, gecti) => sonuc.push({ senaryo, hesap, beklenen, gercek, durum: gecti ? 'GEÇTİ' : 'KALDI' });
// Kimlik doğrulama
{
  const r = await yeni().auth.signInWithPassword({ email: giris.patron.eposta, password: 'yanlis-sifre-123' });
  kaydet('Yanlış şifreyle giriş', 'Örnek Kahve patron', 'red', r.error ? `red: ${r.error.message}` : 'GİRDİ', Boolean(r.error));
  const anon = yeni();
  for (const t of ['girisler', 'malzemeler', 'belgeler', 'uyeler', 'mekanlar']) {
    const q = await anon.from(t).select('id').limit(1);
    kaydet(`Oturumsuz (anon) ${t} okuma`, 'anon', 'boş/red', q.error ? `red: ${q.error.message}` : `${q.data.length} satır`, Boolean(q.error) || q.data.length === 0);
  }
  const d = await anon.storage.from('fatura-belgeleri').download(HEDEF.dosya);
  kaydet('Oturumsuz belge dosyası indirme', 'anon', 'red', d.error ? `red: ${d.error.message}` : 'İNDİRDİ', Boolean(d.error));
}
for (const rol of ['patron', 'barista']) {
  const sb = yeni();
  const g = await sb.auth.signInWithPassword({ email: giris[rol].eposta, password: giris[rol].sifre });
  if (g.error) throw g.error;
  const H = `Örnek Kahve ${rol}`;
  for (const t of ['girisler', 'giris_kalemleri', 'malzeme_hareketleri', 'belgeler', 'belge_satirlari', 'belge_dosyalari', 'urunler',
    'tarif_kalemleri', 'satis_satirlari', 'teslimat_farklari', 'islem_gecmisi', 'fiyat_gecmisi', 'uyeler']) {
    const q = await sb.from(t).select('*').eq('mekan_id', HEDEF.mekan).limit(3);
    kaydet(`Starbucks ${t} okuma`, H, 'boş', q.error ? `red: ${q.error.message}` : `${q.data.length} satır`, Boolean(q.error) || q.data.length === 0);
  }
  const m = await sb.from('mekanlar').select('id, davet_kodu').eq('id', HEDEF.mekan);
  kaydet('Starbucks davet kodunu okuma', H, 'boş', m.error ? `red: ${m.error.message}` : `${m.data.length} satır`, Boolean(m.error) || m.data.length === 0);
  const r = await sb.rpc('stok_farki', { p_sayim: HEDEF.iptalSayim });
  const bos = r.error || r.data?.durum === 'sayim_yok' || !(r.data?.satirlar ?? []).length || r.data?.sayim_id !== HEDEF.iptalSayim;
  kaydet('Starbucks sayım raporunu açma', H, 'boş/red', r.error ? `red: ${r.error.message}` : `kendi verisi döndü (sayım ${r.data?.sayim_id?.slice(0, 8) ?? '-'})`, bos);
  const d = await sb.storage.from('fatura-belgeleri').download(HEDEF.dosya);
  kaydet('Starbucks belge dosyasını indirme', H, 'red', d.error ? `red: ${d.error.message}` : `İNDİRDİ (${d.data?.size} bayt)`, Boolean(d.error));
  const u = await sb.storage.from('fatura-belgeleri').createSignedUrl(HEDEF.dosya, 60);
  kaydet('Starbucks belgesine imzalı bağlantı', H, 'red', u.error ? `red: ${u.error.message}` : 'BAĞLANTI ÜRETTİ', Boolean(u.error));
  const l = await sb.storage.from('fatura-belgeleri').list(HEDEF.mekan, { limit: 5 });
  kaydet('Starbucks klasörünü listeleme', H, 'boş/red', l.error ? `red: ${l.error.message}` : `${l.data.length} öğe`, Boolean(l.error) || l.data.length === 0);
  if (rol === 'barista') {
    const f = await sb.rpc('malzeme_fiyatlari');
    kaydet('Barista fiyat listesi', H, 'red', f.error ? `red: ${f.error.message}` : `${f.data?.length} fiyat`, Boolean(f.error));
  }
  // Çıkıştan sonra eski oturum anahtarı
  const jeton = (await sb.auth.getSession()).data.session.access_token;
  await sb.auth.signOut();
  const eski = createClient(SUPABASE_URL, SUPABASE_KEY, { global: { headers: { Authorization: `Bearer ${jeton}` } }, auth: { persistSession: false } });
  const q = await eski.from('girisler').select('id').limit(1);
  kaydet('Çıkış sonrası eski oturum anahtarıyla okuma', H, 'bilgi', q.error ? `red: ${q.error.message}` : `${q.data.length} satır (anahtar süresi dolana kadar geçerli)`, true);
}
writeFileSync(new URL('./cikti/canli-izolasyon.json', import.meta.url), JSON.stringify(sonuc, null, 1));
console.log(`canlı: ${sonuc.length} deneme · KALDI ${sonuc.filter((x) => x.durum === 'KALDI').length}`);
for (const k of sonuc) if (k.durum === 'KALDI' || /Çıkış/.test(k.senaryo)) console.log(k.durum === 'KALDI' ? ' ✗' : ' ℹ', k.hesap, '·', k.senaryo, '→', k.gercek);
