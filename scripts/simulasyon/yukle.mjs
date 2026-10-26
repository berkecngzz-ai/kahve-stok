// Örnek Kahve simülasyonunu CANLI sisteme, uygulamanın kendi akışlarıyla yükler (uret.py çıktısından).
//  - Faturalar: görsel → GERÇEK "fatura-oku" AI servisi → okuma.js aiSonucunuCevir → eslestirme.js aiIleSiniflandir →
//    barista kör sayımı (fiziksel gelen miktar) → mal-kabul.js teslimatKarari (tutmazsa 2. model okuması) → belge_kaydet.
//  - POS: satis-okuma.js readSalesFile → depo + belge_kaydet(satis_raporu) → satis_raporu_isle.
//  - Fire, sayım (barista), sayım düzeltme ve teslim tarihi (patron) RPC ile.
// Kaldığı yerden devam eder (cikti/yukleme-durum.json). Giriş bilgileri .local-work/ornek-kahve-giris.json (git'e girmez).
// Kullanım: node scripts/simulasyon/yukle.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { SUPABASE_URL, SUPABASE_KEY } from '../../config.js';
import { aiSonucunuCevir, dosyaOzeti, toplamKontrol } from '../../okuma.js';
import { aiIleSiniflandir, anahtar, benzerlik } from '../../eslestirme.js';
import { teslimatKarari, ayniMiktar, satirEsle } from '../../mal-kabul.js';
import { readSalesFile } from '../../satis-okuma.js';

const BURA = dirname(fileURLToPath(import.meta.url));
const KOK = resolve(BURA, '../..');
const CIKTI = join(BURA, 'cikti');
const ham = JSON.parse(readFileSync(join(CIKTI, 'ham-veri.json'), 'utf8'));
const giris = JSON.parse(readFileSync(join(KOK, '.local-work/ornek-kahve-giris.json'), 'utf8'));
const DURUM_YOL = join(CIKTI, 'yukleme-durum.json');
const durum = existsSync(DURUM_YOL) ? JSON.parse(readFileSync(DURUM_YOL, 'utf8')) : { bitti: {}, kayit: {} };
const kaydet = () => writeFileSync(DURUM_YOL, JSON.stringify(durum, null, 1));
const gun = (n) => { const d = new Date(`${ham.gun0}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const IKINCI_MODEL = 'gpt-4.1';
const STOK_SAYIM = { g: 1000, ml: 1000, adet: 1 };

async function oturum(k) {
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: true } });
  const { data, error } = await sb.auth.signInWithPassword({ email: giris[k].eposta, password: giris[k].sifre });
  if (error) throw new Error(`${k} girişi: ${error.message}`);
  return { sb, token: data.session.access_token };
}
const rpc = async (sb, ad, args) => {
  const { data, error } = await sb.rpc(ad, args);
  if (error) throw Object.assign(new Error(`${ad}: ${error.message}`), { detay: error });
  return data;
};
async function adim(ad, is) {
  if (durum.bitti[ad]) return durum.kayit[ad];
  const sonuc = await is();
  durum.bitti[ad] = true; durum.kayit[ad] = sonuc ?? null; kaydet();
  console.log('✓', ad, typeof sonuc === 'object' ? JSON.stringify(sonuc).slice(0, 160) : sonuc ?? '');
  return sonuc;
}
// Yönetici işlemi (yalnız AI günlük sınırı): Supabase CLI ile.
function yonetici(sql) {
  const dosya = join(KOK, '.local-work', `y-${Date.now()}.sql`);
  writeFileSync(dosya, sql);
  return execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['supabase', 'db', 'query', '--linked', '--project-ref',
    'urklrolemeacguleadwa', '-f', dosya], { cwd: KOK, encoding: 'utf8', shell: process.platform === 'win32' });
}

const P = await oturum('patron');
const B = await oturum('barista');

// ---------------- Kurulum: mekan, malzemeler, ürünler, açılış sayımı ----------------
const mekanId = await adim('mekan', async () => rpc(P.sb, 'mekan_olustur', { p_mekan_ad: 'Örnek Kahve', p_ad: giris.patron.ad }));
await adim('barista-katil', async () => {
  const { data } = await P.sb.from('mekanlar').select('davet_kodu').eq('id', mekanId).single();
  return rpc(B.sb, 'mekana_katil', { p_kod: data.davet_kodu, p_ad: giris.barista.ad });
});
await adim('ai-sinir', async () => { yonetici(`update public.mekanlar set ai_gunluk_sinir = 80 where id = '${mekanId}';`); return 80; });
await adim('malzemeler', async () => {
  for (const m of ham.malzemeler) {
    const { error } = await P.sb.from('malzemeler').insert({ ad: m.ad, birim: m.birim, fiyat: m.fiyat });
    if (error) throw error;
  }
  return ham.malzemeler.length;
});
const { data: mz } = await P.sb.from('malzemeler').select('id, ad, birim, aktif, fiyat');
const malzemeId = Object.fromEntries(ham.malzemeler.map((m) => [m.kod, mz.find((x) => x.ad === m.ad).id]));
await adim('urunler', async () => {
  let n = 0;
  for (const u of ham.menu) {
    if (u.recetesiz) continue;                    // gömülü: reçetesi girilmeyen ürün menüye eklenmez
    const r = u.ad === 'Latte' ? { ...u.recete, sut: 180 } : u.recete;
    await rpc(P.sb, 'urun_kaydet', { p_id: null, p_ad: u.ad, p_gecerli: gun(0),
      p_kalemler: Object.entries(r).map(([k, q]) => ({ malzeme_id: malzemeId[k], miktar: q })) });
    n++;
  }
  return n;
});
const { data: urunler } = await P.sb.from('urunler').select('id, ad, aktif');
await adim('recete-latte-v2', async () => {
  const v = ham.recete_surumleri[0];
  const id = urunler.find((u) => u.ad === v.urun).id;
  return rpc(P.sb, 'urun_kaydet', { p_id: id, p_ad: v.urun, p_gecerli: gun(v.gecerli_gun),
    p_kalemler: Object.entries(v.recete).map(([k, q]) => ({ malzeme_id: malzemeId[k], miktar: q })) });
});

// ---------------- Fatura: gerçek AI okuması + kör sayım ----------------
async function aiOku(dosya, model) {
  const b64 = readFileSync(join(CIKTI, 'gonderim', `${dosya}.jpg`)).toString('base64');
  const r = await fetch(`${SUPABASE_URL}/functions/v1/fatura-oku`, {
    method: 'POST', headers: { Authorization: `Bearer ${B.token}`, apikey: SUPABASE_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ gorseller: [`data:image/jpeg;base64,${b64}`], ...(model ? { model } : {}) }),
  });
  const govde = await r.json();
  if (!r.ok) throw new Error(`AI ${r.status}: ${govde.mesaj ?? govde.hata ?? JSON.stringify(govde)}`);
  return { sonuc: { ...aiSonucunuCevir(govde.sonuc), ai_okuma_id: govde.okuma_id, model: govde.model, maliyet_usd: govde.maliyet_usd },
           ham: govde.sonuc };
}
function gercekSatir(f, s, kullanilan) {
  // AI satırını faturanın gerçek satırına eşler (ad benzerliği; eşitse sıradaki kullanılmamış)
  let en = -1, puan = -1;
  f.satirlar.forEach((t, i) => {
    if (kullanilan.has(i)) return;
    const p = benzerlik(t.metin, s.metin);
    if (p > puan) { puan = p; en = i; }
  });
  if (en >= 0) kullanilan.add(en);
  return en >= 0 ? f.satirlar[en] : null;
}
async function faturaYukle(f, { dosyaAdi = f.id, ozetDosya = f.dosya } = {}) {
  const gunluk = { id: f.id, dosya: dosyaAdi, fatura_no: f.fatura_no };
  let oku = await aiOku(dosyaAdi);
  gunluk.ai1 = oku.ham;
  let sonuc = oku.sonuc;
  // Tutarsız okumada ikinci model (uygulama: okumayiDogrula)
  if (sonuc.toplamlar.genel != null && !toplamKontrol(sonuc).tutuyor) {
    const o2 = await aiOku(dosyaAdi, IKINCI_MODEL);
    gunluk.ai2 = o2.ham;
    if (o2.sonuc.toplamlar.genel == null || toplamKontrol(o2.sonuc).tutuyor) { sonuc = o2.sonuc; gunluk.kullanilan = 'ikinci'; }
    else sonuc.notlar.push('okuma_tutarsiz');
  }
  // Mükerrer kontrolü (uygulama: mukerrerMi)
  if (sonuc.fatura_no && sonuc.tedarikci_vkn) {
    const kayitli = await rpc(B.sb, 'belge_kayitli_mi', { p_ettn: null, p_no: sonuc.fatura_no, p_vkn: sonuc.tedarikci_vkn });
    if (kayitli?.var) { gunluk.sonuc = 'engellendi: belge_kayitli_mi'; gunluk.kayitli = kayitli; return gunluk; }
  }
  const { data: defter } = await B.sb.from('eslestirme_defteri').select('tedarikci_anahtar, metin_anahtar, birim, sonuc, malzeme_id, carpan, guncelleme');
  const ctx = { malzemeler: mz, defter: defter ?? [], tedarikciAnahtar: sonuc.tedarikci_vkn || anahtar(sonuc.tedarikci) || '', tedarikciAdi: sonuc.tedarikci };
  const kullanilan = new Set();
  gunluk.satirlar = [];
  let ikinci = gunluk.ai2 ? oku : null;
  for (const s of sonuc.satirlar) {
    s.karar = aiIleSiniflandir(s, ctx);
    const t = gercekSatir(f, s, kullanilan);
    const g = { metin: s.metin, ai_miktar: s.miktar, ai_birim: s.birim, ai_tutar: s.tutar_dahil ?? s.tutar_haric, sinif: s.karar.sinif,
                malzeme: mz.find((m) => m.id === (s.karar.malzeme_id ?? s.karar.aday_malzeme_id))?.ad ?? null, carpan: s.karar.carpan ?? null,
                gercek: t ? { metin: t.metin, miktar: t.miktar, carpan: t.carpan, malzeme: t.malzeme, tutar_dahil: t.tutar_dahil } : null };
    if (['eslesti', 'soru'].includes(s.karar.sinif)) {
      const dogruId = t ? malzemeId[t.malzeme] : null;
      if (s.karar.malzeme_id !== dogruId) {
        s.cevap = 'hayir'; s.karar = { sinif: 'belirsiz', aday_malzeme_id: s.karar.malzeme_id };     // "Bu ürün X değil"
        g.barista = 'bu ürün o değil';
      } else if (s.karar.stokBirimi) {
        const m = mz.find((x) => x.id === dogruId);
        const n = (t.gelen * t.carpan) / STOK_SAYIM[m.birim];
        Object.assign(s, { sayim: 'sayildi', gelen_miktar: n, cevap: 'evet', okunan_miktar: s.miktar, miktar: n, birim_fiyat: null, teslimat: 'tam' });
        s.karar = { ...s.karar, carpan: STOK_SAYIM[m.birim] };
        g.barista = `stok biriminde saydı: ${n}`;
      } else {
        const n = t.gelen;                                 // barista faturadaki birimle (koli / paket / adet / litre) sayar
        Object.assign(s, { sayim: 'sayildi', gelen_miktar: n, cevap: 'evet' });
        let k;
        if (s.miktar == null) k = { karar: 'okuma_hatasi' };
        else {
          let ikinciMiktar = null;
          if (!ayniMiktar(n, s.miktar)) {
            ikinci ??= await aiOku(dosyaAdi, IKINCI_MODEL).catch(() => null);
            gunluk.ai2 ??= ikinci?.ham;
            const i = ikinci ? satirEsle(s, ikinci.sonuc.satirlar) : -1;
            if (i >= 0) ikinciMiktar = ikinci.sonuc.satirlar[i].miktar;
          }
          k = teslimatKarari({ kaynak: 'ai', faturadaki: s.miktar, sayilan: n, ikinci: ikinciMiktar });
        }
        s.teslimat = k.karar;
        if (k.karar === 'okuma_hatasi') {
          s.okunan_miktar = s.miktar; s.miktar = n;
          s.birim_fiyat = s.tutar_haric != null && n > 0 ? Math.round((s.tutar_haric / n) * 10000) / 10000 : null;
        }
        g.barista = `saydı ${n} (${k.karar})`;
        if (Number(s.karar.carpan) * n !== t.gelen * t.carpan) g.carpan_hatasi = `${s.karar.carpan} × ${n} ≠ ${t.gelen * t.carpan}`;
      }
    }
    gunluk.satirlar.push(g);
  }
  // Belge dosyası (uygulama: depo yolu mekan/istek/1.ext) + kayıt
  const istek = randomUUID();
  const ext = ozetDosya.split('.').pop();
  const buf = readFileSync(join(CIKTI, 'faturalar', ozetDosya));
  const yol = `${mekanId}/${istek}/1.${ext === 'pdf' ? 'pdf' : 'jpg'}`;
  const up = await B.sb.storage.from('fatura-belgeleri').upload(yol, buf, { contentType: ext === 'pdf' ? 'application/pdf' : 'image/jpeg', upsert: false });
  if (up.error) throw up.error;
  const evet = (s) => ['eslesti', 'soru'].includes(s.karar.sinif) && s.cevap === 'evet';
  const satirlar = sonuc.satirlar.map((s) => ({
    metin: s.metin, miktar: s.miktar, birim: s.birim, birim_fiyat: s.birim_fiyat ?? null,
    tutar_haric: s.tutar_haric ?? null, kdv_orani: s.kdv_orani ?? null, tutar_dahil: s.tutar_dahil ?? null,
    sinif: evet(s) ? 'eslesti' : ['takip_disi', 'kurulum'].includes(s.karar.sinif) ? s.karar.sinif : 'belirsiz',
    carpan_sayimdan: evet(s) && s.karar.stokBirimi === true,
    malzeme_id: evet(s) ? s.karar.malzeme_id : null, carpan: evet(s) ? s.karar.carpan : null,
    barista_onayi: evet(s) && s.karar.sinif === 'soru', aday_malzeme_id: s.karar.aday_malzeme_id ?? null,
    gelen_miktar: evet(s) && s.sayim === 'sayildi' ? s.gelen_miktar : null,
    sayim: evet(s) ? s.sayim ?? null : null, teslimat: evet(s) ? s.teslimat ?? null : null,
    okunan_miktar: s.okunan_miktar ?? null, barista_notu: null,
  }));
  try {
    const r = await rpc(B.sb, 'belge_kaydet', { p: {
      istek_id: istek, tur: 'fatura', kaynak: 'ai', dosya_ozeti: await dosyaOzeti(new Blob([buf])),
      ettn: null, fatura_no: sonuc.fatura_no, tedarikci: sonuc.tedarikci, tedarikci_vkn: sonuc.tedarikci_vkn,
      tarih: sonuc.tarih, toplamlar: sonuc.toplamlar, ayni_olabilir_onay: false, ai_okuma_id: sonuc.ai_okuma_id ?? null,
      dosyalar: [yol], okunan: { kaynak: 'ai', guven: 1, notlar: sonuc.notlar, model: sonuc.model, maliyet_usd: sonuc.maliyet_usd,
        toplamlar: sonuc.toplamlar, satirlar: sonuc.satirlar.map(({ karar, ...x }) => x), simulasyon: f.id },
      satirlar } });
    Object.assign(gunluk, { sonuc: r.durum, belge_id: r.id, stoklanan: r.stoklanan, bekleyen: r.bekleyen, toplam_tutuyor: r.toplam_tutuyor,
      okunan_tarih: sonuc.tarih, okunan_no: sonuc.fatura_no, okunan_genel: sonuc.toplamlar.genel, notlar: sonuc.notlar });
  } catch (e) {
    gunluk.sonuc = `engellendi: ${e.message}`;
  }
  return gunluk;
}

// ---------------- POS raporu ----------------
async function posYukle(p) {
  const buf = readFileSync(join(CIKTI, 'pos', p.dosya));
  const { data: es } = await P.sb.from('satis_eslesmeleri').select('ad_anahtar, urun_id');
  const hafiza = new Map((es ?? []).map((x) => [x.ad_anahtar, x.urun_id]));
  const { data: ur } = await P.sb.from('urunler').select('id, ad, aktif');
  const r = await readSalesFile({ name: p.dosya, size: buf.length, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) },
    ur.filter((u) => u.aktif), DOMParser, hafiza);
  // Ekrandaki gibi: öneri onaylanır, menüde karşılığı olmayan "takip etmiyoruz" (null) olarak hatırlanır
  const secim = new Map(r.unmatched.map((x) => [x.key, x.suggestion ?? null]));
  const satirlar = r.lines.map((l) => ({ ...l, urun_id: secim.has(l.ad_anahtar) ? secim.get(l.ad_anahtar) : l.urun_id }));
  const istek = randomUUID();
  const ext = p.dosya.split('.').pop();
  const yol = `${mekanId}/${istek}/rapor.${ext}`;
  const up = await P.sb.storage.from('fatura-belgeleri').upload(yol, buf, { upsert: false,
    contentType: ext === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv' });
  if (up.error) throw up.error;
  const b = await rpc(P.sb, 'belge_kaydet', { p: { istek_id: istek, tur: 'satis_raporu', kaynak: 'dosya', dosyalar: [yol],
    dosya_ozeti: await dosyaOzeti(new Blob([buf])) } });
  const s = await rpc(P.sb, 'satis_raporu_isle', { p_belge: b.id, p_satirlar: satirlar,
    p_eslesmeler: [...secim].map(([ad, urun_id]) => ({ ad, urun_id })) });
  return { dosya: p.dosya, satir: satirlar.length, donem: r.period, sayilar: r.counts, takip_disi: r.unmatched.map((x) => x.name), ...s };
}

// ---------------- Günler ----------------
const sayimKalemleri = (kalemler) => Object.entries(kalemler).map(([k, q]) => ({ malzeme_id: malzemeId[k], miktar: q }));
await adim('sayim-0', async () => rpc(B.sb, 'giris_kaydet', { p_tur: 'sayim', p_tarih: gun(0), p_aciklama: null,
  p_kalemler: sayimKalemleri(ham.sayimlar.find((s) => s.gun === 0).kalemler) }));
for (let n = 1; n <= 30; n++) {
  for (const f of ham.faturalar.filter((x) => x.yukleme_gunu === n)) {
    const g = await adim(`fatura-${f.id}`, () => faturaYukle(f));
    if (f.teslim_gunu !== f.fatura_gunu) {
      await adim(`teslim-${f.id}`, async () => {
        const { data } = await P.sb.from('belgeler').select('giris_id').eq('id', g.belge_id).single();
        await rpc(P.sb, 'fatura_teslim_tarihi', { p_giris: data.giris_id, p_tarih: gun(f.teslim_gunu) });
        return { giris: data.giris_id, eski: g.okunan_tarih, yeni: gun(f.teslim_gunu) };
      });
    }
    if (f.id === ham.mukerrer_fatura) {
      await adim(`mukerrer-ayni-dosya-${f.id}`, () => faturaYukle(f, { dosyaAdi: f.id }));
      await adim(`mukerrer-yeni-cekim-${f.id}`, () => faturaYukle(f, { dosyaAdi: `${f.id}-tekrar-cekim`, ozetDosya: `${f.id}-tekrar-cekim.jpg` }));
    }
  }
  for (const [i, fr] of ham.fire.entries()) {
    if (fr.gun !== n) continue;
    await adim(`fire-${n}-${i}`, async () => rpc(B.sb, 'giris_kaydet', { p_tur: 'fire', p_tarih: gun(n), p_aciklama: fr.sebep,
      p_kalemler: [fr.malzeme ? { malzeme_id: malzemeId[fr.malzeme], miktar: fr.miktar }
                              : { urun_id: urunler.find((u) => u.ad === fr.urun).id, miktar: fr.miktar }] }));
  }
  for (const p of ham.pos_dosyalari.filter((x) => x.yukleme_gunu === n)) await adim(`pos-${p.dosya}`, () => posYukle(p));
  const s = ham.sayimlar.find((x) => x.gun === n);
  if (s) {
    const id = await adim(`sayim-${n}`, async () => rpc(B.sb, 'giris_kaydet', { p_tur: 'sayim', p_tarih: gun(n), p_aciklama: null,
      p_kalemler: sayimKalemleri(s.yazilan ? { ...s.kalemler, ...s.yazilan } : s.kalemler) }));
    if (s.duzeltme) durum.hatali_sayim_giris = id;
  }
  if (n === ham.gomulu.hatali_sayim.gun + 1) {
    await adim('sayim-duzeltme', async () => {
      const hs = ham.gomulu.hatali_sayim;
      const giris = durum.kayit[`sayim-${hs.gun}`];
      await rpc(P.sb, 'sayim_duzelt', { p_giris: giris, p_malzeme: malzemeId[hs.malzeme], p_miktar: hs.dogru,
        p_not: `${hs.dogru / 1000} L yerine ${hs.yazilan / 1000} L yazılmış` });
      return { giris, eski: hs.yazilan, yeni: hs.dogru };
    });
  }
}
console.log('Yükleme bitti.');
