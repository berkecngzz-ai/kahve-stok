// Kabul testi yürütücüsü (YEREL test sunucusu: node scripts/demo/sunucu.mjs --veri scripts/demo/bos-veri.sql).
// Uygulamanın kullandığı API'yi (supabase-js + RPC) ve ön yüz modüllerini (kasa raporu okuyucu) kullanır.
// Hesaplar /auth/v1/signup ile açılır (yalnız yerel). plan.json'daki 30 günü girer, senaryo ölçümlerini ve her sayımın
// uygulama raporunu cikti/uygulama.json'a yazar. Karşılaştırma: python test/kabul/karsilastir.py
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { readSalesFile } from '../../satis-okuma.js';

const BURA = dirname(fileURLToPath(import.meta.url));
const CIKTI = join(BURA, 'cikti');
const URL_ = process.env.KABUL_URL ?? 'http://localhost:8787';
const plan = JSON.parse(readFileSync(join(CIKTI, 'plan.json'), 'utf8'));
const GUN0 = new Date(`${plan.gun0}T12:00:00Z`);
const iso = (n) => new Date(GUN0.getTime() + n * 864e5).toISOString().slice(0, 10);
const sha = (b) => createHash('sha256').update(b).digest('hex');
const sonuc = { hesaplar: {}, senaryo: {}, raporlar: { A: {}, B: {} }, hatalar: [] };

// ---------- Hesaplar ----------
const HESAPLAR_DOSYA = join(BURA, '..', '..', '.local-work', 'kabul-hesaplar.json');
const kisiler = {
  A: { patron: ['test.patron.a@kabul.test', 'Ayşe TEST'], b1: ['test.barista.a1@kabul.test', 'Can TEST'], b2: ['test.barista.a2@kabul.test', 'Deniz TEST'] },
  B: { patron: ['test.patron.b@kabul.test', 'Burak TEST'], b1: ['test.barista.b1@kabul.test', 'Ece TEST'], b2: ['test.barista.b2@kabul.test', 'Fırat TEST'] },
};
const sifreler = existsSync(HESAPLAR_DOSYA) ? JSON.parse(readFileSync(HESAPLAR_DOSYA, 'utf8')) : {};
const oturum = {};
async function giris(kafe, rol) {
  const [eposta, ad] = kisiler[kafe][rol];
  const sb = createClient(URL_, 'yerel', { auth: { persistSession: false, autoRefreshToken: false } });
  sifreler[eposta] ??= `Tst-${randomBytes(6).toString('base64url')}`;
  let r = await sb.auth.signInWithPassword({ email: eposta, password: sifreler[eposta] });
  if (r.error) r = await sb.auth.signUp({ email: eposta, password: sifreler[eposta] });
  if (r.error) throw new Error(`${eposta}: ${r.error.message}`);
  oturum[`${kafe}.${rol}`] = { sb, ad, eposta, uid: r.data.user.id };
  return oturum[`${kafe}.${rol}`];
}
const rpc = async (k, ad, args) => {
  const { data, error } = await oturum[k].sb.rpc(ad, args);
  if (error) throw Object.assign(new Error(`${k} ${ad}: ${error.message}`), { pg: error });
  return data;
};
const tablo = (k, ad) => oturum[k].sb.from(ad);

// ---------- Kurulum ----------
const ids = { A: { malz: {}, urun: {} }, B: { malz: {}, urun: {} } };
for (const kafe of ['A', 'B']) {
  const P = `${kafe}.patron`;
  await giris(kafe, 'patron');
  await rpc(P, 'mekan_olustur', { p_mekan_ad: `TEST Kafe ${kafe} (kabul)`, p_ad: oturum[P].ad });
  const { data: mk } = await tablo(P, 'mekanlar').select('id, davet_kodu').single();
  ids[kafe].mekan = mk.id;
  for (const b of ['b1', 'b2']) { await giris(kafe, b); await rpc(`${kafe}.${b}`, 'mekana_katil', { p_kod: mk.davet_kodu, p_ad: oturum[`${kafe}.${b}`].ad }); }
  for (const [kod, ad, birim, fiyat] of plan.malz[kafe]) {
    const { data, error } = await tablo(P, 'malzemeler').insert({ ad, birim, fiyat }).select('id').single();
    if (error) throw error;
    ids[kafe].malz[kod] = data.id;
  }
  for (const [ad, u] of Object.entries(plan.urun[kafe])) {
    if (!u.recete) {   // menüde, reçetesi girilmemiş
      const { data, error } = await tablo(P, 'urunler').insert({ ad }).select('id').single();
      if (error) throw error;
      ids[kafe].urun[ad] = data.id; continue;
    }
    const kal = Object.entries(u.recete).map(([m, q]) => ({ malzeme_id: ids[kafe].malz[m], miktar: q }));
    ids[kafe].urun[ad] = await rpc(P, 'urun_kaydet', { p_id: null, p_ad: ad, p_kalemler: kal, p_gecerli: iso(0) });
  }
}
writeFileSync(HESAPLAR_DOSYA, JSON.stringify(sifreler, null, 1));
sonuc.hesaplar = Object.fromEntries(Object.entries(kisiler).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([r, [e, a]]) => [r, { eposta: e, ad: a }]))]));

// ---------- Yardımcılar ----------
const sayimIdleri = { A: {}, B: {} };
async function sayim(kafe, gun, kalemler, kim = 'b1') {
  const k = Object.entries(kalemler).map(([m, q]) => ({ malzeme_id: ids[kafe].malz[m], miktar: q }));
  const id = await rpc(`${kafe}.${kim}`, 'giris_kaydet_tek', { p_istek: randomUUID(), p_tur: 'sayim', p_tarih: iso(gun), p_aciklama: null, p_kalemler: k });
  sayimIdleri[kafe][gun] = id;
  return id;
}
async function rapor(kafe, gun) {
  const r = await rpc(`${kafe}.patron`, 'stok_farki', { p_sayim: sayimIdleri[kafe][gun] });
  return r;
}
const faturaGiris = {};   // no → giriş id
async function fatura(f, { duzelt = true } = {}) {
  const kafe = f.kafe, B = `${kafe}.${f.gun % 2 ? 'b1' : 'b2'}`, P = `${kafe}.patron`;
  const xml = readFileSync(join(CIKTI, 'efatura', f.dosya));
  const istek = randomUUID();
  const yol = `${ids[kafe].mekan}/${istek}/1.xml`;
  const up = await oturum[B].sb.storage.from('fatura-belgeleri').upload(yol, xml, { contentType: 'application/xml' });
  if (up.error) throw up.error;
  const satirlar = f.satirlar.map((s) => {
    const degil = s.karar === 'degil', farkli = s.karar === 'farkli';
    return { metin: s.metin, miktar: s.miktar, birim: s.birim, birim_fiyat: s.birim_fiyat, tutar_haric: null, kdv_orani: null,
      tutar_dahil: Math.round(s.miktar * s.birim_fiyat * 100) / 100,
      sinif: degil ? 'belirsiz' : 'eslesti', carpan_sayimdan: false,
      malzeme_id: degil ? null : ids[kafe].malz[s.malzeme], carpan: degil ? null : s.carpan, barista_onayi: !degil,
      aday_malzeme_id: degil ? ids[kafe].malz[s.malzeme] : null,
      gelen_miktar: degil ? null : (farkli ? s.gelen : s.miktar), sayim: degil ? null : 'sayildi',
      teslimat: degil ? null : (farkli && s.gelen !== s.miktar ? 'teslimat_farki' : 'tam'), okunan_miktar: null,
      barista_notu: farkli ? 'Sayınca farklı çıktı' : null };
  });
  const r = await rpc(B, 'belge_kaydet', { p: { istek_id: istek, tur: 'fatura', kaynak: 'xml', dosya_ozeti: sha(xml), ettn: null,
    fatura_no: f.no, tedarikci: f.tedarikci, tedarikci_vkn: f.vkn, tarih: iso(f.teslim ?? f.gun), toplamlar: { genel: f.genel },
    ayni_olabilir_onay: false, ai_okuma_id: null, dosyalar: [yol], okunan: { kaynak: 'xml', notlar: [] }, satirlar } });
  const { data: b } = await tablo(P, 'belgeler').select('id, giris_id, durum').eq('id', r.id).single();
  faturaGiris[f.no] = b.giris_id;
  if (b.durum !== 'tamam') sonuc.hatalar.push(`fatura ${f.no} durum ${b.durum}`);
  if (duzelt && b.giris_id) await rpc(P, 'fatura_teslim_tarihi', { p_giris: b.giris_id, p_tarih: iso(f.teslim ?? f.gun) });
  return { belge: r, giris: b.giris_id };
}
async function kasa(kafe, d) {
  const P = `${kafe}.patron`;
  const buf = readFileSync(join(CIKTI, 'pos', d.dosya));
  const { data: ur } = await tablo(P, 'urunler').select('id, ad, aktif');
  const { data: es } = await tablo(P, 'satis_eslesmeleri').select('ad_anahtar, urun_id');
  const hafiza = new Map((es ?? []).map((x) => [x.ad_anahtar, x.urun_id]));
  const r = await readSalesFile({ name: d.dosya, size: buf.length, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) },
    ur.filter((u) => u.aktif), DOMParser, hafiza);
  // Ekranın varsayılanı: öneri kabul; önerisiz (menüde yok) gönderilmez
  const secim = new Map(r.unmatched.filter((x) => x.suggestion).map((x) => [x.key, x.suggestion]));
  const satirlar = r.lines.map((l) => ({ ...l, urun_id: secim.has(l.ad_anahtar) ? secim.get(l.ad_anahtar) : l.urun_id })).filter((l) => l.urun_id);
  const istek = randomUUID(), ext = d.dosya.split('.').pop();
  const yol = `${ids[kafe].mekan}/${istek}/rapor.${ext}`;
  const up = await oturum[P].sb.storage.from('fatura-belgeleri').upload(yol, buf);
  if (up.error) throw up.error;
  const b = await rpc(P, 'belge_kaydet', { p: { istek_id: istek, tur: 'satis_raporu', kaynak: 'dosya', dosyalar: [yol], dosya_ozeti: sha(buf) } });
  const s = await rpc(P, 'satis_raporu_isle', { p_belge: b.id, p_satirlar: satirlar, p_eslesmeler: [...secim].map(([ad, urun_id]) => ({ ad, urun_id })) });
  return { dosya: d.dosya, okunan_satir: r.lines.length, gonderilen: satirlar.length, sayilar: r.counts,
    eslesmeyen: r.unmatched.map((x) => x.name), ...s };
}
async function fire(x) {
  const kafe = x.kafe, B = `${kafe}.${x.gun % 2 ? 'b2' : 'b1'}`;
  const k = x.kalem.malzeme ? { malzeme_id: ids[kafe].malz[x.kalem.malzeme], miktar: x.kalem.miktar } : { urun_id: ids[kafe].urun[x.kalem.urun], miktar: x.kalem.miktar };
  const id = await rpc(B, 'giris_kaydet_tek', { p_istek: randomUUID(), p_tur: 'fire', p_tarih: iso(x.gun), p_aciklama: x.neden, p_kalemler: [k] });
  if (x.iptal) await rpc(`${kafe}.patron`, 'giris_iptal', { p_id: id });
  return id;
}

// ---------- 30 gün ----------
const kasaSonuc = { A: [], B: [] };
for (const kafe of ['A', 'B']) await sayim(kafe, 0, plan.sayim[kafe]['0']);
for (let d = 1; d <= 30; d++) {
  for (const kafe of ['A', 'B']) {
    const K = kafe;
    for (const f of plan.faturalar.filter((x) => x.kafe === K && x.yukleme === d)) {
      if (f.no === 'TSG-021') {   // S6/S7: mal gün 21'de geldi, fatura gün 23'te yüklendi; önce düzeltmesiz rapor
        const r = await fatura(f, { duzelt: false });
        const once = await rapor('A', 21);
        const { data: g } = await tablo('A.patron', 'girisler').select('tarih').eq('id', r.giris).single();
        await rpc('A.patron', 'fatura_teslim_tarihi', { p_giris: r.giris, p_tarih: iso(21) });
        const sonra = await rapor('A', 21);
        const sut = (x) => x.satirlar.find((s) => s.ad === 'Süt (tam yağlı)');
        sonuc.senaryo.S6 = { varsayilan_tarih: g.tarih, once_fark: sut(once)?.fark, sonra_fark: sut(sonra)?.fark };
        continue;
      }
      if (f.no === 'TKD-2026-0126') {   // S8: kapanmış hafta (gün 28) sonrası geçmiş tarihli belge
        const once = await rapor('A', 28);
        await fatura(f);
        const sonra = await rapor('A', 28);
        sonuc.senaryo.S8 = { once_acik: once.toplam_acik_tl, sonra_acik: sonra.toplam_acik_tl,
          esp_once: once.satirlar.find((s) => s.ad === 'Espresso çekirdeği')?.fark, esp_sonra: sonra.satirlar.find((s) => s.ad === 'Espresso çekirdeği')?.fark };
        continue;
      }
      await fatura(f);
    }
    for (const e of plan.elle.filter((x) => x.kafe === K && x.gun === d)) {   // S2: eksik kalan faturasız geldi
      const id = await rpc(`${K}.b1`, 'elle_mal_kabul', { p_istek: randomUUID(), p_aciklama: e.aciklama,
        p_kalemler: e.kalemler.map(([m, q]) => ({ malzeme_id: ids[K].malz[m], miktar: q })) });
      await rpc(`${K}.patron`, 'fatura_teslim_tarihi', { p_giris: id, p_tarih: iso(e.gun) });
      const gorev = await rpc(`${K}.patron`, 'teslimat_gorevleri', {});
      const acik = gorev.find((x) => x.malzeme === 'Espresso çekirdeği');
      sonuc.senaryo.S2 = { gorev_vardi: Boolean(acik), gorev: acik ? { faturadaki: acik.faturadaki, gelen: acik.gelen, fark_tl: acik.fark_tl } : null };
      if (acik) await rpc(`${K}.patron`, 'teslimat_farki_coz', { p_id: acik.id, p_cozum: 'sonra_geldi', p_not: 'Gün 8 faturasız geldi' });
      sonuc.senaryo.S2.kapandi = !(await rpc(`${K}.patron`, 'teslimat_gorevleri', {})).some((x) => x.malzeme === 'Espresso çekirdeği');
    }
    for (const v of plan.recete_surum.filter((y) => y.kafe === K && y.gun === d)) {   // S11: reçete ay ortasında değişir
      const kal = Object.entries(v.recete).map(([m, q]) => ({ malzeme_id: ids[K].malz[m], miktar: q }));
      await rpc(`${K}.patron`, 'urun_kaydet', { p_id: ids[K].urun[v.urun], p_ad: v.urun, p_kalemler: kal, p_gecerli: iso(v.gun) });
    }
    for (const x of plan.fire.filter((y) => y.kafe === K && y.gun === d)) await fire(x);
    for (const p of plan.pos[K].filter((x) => x.yukleme === d)) kasaSonuc[K].push(await kasa(K, p));
    const s = plan.sayim[K][String(d)];
    if (s) {
      if (K === 'A' && d === 14) {   // S10: Kapak 800 yerine 1.800 yazıldı, patron düzeltir
        const yanlis = { ...s, KAP: s.KAP + 1000 };
        const id = await sayim(K, d, yanlis, 'b2');
        const once = (await rapor(K, d)).satirlar.find((x) => x.ad === 'Kapak');
        await rpc(`${K}.patron`, 'sayim_duzelt', { p_giris: id, p_malzeme: ids[K].malz.KAP, p_miktar: s.KAP, p_not: '1.800 yanlış, 800' });
        const sonra = (await rapor(K, d)).satirlar.find((x) => x.ad === 'Kapak');
        sonuc.senaryo.S10 = { once_fark: once.fark, sonra_fark: sonra.fark };
      } else await sayim(K, d, s, d % 14 ? 'b1' : 'b2');
    }
    if (K === 'A' && d === 25) {   // S16: badem sütü pasife alınır
      const { error } = await tablo('A.patron', 'malzemeler').update({ aktif: false }).eq('id', ids.A.malz.BAD).select('id');
      if (error) throw error;
    }
  }
}

// ---------- Raporlar ----------
for (const kafe of ['A', 'B']) {
  for (const g of Object.keys(sayimIdleri[kafe]).map(Number).filter((x) => x > 0)) {
    const r = await rapor(kafe, g);
    sonuc.raporlar[kafe][g] = { acik: r.toplam_acik_tl, fazla: r.toplam_fazla_tl, uyarilar: r.uyarilar,
      satirlar: Object.fromEntries(r.satirlar.filter((s) => s.durum === 'tamam').map((s) => [s.ad,
        { baslangic: r.baslangic, baslangic_tarih: s.baslangic_tarih, gelen: +s.gelen, satis: +s.satis, fire: +s.fire,
          beklenen: +s.beklenen, sayilan: +s.sayilan, fark: +s.fark, fark_tl: s.fark_tl == null ? null : +s.fark_tl }])) };
  }
  sonuc.raporlar[kafe].trend = await rpc(`${kafe}.patron`, 'acik_trendi', { p_adet: 8 });
  sonuc.raporlar[kafe].stok = await rpc(`${kafe}.patron`, 'stok_durumu', {});
  sonuc.raporlar[kafe].tarifsiz = await rpc(`${kafe}.patron`, 'tarifsiz_satislar', {});
  sonuc.raporlar[kafe].gorevler = await rpc(`${kafe}.patron`, 'teslimat_gorevleri', {});
  sonuc.raporlar[kafe].kontrol = await rpc(`${kafe}.patron`, 'gunluk_kontrol', {});
  sonuc.raporlar[kafe].kasa = kasaSonuc[kafe];
}
sonuc.ids = ids; sonuc.sayimIdleri = sayimIdleri;
writeFileSync(join(CIKTI, 'uygulama.json'), JSON.stringify(sonuc, null, 1));
console.log('tamam · hata:', sonuc.hatalar.length, sonuc.hatalar.slice(0, 5));
console.log('senaryo:', JSON.stringify(sonuc.senaryo));
