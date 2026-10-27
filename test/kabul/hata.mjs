// Hatalı girdi, tekrar gönderim (çift tıklama / iki oturum), bozuk dosya. Yerel; A kafe hesaplarıyla. Çıktı: cikti/hata.json
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { readSalesFile } from '../../satis-okuma.js';
const BURA = dirname(fileURLToPath(import.meta.url));
const URL_ = process.env.KABUL_URL ?? 'http://localhost:8788';
const U = JSON.parse(readFileSync(join(BURA, 'cikti', 'uygulama.json'), 'utf8'));
const sifre = JSON.parse(readFileSync(join(BURA, '..', '..', '.local-work', 'kabul-hesaplar.json'), 'utf8'));
const gir = async (e) => { const sb = createClient(URL_, 'y', { auth: { persistSession: false } }); const r = await sb.auth.signInWithPassword({ email: e, password: sifre[e] }); return { sb, uid: r.data.user.id }; };
const P = await gir(U.hesaplar.A.patron.eposta), B = await gir(U.hesaplar.A.b1.eposta), B2oturum = await gir(U.hesaplar.A.b1.eposta);
const A = U.ids.A;
const sonuc = [];
const kaydet = (senaryo, beklenen, gercek, gecti) => sonuc.push({ senaryo, beklenen, gercek, durum: gecti ? 'GEÇTİ' : 'KALDI' });
const sayGir = async (filtre) => (await P.sb.from('girisler').select('id', { count: 'exact', head: true }).match(filtre)).count;
async function redBekle(senaryo, fn) {
  let r; try { r = await fn(); } catch (e) { r = { error: e }; }
  kaydet(senaryo, 'reddedilir', r.error ? `reddedildi: ${r.error.message}` : `KABUL EDİLDİ: ${JSON.stringify(r.data).slice(0, 100)}`, Boolean(r.error));
}
const fireK = (m) => [{ malzeme_id: A.malz.SUT, miktar: m }];
for (const [ad, m] of [['sıfır', 0], ['negatif', -5], ['aşırı büyük', 1e13], ['metin', 'abc'], ['boş', null]]) {
  await redBekle(`Fire miktarı ${ad}`, () => B.sb.rpc('giris_kaydet_tek', { p_istek: randomUUID(), p_tur: 'fire', p_tarih: '2026-10-28', p_aciklama: 'x', p_kalemler: fireK(m) }));
}
await redBekle('Sayım miktarı negatif', () => B.sb.rpc('giris_kaydet_tek', { p_istek: randomUUID(), p_tur: 'sayim', p_tarih: '2026-10-28', p_aciklama: null, p_kalemler: fireK(-1) }));
for (const [ad, t] of [['gelecek', '2026-11-05'], ['bir yıldan eski', '2025-01-01'], ['geçersiz', '2026-13-45']]) {
  await redBekle(`Fire tarihi ${ad}`, () => B.sb.rpc('giris_kaydet_tek', { p_istek: randomUUID(), p_tur: 'fire', p_tarih: t, p_aciklama: 'x', p_kalemler: fireK(10) }));
}
await redBekle('Boş fire (kalem yok)', () => B.sb.rpc('giris_kaydet_tek', { p_istek: randomUUID(), p_tur: 'fire', p_tarih: '2026-10-28', p_aciklama: 'x', p_kalemler: [] }));
await redBekle('Elle mal kabul miktar sıfır', () => B.sb.rpc('elle_mal_kabul', { p_istek: randomUUID(), p_aciklama: 'x', p_kalemler: fireK(0) }));
// --- Çift gönderim: aynı istek kimliği (çift tıklama) ve iki oturumdan eşzamanlı ---
{
  const istek = randomUUID(), once = await sayGir({ tur: 'fire' });
  const r = await Promise.all([B.sb, B.sb, B2oturum.sb, B2oturum.sb].map((sb) => sb.rpc('giris_kaydet_tek', { p_istek: istek, p_tur: 'fire', p_tarih: '2026-10-28', p_aciklama: 'çift', p_kalemler: fireK(100) })));
  const idler = new Set(r.map((x) => x.data)), sonra = await sayGir({ tur: 'fire' });
  kaydet('Aynı fire 4 kez (2 oturum, eşzamanlı)', 'tek kayıt', `${sonra - once} yeni kayıt, ${idler.size} farklı kimlik, hatalar: ${r.filter((x) => x.error).length}`, sonra - once === 1 && idler.size === 1);
}
{
  const istek = randomUUID();
  const r = await Promise.all([1, 2].map(() => B.sb.rpc('elle_mal_kabul', { p_istek: istek, p_aciklama: 'çift', p_kalemler: fireK(500) })));
  kaydet('Faturasız mal kabul çift tıklama', 'tek kayıt', `kimlikler: ${[...new Set(r.map((x) => x.data))].length}`, new Set(r.map((x) => x.data)).size === 1);
}
// --- Aynı satış raporu iki kez ---
{
  const dosya = join(BURA, 'cikti', 'pos', 'A-satis-2026-10-01.xlsx'), buf = readFileSync(dosya);
  const yol = `${A.mekan}/${randomUUID()}/rapor.xlsx`;
  await P.sb.storage.from('fatura-belgeleri').upload(yol, buf);
  const r = await P.sb.rpc('belge_kaydet', { p: { istek_id: randomUUID(), tur: 'satis_raporu', kaynak: 'dosya', dosyalar: [yol], dosya_ozeti: createHash('sha256').update(buf).digest('hex') } });
  kaydet('Aynı kasa dosyası ikinci kez', 'reddedilir (daha önce yüklenmiş)', r.error ? `reddedildi: ${r.error.message}` : 'KABUL EDİLDİ', Boolean(r.error));
  // Aynı satırlar başka bir dosya içinde (farklı dosya özeti) → satırlar mükerrer sayılır, stok değişmez
  const { data: ur } = await P.sb.from('urunler').select('id, ad, aktif');
  const oku = await readSalesFile({ name: 'x.xlsx', size: buf.length, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) }, ur, DOMParser, new Map());
  const yol2 = `${A.mekan}/${randomUUID()}/rapor.xlsx`, buf2 = Buffer.concat([buf, Buffer.from(' ')]);
  await P.sb.storage.from('fatura-belgeleri').upload(yol2, buf2);
  const b2 = await P.sb.rpc('belge_kaydet', { p: { istek_id: randomUUID(), tur: 'satis_raporu', kaynak: 'dosya', dosyalar: [yol2], dosya_ozeti: createHash('sha256').update(buf2).digest('hex') } });
  const s2 = await P.sb.rpc('satis_raporu_isle', { p_belge: b2.data.id, p_satirlar: oku.lines.filter((l) => l.urun_id), p_eslesmeler: [] });
  kaydet('Aynı satırlar farklı dosyada', 'eklenen 0, hepsi mükerrer', JSON.stringify(s2.data ?? s2.error?.message), s2.data?.eklenen === 0);
  const s3 = await P.sb.rpc('satis_raporu_isle', { p_belge: b2.data.id, p_satirlar: oku.lines.filter((l) => l.urun_id), p_eslesmeler: [] });
  kaydet('Aynı rapor belgesi ikinci kez işlenir', 'reddedilir ya da 0 eklenir', JSON.stringify(s3.data ?? s3.error?.message), Boolean(s3.error) || s3.data?.eklenen === 0);
}
// --- Bozuk dosyalar (cihazdaki okuyucu) ---
for (const [ad, icerik, isim] of [['Bozuk XLSX (zip değil)', Buffer.from('PK\x03\x04bozukbozuk'), 'r.xlsx'], ['Rastgele ikili CSV', Buffer.from([0, 255, 3, 7, 9, 200]), 'r.csv'],
  ['Başlıksız CSV', Buffer.from('a;b;c\n1;2;3\n'), 'r.csv'], ['Boş dosya', Buffer.alloc(0), 'r.csv']]) {
  try {
    const r = await readSalesFile({ name: isim, size: icerik.length, arrayBuffer: async () => icerik.buffer.slice(icerik.byteOffset, icerik.byteOffset + icerik.length) }, [], DOMParser, new Map());
    kaydet(ad, 'anlaşılır hata', `HATA VERMEDİ: ${JSON.stringify(r).slice(0, 80)}`, false);
  } catch (e) { kaydet(ad, 'anlaşılır hata', `hata: ${e.message}`, !/undefined|null|TypeError|cannot read/i.test(e.message)); }
}
// --- Depoda olmayan dosya / yarım işlem ---
await redBekle('Belge kaydı, dosya depoya yüklenmemiş', () => B.sb.rpc('belge_kaydet', { p: { istek_id: randomUUID(), tur: 'fatura', kaynak: 'ai', dosyalar: [`${A.mekan}/${randomUUID()}/1.jpg`],
  tarih: '2026-10-28', toplamlar: { genel: 10 }, satirlar: [{ metin: 'x', miktar: 1, birim: 'adet', tutar_dahil: 10, sinif: 'belirsiz' }] } }));
{
  const once = await sayGir({ tur: 'fatura' });
  await B.sb.storage.from('fatura-belgeleri').upload(`${A.mekan}/${randomUUID()}/1.jpg`, Buffer.from('yarım'));
  kaydet('Dosya yüklendi, belge kaydı hiç gelmedi (yarım işlem)', 'stok etkisi yok', `fatura girişi farkı: ${(await sayGir({ tur: 'fatura' })) - once}`, (await sayGir({ tur: 'fatura' })) === once);
}
await redBekle('Fatura satır miktarı negatif', async () => {
  const yol = `${A.mekan}/${randomUUID()}/1.xml`; await B.sb.storage.from('fatura-belgeleri').upload(yol, Buffer.from('<x/>'));
  const r = await B.sb.rpc('belge_kaydet', { p: { istek_id: randomUUID(), tur: 'fatura', kaynak: 'xml', dosyalar: [yol], tarih: '2026-10-28', toplamlar: { genel: -10 },
    satirlar: [{ metin: 'Espresso', miktar: -1, birim: 'adet', tutar_dahil: -10, sinif: 'eslesti', malzeme_id: A.malz.ESP, carpan: 1000, barista_onayi: true, gelen_miktar: -1, sayim: 'sayildi', teslimat: 'tam' }] } });
  return r;
});
writeFileSync(join(BURA, 'cikti', 'hata.json'), JSON.stringify(sonuc, null, 1));
console.log(`hata/eşzamanlılık: ${sonuc.length} deneme · KALDI ${sonuc.filter((x) => x.durum === 'KALDI').length}`);
for (const k of sonuc.filter((x) => x.durum === 'KALDI')) console.log(' ✗', k.senaryo, '→', k.gercek);
for (const k of sonuc.filter((x) => x.durum === 'GEÇTİ' && /bozuk|CSV|Boş dosya|mükerrer|ikinci/i.test(x.senaryo))) console.log(' ✓', k.senaryo, '→', k.gercek);
