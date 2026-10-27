// Yetki ve işletme izolasyonu (yerel; kabul.mjs'nin kurduğu iki TEST kafe üzerinde). Her deneme: beklenen = reddedilir
// ya da boş döner. Çıktı: cikti/izolasyon.json
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const BURA = dirname(fileURLToPath(import.meta.url));
const URL_ = process.env.KABUL_URL ?? 'http://localhost:8788';
const U = JSON.parse(readFileSync(join(BURA, 'cikti', 'uygulama.json'), 'utf8'));
const sifre = JSON.parse(readFileSync(join(BURA, '..', '..', '.local-work', 'kabul-hesaplar.json'), 'utf8'));
async function gir(eposta) {
  const sb = createClient(URL_, 'yerel', { auth: { persistSession: false, autoRefreshToken: false } });
  const r = await sb.auth.signInWithPassword({ email: eposta, password: sifre[eposta] });
  if (r.error) throw r.error;
  return { sb, uid: r.data.user.id };
}
const H = U.hesaplar;
const PA = await gir(H.A.patron.eposta), BA1 = await gir(H.A.b1.eposta), BA2 = await gir(H.A.b2.eposta);
const PB = await gir(H.B.patron.eposta), BB1 = await gir(H.B.b1.eposta);
const A = U.ids.A, sayimA = U.sayimIdleri.A;
const sonuc = [];
// sonuc kaydı: [senaryo, hesap, beklenen, gerçek, GEÇTİ/KALDI]
async function dene(ad, hesap, beklenen, fn) {
  let gercek, gecti;
  try {
    const r = await fn();
    const err = r?.error;
    if (err) { gercek = `reddedildi: ${err.message}`; gecti = beklenen === 'red' || beklenen === 'bos'; }
    else {
      const veri = r?.data;
      const bos = veri == null || (Array.isArray(veri) && veri.length === 0) || (Array.isArray(veri?.satirlar) && veri.satirlar.length === 0)
        || veri?.durum === 'sayim_yok';
      gercek = bos ? 'boş döndü' : `VERİ/İŞLEM DÖNDÜ: ${JSON.stringify(veri).slice(0, 160)}`;
      gecti = (beklenen === 'bos' || beklenen === 'red') ? bos : beklenen === 'izin' ? true : false;
    }
  } catch (e) { gercek = `reddedildi: ${e.message}`; gecti = beklenen !== 'izin'; }
  sonuc.push({ senaryo: ad, hesap, beklenen, gercek, durum: gecti ? 'GEÇTİ' : 'KALDI' });
}
// --- B kafe → A kafe verisi (okuma) ---
for (const [kim, x] of [['B patron', PB], ['B barista', BB1]]) {
  for (const t of ['girisler', 'giris_kalemleri', 'malzeme_hareketleri', 'belgeler', 'belge_satirlari', 'belge_dosyalari', 'urunler',
    'tarif_kalemleri', 'tarif_surumleri', 'satis_satirlari', 'satis_eslesmeleri', 'teslimat_farklari', 'islem_gecmisi', 'fiyat_gecmisi', 'uyeler']) {
    await dene(`A'nın ${t} tablosunu okuma`, kim, 'bos', () => x.sb.from(t).select('*').eq('mekan_id', A.mekan).limit(5));
  }
  await dene(`A'nın malzemelerini okuma`, kim, 'bos', () => x.sb.from('malzemeler').select('id, ad').eq('mekan_id', A.mekan));
  await dene(`A'nın mekan kaydını (davet kodu) okuma`, kim, 'bos', () => x.sb.from('mekanlar').select('id, ad, davet_kodu').eq('id', A.mekan));
}
// --- B patron → A kafe (değiştirme / RPC) ---
const aGiris = sayimA['21'];
await dene('A sayım raporunu stok_farki ile açma', 'B patron', 'bos', () => PB.sb.rpc('stok_farki', { p_sayim: aGiris }));
await dene('A girişini iptal etme', 'B patron', 'red', () => PB.sb.rpc('giris_iptal', { p_id: aGiris }));
await dene('A sayımını düzeltme', 'B patron', 'red', () => PB.sb.rpc('sayim_duzelt', { p_giris: aGiris, p_malzeme: A.malz.SUT, p_miktar: 1, p_not: 'x' }));
await dene('A sayımının tarihini değiştirme', 'B patron', 'red', () => PB.sb.rpc('sayim_tarihi', { p_giris: aGiris, p_tarih: '2026-10-01' }));
await dene('A faturasının teslim tarihini değiştirme', 'B patron', 'red', async () => {
  const { data } = await PA.sb.from('girisler').select('id').eq('tur', 'fatura').limit(1);
  return PB.sb.rpc('fatura_teslim_tarihi', { p_giris: data[0].id, p_tarih: '2026-10-01' });
});
await dene('A teslimat görevini kapatma', 'B patron', 'red', async () => {
  const { data } = await PA.sb.rpc('teslimat_gorevleri');
  return PB.sb.rpc('teslimat_farki_coz', { p_id: data[0].id, p_cozum: 'fark_yok' });
});
await dene('A ürününün reçetesini değiştirme', 'B patron', 'red', () => PB.sb.rpc('urun_kaydet', { p_id: A.urun['Latte Küçük'], p_ad: 'Latte Küçük', p_kalemler: [{ malzeme_id: A.malz.SUT, miktar: 1 }] }));
await dene('A malzemesini güncelleme', 'B patron', 'bos', () => PB.sb.from('malzemeler').update({ aktif: false }).eq('id', A.malz.ESP).select('id'));
await dene('A ürününü pasife alma', 'B patron', 'bos', () => PB.sb.from('urunler').update({ aktif: false }).eq('id', A.urun.Espresso).select('id'));
await dene('A mekanına malzeme ekleme (mekan_id zorlayarak)', 'B patron', 'red', async () => {
  const r = await PB.sb.from('malzemeler').insert({ ad: 'SIZINTI', birim: 'g', fiyat: 1, mekan_id: A.mekan }).select('id, mekan_id');
  if (!r.error && r.data?.[0]?.mekan_id !== A.mekan) return { data: [] };   // kendi mekanına yazıldıysa sızıntı yok
  return r;
});
await dene('A klasörüne dosya yükleme (depo)', 'B patron', 'red', () => PB.sb.storage.from('fatura-belgeleri').upload(`${A.mekan}/${randomUUID()}/x.xml`, new Blob(['<x/>'])));
await dene("A'nın üyesini çıkarma", 'B patron', 'red', () => PB.sb.rpc('uye_cikar', { p_user_id: BA2.uid }));
await dene("A kafeye mekan_id ile fire girme", 'B barista', 'red', async () => {
  const r = await BB1.sb.rpc('giris_kaydet_tek', { p_istek: randomUUID(), p_tur: 'fire', p_tarih: '2026-10-28', p_aciklama: 'x',
    p_kalemler: [{ malzeme_id: A.malz.SUT, miktar: 1 }] });
  return r;
});
// --- Barista → patron işleri (A) ---
await dene('Barista fiyatları okuma (malzeme_fiyatlari)', 'A barista', 'red', () => BA1.sb.rpc('malzeme_fiyatlari'));
await dene('Barista fiyat sütununu doğrudan okuma', 'A barista', 'red', () => BA1.sb.from('malzemeler').select('id, fiyat').limit(1));
await dene('Barista fiyat değiştirme', 'A barista', 'red', () => BA1.sb.from('malzemeler').update({ fiyat: 1 }).eq('id', A.malz.ESP).select('id'));
await dene('Barista malzeme ekleme', 'A barista', 'red', () => BA1.sb.from('malzemeler').insert({ ad: 'Barista ekledi', birim: 'g', fiyat: 1 }).select('id'));
await dene('Barista malzeme pasife alma', 'A barista', 'bos', () => BA1.sb.from('malzemeler').update({ aktif: false }).eq('id', A.malz.ESP).select('id'));
await dene('Barista reçete değiştirme', 'A barista', 'red', () => BA1.sb.rpc('urun_kaydet', { p_id: A.urun['Latte Küçük'], p_ad: 'Latte Küçük', p_kalemler: [{ malzeme_id: A.malz.SUT, miktar: 1 }] }));
await dene('Barista stok farkı raporu', 'A barista', 'red', () => BA1.sb.rpc('stok_farki', { p_sayim: null }));
await dene('Barista stok durumu (TL)', 'A barista', 'red', () => BA1.sb.rpc('stok_durumu'));
await dene('Barista kayıp trendi', 'A barista', 'red', () => BA1.sb.rpc('acik_trendi', { p_adet: 4 }));
await dene('Barista fiyat değişimleri', 'A barista', 'red', () => BA1.sb.rpc('fiyat_degisimleri'));
await dene('Barista satış raporu işleme', 'A barista', 'red', () => BA1.sb.rpc('satis_raporu_isle', { p_belge: randomUUID(), p_satirlar: [], p_eslesmeler: [] }));
await dene('Barista sayım düzeltme', 'A barista', 'red', () => BA1.sb.rpc('sayim_duzelt', { p_giris: aGiris, p_malzeme: A.malz.SUT, p_miktar: 1, p_not: 'x' }));
await dene('Barista başkasının (patronun) girişini iptal', 'A barista', 'red', async () => {
  const { data } = await PA.sb.from('girisler').select('id').eq('tur', 'satis').is('iptal_zamani', null).limit(1);
  return BA1.sb.rpc('giris_iptal', { p_id: data[0].id });
});
await dene('Barista kendi rolünü patron yapma', 'A barista', 'bos', () => BA1.sb.from('uyeler').update({ rol: 'patron' }).eq('user_id', BA1.uid).select('rol'));
await dene('Barista patronu çıkarma', 'A barista', 'red', () => BA1.sb.rpc('uye_cikar', { p_user_id: PA.uid }));
await dene('Barista davet kodunu yenileme', 'A barista', 'red', () => BA1.sb.rpc('davet_kodu_yenile'));
await dene('Barista kurulum kuyruğu', 'A barista', 'red', () => BA1.sb.rpc('kurulum_kuyrugu'));
await dene('Barista işlem geçmişini okuma', 'A barista', 'bos', () => BA1.sb.from('islem_gecmisi').select('*').limit(3));
await dene('Barista belge satır fiyatlarını okuma', 'A barista', 'bos', () => BA1.sb.from('belge_satirlari').select('metin, tutar_dahil').limit(3));
// --- İşletmeden çıkarılan barista ---
const cikar = await PA.sb.rpc('uye_cikar', { p_user_id: BA2.uid });
sonuc.push({ senaryo: 'Patron baristayı çıkarır', hesap: 'A patron', beklenen: 'izin', gercek: cikar.error ? `hata: ${cikar.error.message}` : 'çıkarıldı', durum: cikar.error ? 'KALDI' : 'GEÇTİ' });
await dene('Çıkarılan barista A girişlerini okuma', 'A barista2 (çıkarıldı)', 'bos', () => BA2.sb.from('girisler').select('id').limit(3));
await dene('Çıkarılan barista fire girme', 'A barista2 (çıkarıldı)', 'red', () => BA2.sb.rpc('giris_kaydet_tek', { p_istek: randomUUID(), p_tur: 'fire', p_tarih: '2026-10-28', p_aciklama: 'x', p_kalemler: [{ malzeme_id: A.malz.SUT, miktar: 1 }] }));
await dene('Çıkarılan barista eski davet koduyla tekrar katılma', 'A barista2 (çıkarıldı)', 'izin', async () => {
  const { data } = await PA.sb.from('mekanlar').select('davet_kodu').single();
  return BA2.sb.rpc('mekana_katil', { p_kod: data.davet_kodu, p_ad: 'Deniz TEST' });
});
// Davet kodu yenilenince eski kod çalışmamalı
await dene('Patron davet kodunu yeniler', 'A patron', 'izin', () => PA.sb.rpc('davet_kodu_yenile'));
writeFileSync(join(BURA, 'cikti', 'izolasyon.json'), JSON.stringify(sonuc, null, 1));
const kaldi = sonuc.filter((x) => x.durum === 'KALDI');
console.log(`izolasyon/yetki: ${sonuc.length} deneme · KALDI ${kaldi.length}`);
for (const k of kaldi) console.log(' ✗', k.hesap, '·', k.senaryo, '→', k.gercek);
