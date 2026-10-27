// Mükerrer fatura matrisi (yerel): aynı belgenin PDF metin okuması (metinCoz) ve canlı AI görsel okumaları (ai-canli.json)
// uygulamanın gönderdiği biçimde belge_kaydet'e verilir. Hem mükerreri kaçırma hem farklı faturayı yanlış engelleme aranır.
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { metinCoz } from '../../okuma.js';
const URL_ = process.env.KABUL_URL ?? 'http://localhost:8788';
const C = new URL('./cikti/', import.meta.url);
const U = JSON.parse(readFileSync(new URL('uygulama.json', C), 'utf8'));
const K = JSON.parse(readFileSync(new URL('belge/kaynak.json', C), 'utf8'));
const AI = JSON.parse(readFileSync(new URL('belge/ai-canli.json', C), 'utf8'));
const sifre = JSON.parse(readFileSync(new URL('../../.local-work/kabul-hesaplar.json', import.meta.url), 'utf8'));
const gir = async (e) => { const sb = createClient(URL_, 'y', { auth: { persistSession: false } }); await sb.auth.signInWithPassword({ email: e, password: sifre[e] }); return sb; };
const B = await gir(U.hesaplar.A.b1.eposta), P = await gir(U.hesaplar.A.patron.eposta);
const A = U.ids.A;
// Satır sırası → malzeme ve stok çarpanı (belge birimi başına)
const ESLE = { F1: [['ESP', 1000], ['FIL', 1000], ['KAR', 700], ['B12', 1000]], F2: [['SUT', 12000], ['LAK', 1000], ['CIK', 1000]] };
const pdf = Object.fromEntries(Object.entries(K).map(([ad, k]) => [ad, { ...metinCoz(k.metin), kaynak: 'pdf' }]));
const ai = (ad, tur) => ({ ...AI.find((x) => x.ad === ad && x.tur === tur).okunan, kaynak: 'ai' });
async function gonder(ad, okuma, { dosyaIcerik, tarih, onay = false, ted, no } = {}) {
  const icerik = Buffer.from(dosyaIcerik ?? `${ad}-${randomUUID()}`);
  const yol = `${A.mekan}/${randomUUID()}/1.${okuma.kaynak === 'pdf' ? 'pdf' : 'jpg'}`;
  await B.storage.from('fatura-belgeleri').upload(yol, icerik);
  const satirlar = (okuma.satirlar ?? []).map((s, i) => {
    const [m, c] = ESLE[ad][i] ?? [];
    const carpan = okuma.kaynak === 'ai' && s.ai?.stok_miktari ? s.ai.stok_miktari / s.miktar : c;
    return { metin: s.metin, miktar: s.miktar, birim: s.birim, birim_fiyat: s.birim_fiyat, tutar_haric: s.tutar_haric ?? null,
      kdv_orani: s.kdv_orani ?? null, tutar_dahil: s.tutar_dahil ?? null, sinif: 'eslesti', malzeme_id: A.malz[m], carpan,
      barista_onayi: true, gelen_miktar: s.miktar, sayim: 'sayildi', teslimat: 'tam' };
  });
  const { data, error } = await B.rpc('belge_kaydet', { p: { istek_id: randomUUID(), tur: 'fatura', kaynak: okuma.kaynak,
    dosya_ozeti: createHash('sha256').update(icerik).digest('hex'), ettn: null, fatura_no: no ?? okuma.fatura_no, tedarikci: ted ?? okuma.tedarikci,
    tedarikci_vkn: okuma.tedarikci_vkn ?? null, tarih: tarih ?? okuma.tarih, toplamlar: okuma.toplamlar, ayni_olabilir_onay: onay,
    dosyalar: [yol], okunan: { kaynak: okuma.kaynak }, satirlar } });
  return error ? { red: error.message } : { id: data.id, durum: data.durum };
}
const iptal = async (r) => { if (r?.id) await B.rpc('kaydi_geri_al', { p_tur: 'belge', p_id: r.id }); };
const sonuc = [];
const kaydet = (senaryo, beklenen, r, gecti) => { sonuc.push({ senaryo, beklenen, gercek: r.red ? `soruldu/reddedildi: ${r.red}` : `kaydedildi (${r.durum})`, durum: gecti ? 'GEÇTİ' : 'KALDI' }); };
const mukerrerMi = (r) => Boolean(r.red && /yüklenmiş/.test(r.red));
// 1) PDF → aynı belgenin fotoğrafları (temiz, küçük yeniden kaydedilmiş, eğik foto, iki sayfa)
for (const ad of ['F1', 'F2']) {
  const ilk = await gonder(ad, pdf[ad]);
  kaydet(`${ad} PDF ilk yükleme`, 'kaydedilir', ilk, Boolean(ilk.id));
  for (const tur of ['temiz', 'yeniden kaydedilmiş küçük', 'eğik + düşük kontrast foto', 'iki sayfa']) {
    if (!AI.some((x) => x.ad === ad && x.tur === tur)) continue;
    const r = await gonder(ad, ai(ad, tur));
    kaydet(`${ad} PDF ardından görsel (${tur})`, 'mükerrer olabilir sorusu', r, mukerrerMi(r));
    if (r.id) await iptal(r);
  }
  // Aynı dosya, farklı ad: dosya özeti aynı → kesin red
  const r2 = await gonder(ad, pdf[ad], { dosyaIcerik: `sabit-${ad}` }), r3 = await gonder(ad, pdf[ad], { dosyaIcerik: `sabit-${ad}` });
  kaydet(`${ad} aynı dosya farklı adla ikinci kez`, 'reddedilir', r3, Boolean(r3.red));
  await iptal(r2); await iptal(ilk);
}
// 2) Ters sıra: görsel → PDF
for (const ad of ['F1', 'F2']) {
  const ilk = await gonder(ad, ai(ad, 'temiz'));
  const r = await gonder(ad, pdf[ad]);
  kaydet(`${ad} görsel ardından PDF`, 'mükerrer olabilir sorusu', r, mukerrerMi(r));
  // Barista "Hayır, farklı fatura" derse kaydedilir (yanlış alarmda tıkanma yok)
  const r2 = await gonder(ad, pdf[ad], { onay: true });
  kaydet(`${ad} mükerrer sorusuna "farklı fatura" cevabı`, 'kaydedilir', r2, Boolean(r2.id));
  await iptal(r2); await iptal(r); await iptal(ilk);
}
// 3) Gerçekten farklı faturalar engellenmemeli
{
  const ilk = await gonder('F1', pdf.F1);
  const ertesiGun = await gonder('F1', { ...pdf.F1, fatura_no: 'TGD2026000000419' }, { tarih: '2026-10-22' });
  kaydet('Aynı tedarikçi, aynı tutarlar, ertesi gün yeni fatura', 'kaydedilir', ertesiGun, Boolean(ertesiGun.id));
  const farkli = { ...pdf.F1, fatura_no: 'TGD2026000000420', satirlar: pdf.F1.satirlar.map((s, i) => i === 0 ? { ...s, miktar: 9, tutar_haric: 9818.19 } : s),
    toplamlar: { ...pdf.F1.toplamlar, genel: Math.round((pdf.F1.toplamlar.genel - 1200) * 100) / 100 } };
  const ayniGun = await gonder('F1', farkli);
  kaydet('Aynı tedarikçi, aynı gün, farklı satır tutarları', 'kaydedilir', ayniGun, Boolean(ayniGun.id));
  const baskaTed = await gonder('F2', { ...pdf.F2, fatura_no: 'TGD2026000000418' }, { ted: 'TEST Başka Tedarikçi A.Ş.' });
  kaydet('Aynı fatura numarası, farklı tedarikçi (farklı içerik)', 'kaydedilir', baskaTed, Boolean(baskaTed.id));
  for (const r of [baskaTed, ayniGun, ertesiGun, ilk]) await iptal(r);
}
// 4) Numarası kesik/boş okunmuş, tedarikçisi boş PDF (eski hata) → doğru okunan görsel yine yakalanmalı
{
  const bozuk = { ...pdf.F2, fatura_no: 'TEST-OCR-20261028-00', tedarikci: null };
  const ilk = await gonder('F2', bozuk);
  const r = await gonder('F2', ai('F2', 'temiz'));
  kaydet('Kesik numaralı, tedarikçisiz PDF ardından doğru okunan görsel', 'mükerrer olabilir sorusu', r, mukerrerMi(r));
  await iptal(r); await iptal(ilk);
}
writeFileSync(new URL('mukerrer.json', C), JSON.stringify(sonuc, null, 1));
console.log(`mükerrer matrisi: ${sonuc.length} deneme · KALDI ${sonuc.filter((x) => x.durum === 'KALDI').length}`);
for (const k of sonuc) console.log(k.durum === 'GEÇTİ' ? ' ✓' : ' ✗', k.senaryo, '→', k.gercek.slice(0, 90));
