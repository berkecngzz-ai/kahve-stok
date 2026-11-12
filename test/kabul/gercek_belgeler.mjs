// GERÇEK BELGELERLE UÇTAN UCA (yerel sunucu): yeni test mekanı "Colombia Coffee TEST" kurulur; canlı AI'ın okuduğu
// 5 gerçek belge (cikti/gercek/sonuc-*.json, gpt-4.1-mini) uygulamanın akışıyla (okuma → eşleştirme → "Hepsi geldi" →
// belge_kaydet) kaydedilir; ardından irsaliyelerin faturaları gelir (mahsup). Stok belgedeki doğru değerlerle karşılaştırılır.
// Kullanım: önce yerel sunucu (node scripts/demo/sunucu.mjs --port 8788 --veri scripts/demo/bos-veri.sql), sonra
//           node test/kabul/gercek_belgeler.mjs   → cikti/gercek/uctan-uca.json
import { createClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { aiSonucunuCevir, toplamKontrol } from '../../okuma.js';
import { aiIleSiniflandir, anahtar } from '../../eslestirme.js';

const URL_ = process.env.KABUL_URL ?? 'http://localhost:8788';
const C = new URL('./cikti/gercek/', import.meta.url);
const SIFRE = process.env.KABUL_SIFRE ?? randomUUID();   // yalnız yerel test sunucusu (her çalıştırmada yeni)
const yeni = () => createClient(URL_, 'yerel', { auth: { persistSession: false } });
const ekip = process.env.EKIP ?? randomUUID().slice(0, 6);
async function hesap(eposta) {
  const sb = yeni();
  const k = await sb.auth.signUp({ email: eposta, password: SIFRE });
  if (k.error) throw k.error;
  const g = await sb.auth.signInWithPassword({ email: eposta, password: SIFRE });
  if (g.error) throw g.error;
  return sb;
}
const rpc = async (sb, ad, arg) => { const r = await sb.rpc(ad, arg); if (r.error) throw new Error(`${ad}: ${r.error.message}`); return r.data; };

// ---------- Mekan kurulumu ----------
const P = await hesap(`patron-${ekip}@colombia.test`);
await rpc(P, 'mekan_olustur', { p_mekan_ad: 'Colombia Coffee TEST', p_ad: 'Özgür' });
const { data: mekan } = await P.from('mekanlar').select('id, davet_kodu').single();
const MALZ = [['Süt', 'ml', 42], ['Dondurma', 'ml', 330], ['Badem şurubu', 'ml', 820], ['Kurabiye şurubu', 'ml', 820],
  ['Muz şurubu', 'ml', 820], ['Kaynak suyu 33 cl', 'adet', 9], ['Kaynak suyu 40 cl', 'adet', 10], ['Maden suyu', 'adet', 12],
  ['Espresso çekirdeği', 'g', 1100], ['Karton bardak', 'adet', 3]];
for (const [ad, birim, fiyat] of MALZ) {
  const r = await P.from('malzemeler').insert({ ad, birim, fiyat });
  if (r.error) throw r.error;
}
const { data: malzemeler } = await P.from('malzemeler').select('id, ad, birim, aktif');
const idBul = new Map(malzemeler.map((m) => [anahtar(m.ad).replace(/ /g, '_'), m.id]));   // okuma testindeki kimlikler
const adBul = new Map(malzemeler.map((m) => [m.id, m.ad]));
const B = await hesap(`barista-${ekip}@colombia.test`);
await rpc(B, 'mekana_katil', { p_kod: mekan.davet_kodu, p_ad: 'Deniz' });

// Açılış sayımı (dün, patron): hepsi 0 → stok = yalnız gelen mal
const dun = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date(Date.now() - 864e5));
await rpc(P, 'giris_kaydet_tek', { p_istek: randomUUID(), p_tur: 'sayim', p_tarih: dun, p_aciklama: null,
  p_kalemler: malzemeler.map((m) => ({ malzeme_id: m.id, miktar: 0 })) });

// ---------- Uygulamanın mal kabul akışı (app.js ile aynı kurallar) ----------
async function malKabul(sb, belgeAdi, ai) {
  const sonuc = aiSonucunuCevir(ai);
  if (sonuc.notlar.includes('fatura_degil')) return { belgeAdi, durum: 'FATURA DEĞİL DENDİ', notlar: sonuc.notlar };
  const ctx = { malzemeler, defter: (await sb.from('eslestirme_defteri').select('*')).data ?? [],
    tedarikciAnahtar: sonuc.tedarikci_vkn || anahtar(sonuc.tedarikci) || '', tedarikciAdi: sonuc.tedarikci };
  for (const s of sonuc.satirlar) {
    if (s.ai?.malzeme_id) s.ai = { ...s.ai, malzeme_id: idBul.get(s.ai.malzeme_id) ?? s.ai.malzeme_id };
    s.karar = aiIleSiniflandir(s, ctx);
    if (s.karar.miktarDuzelt || s.karar.birimDuzelt) {
      s.okunan_miktar = s.miktar; s.okunan_birim = s.birim;
      if (s.karar.miktarDuzelt) s.miktar = s.karar.miktarDuzelt;
      if (s.karar.birimDuzelt) s.birim = s.karar.birimDuzelt;
    }
  }
  const stokAdayi = (s) => ['eslesti', 'soru'].includes(s.karar.sinif);
  const sayilmali = (s) => s.miktar == null || s.karar.stokBirimi || s.karar.say || sonuc.notlar.includes('okuma_tutarsiz');
  const sayilacak = sonuc.satirlar.filter((s) => stokAdayi(s) && sayilmali(s)).map((s) => s.metin);
  // Barista: şüpheli kalem yok → "Hepsi geldi" (göz onayı). Toplam: irsaliyede sorulmaz.
  for (const s of sonuc.satirlar.filter(stokAdayi)) Object.assign(s, { sayim: 'sayildi', gelen_miktar: s.miktar, teslimat: 'tam', cevap: 'evet' });
  const toplamSoruldu = !sonuc.irsaliye && sonuc.toplamlar.genel == null;
  const kontrol = sonuc.irsaliye ? { tutuyor: true } : toplamKontrol(sonuc);
  const dosya = Buffer.from(`${belgeAdi}-${ekip}`);
  const yol = `${mekan.id}/${randomUUID()}/1.jpg`;
  const y = await sb.storage.from('fatura-belgeleri').upload(yol, dosya, { contentType: 'image/jpeg' });
  if (y.error) throw y.error;
  const satirlar = sonuc.satirlar.map((s) => {
    const evet = stokAdayi(s) && s.cevap === 'evet';
    return { metin: s.metin, miktar: s.miktar, birim: s.birim, birim_fiyat: s.birim_fiyat ?? null, tutar_haric: s.tutar_haric ?? null,
      kdv_orani: s.kdv_orani ?? null, tutar_dahil: s.tutar_dahil ?? null,
      sinif: evet ? 'eslesti' : ['takip_disi', 'kurulum'].includes(s.karar.sinif) ? s.karar.sinif : 'belirsiz',
      carpan_sayimdan: evet && s.karar.stokBirimi === true, malzeme_id: evet ? s.karar.malzeme_id : null, carpan: evet ? s.karar.carpan : null,
      barista_onayi: evet && s.karar.sinif === 'soru', aday_malzeme_id: s.karar.aday_malzeme_id ?? null,
      gelen_miktar: evet ? s.gelen_miktar : null, sayim: evet ? s.sayim : null, teslimat: evet ? s.teslimat : null,
      okunan_miktar: s.okunan_miktar ?? null, barista_notu: null };
  });
  const r = await sb.rpc('belge_kaydet', { p: { istek_id: randomUUID(), tur: 'fatura', kaynak: 'ai', dosya_ozeti: createHash('sha256').update(dosya).digest('hex'),
    ettn: null, fatura_no: sonuc.fatura_no, tedarikci: sonuc.tedarikci, tedarikci_vkn: sonuc.tedarikci_vkn, tarih: sonuc.tarih,
    toplamlar: sonuc.toplamlar, ayni_olabilir_onay: false, ...(sonuc.irsaliye ? { irsaliye: true } : {}),
    dosyalar: [yol], okunan: { kaynak: 'ai', notlar: sonuc.notlar }, satirlar } });
  return { belgeAdi, irsaliye: sonuc.irsaliye, toplam_tutuyor: kontrol.tutuyor, toplam_soruldu: toplamSoruldu, barista_sayar: sayilacak,
    kalemler: sonuc.satirlar.filter(stokAdayi).map((s) => `${adBul.get(s.karar.malzeme_id)} ${s.miktar}×${s.karar.carpan}`),
    takip_disi: sonuc.satirlar.filter((s) => !stokAdayi(s)).length, sunucu: r.error ? `HATA: ${r.error.message}` : r.data };
}

const dosya = readdirSync(C).filter((f) => f.startsWith('sonuc-')).sort().pop();
const okumalar = JSON.parse(readFileSync(new URL(dosya, C), 'utf8')).rows.filter((r) => r.model === 'gpt-4.1-mini');
const rapor = [];
for (const r of okumalar.sort((a, b) => a.dosya_yolu.localeCompare(b.dosya_yolu))) {
  rapor.push(await malKabul(B, r.dosya_yolu.split('/').pop(), r.sonuc));
}

// ---------- Sonradan gelen faturalar (irsaliyelerin fiyatı) ----------
const fat = (tedarikci, vkn, no, satirlar, kdv) => {
  const haric = satirlar.reduce((t, s) => t + s.tutar, 0);
  return { belge_turu: 'fatura', okunabilirlik: 'iyi', tedarikci, vkn, fatura_no: no, tarih: dun, tutarlar_kdv_dahil: false,
    genel_toplam: Math.round(haric * (1 + kdv / 100) * 100) / 100, kdv_haric_toplam: haric, kdv_toplam: Math.round(haric * kdv) / 100, indirim: 0,
    satirlar: satirlar.map((s) => ({ ...s, kdv_orani: kdv })) };
};
rapor.push(await malKabul(B, 'SÜTAŞ faturası (irsaliyenin fiyatı)', fat('SÜTAŞ SÜT ÜRÜNLERİ A.Ş.', '7880022136', 'SUT2026000123', [
  { metin: 'SÜT YARIM YAĞLI 1 L', miktar: 180, birim: 'adet', birim_fiyat: 38, tutar: 6840, eslesme: { karar: 'malzeme', malzeme_id: 'sut', stok_miktari: 180000, guven: 0.9 } }], 1)));
rapor.push(await malKabul(B, 'ERBAK ULUDAĞ faturası (Söylemezoğlu irsaliyesi)', fat('ERBAK ULUDAĞ PAZ.SAT.VE DAĞ.A.Ş.', '3380002041', 'ERB2026000456', [
  { metin: 'PRE.KAY.SUYU 33CL TYN 12TV', miktar: 10, birim: 'paket', birim_fiyat: 96, tutar: 960, eslesme: { karar: 'malzeme', malzeme_id: 'kaynak_suyu_33_cl', stok_miktari: 120, guven: 0.9 } },
  { metin: 'PRE.KAY.SUYU 40CL PET 12TV', miktar: 10, birim: 'paket', birim_fiyat: 108, tutar: 1080, eslesme: { karar: 'malzeme', malzeme_id: 'kaynak_suyu_40_cl', stok_miktari: 120, guven: 0.9 } },
  { metin: 'PRE.MADEN SUYU 25CL TYN 6BSX4', miktar: 5, birim: 'paket', birim_fiyat: 264, tutar: 1320, eslesme: { karar: 'malzeme', malzeme_id: 'maden_suyu', stok_miktari: 120, guven: 0.9 } }], 20)));

// ---------- Stok kontrolü ----------
const BEKLENEN = { 'Süt': 180000, 'Dondurma': 32000, 'Badem şurubu': 3000, 'Kurabiye şurubu': 1500, 'Muz şurubu': 1500,
  'Kaynak suyu 33 cl': 120, 'Kaynak suyu 40 cl': 120, 'Maden suyu': 120, 'Espresso çekirdeği': 0, 'Karton bardak': 0 };
const stok = await rpc(P, 'stok_durumu');
const satirlar = (stok.satirlar ?? stok.malzemeler ?? stok);
const stokBul = new Map((Array.isArray(satirlar) ? satirlar : []).map((x) => [x.ad ?? adBul.get(x.malzeme_id), Number(x.simdi)]));
const karsi = Object.entries(BEKLENEN).map(([ad, b]) => ({ ad, beklenen: b, sistem: stokBul.get(ad) ?? null, durum: stokBul.get(ad) === b ? 'DOĞRU' : 'YANLIŞ' }));
const maliyet = { data: satirlar.map((x) => ({ ad: x.ad, fiyat: x.fiyat, gelen: x.gelen })) };
writeFileSync(new URL('uctan-uca.json', C), JSON.stringify({ okuma: dosya, rapor, stok: karsi, ham_stok: stok, fiyatlar: maliyet.data }, null, 1));
for (const r of rapor) {
  console.log(`\n■ ${r.belgeAdi}${r.irsaliye ? ' [İRSALİYE]' : ''} — toplam ${r.toplam_tutuyor ? 'tutuyor' : 'TUTMUYOR'}${r.toplam_soruldu ? ' · TOPLAM SORULDU' : ''}`
    + ` · barista sayar: ${r.barista_sayar?.length ? r.barista_sayar.join(', ') : 'yok'} · takip dışı ${r.takip_disi ?? '-'}`);
  console.log(`  ${r.kalemler?.join(' | ') ?? r.durum}`);
  console.log(`  sunucu: ${typeof r.sunucu === 'string' ? r.sunucu : JSON.stringify(r.sunucu)}`);
}
console.log('\nSTOK (sistem / belgeye göre doğru):');
for (const k of karsi) console.log(`  ${k.durum === 'DOĞRU' ? '✓' : '✗'} ${k.ad}: ${k.sistem} / ${k.beklenen}`);
console.log(`\n${karsi.filter((k) => k.durum === 'DOĞRU').length}/${karsi.length} doğru`);
console.log('\nFİYATLAR (kg / litre / adet, KDV dahil):');
for (const x of maliyet.data) console.log(`  ${x.ad}: ${x.fiyat} TL · gelen ${x.gelen}`);
