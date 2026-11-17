// Uygulamanın CANLI fatura okuyucusunu (Edge Function fatura-oku, gpt-4.1-mini) fatura-test puanlayıcısına bağlar.
// Kullanım (command_reader.py çağırır): node fatura-test/readers/uygulama_okuyucu.mjs <foto-yolu>
// Ortam: ETIKET (görüntüler fatura-belgeleri/_test/<ETIKET>/ altına canli_test.sh ile yüklenmiş olmalı), MODEL (varsayılan gpt-4.1-mini),
//        HAM=1 → eşleme yapmadan işlevin ham sonucunu basar.
// Akış, scripts/okuma-testi.sh ile aynı güvenli test yolunu kullanır (okuma_testleri → pg_net → fatura-oku; mekan sınırından
// düşmez, kimsenin verisine yazmaz). Her çağrı 1 okuma = ≈ $0,003.
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aiSonucunuCevir } from '../../okuma.js';
import { aiIleSiniflandir } from '../../eslestirme.js';

const KOK = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REF = 'urklrolemeacguleadwa';
const ETIKET = process.env.ETIKET;
const MODEL = process.env.MODEL || 'gpt-4.1-mini';
if (!ETIKET) { console.error('ETIKET yok (canli_test.sh ile çalıştır)'); process.exit(2); }
const dosya = basename(process.argv[2]);
const GECICI = mkdtempSync(join(tmpdir(), 'okuyucu-'));
const BEK = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Test mekânının takip ettiği malzemeler: belgelerdeki stok ürünlerini kapsayan genel bir liste (id, ad, birim).
// NOT: Bu liste testi kolaylaştırmak için belgelere göre seçildi; "stok/gider" ayrımı yalnız bu listeye göre ölçülür.
const MALZEMELER = [
  ['sut', 'Süt', 'ml'], ['dondurma', 'Dondurma', 'ml'], ['surup', 'Şurup', 'ml'], ['su', 'Su', 'adet'],
  ['peynir', 'Dilimli peynir', 'adet'], ['jambon', 'Jambon', 'adet'], ['hindi', 'Hindi füme', 'adet'],
  ['limon_file', 'Limon fileto', 'g'], ['yesillik', 'Yeşillik', 'adet'], ['zeytin', 'Zeytin', 'adet'], ['tuz', 'Tuz', 'adet'],
  ['meyve', 'Meyve', 'g'],
].map(([id, ad, birim]) => ({ id, ad, birim, aktif: true }));

function sorgu(sql) {
  const f = join(GECICI, `${Math.random().toString(36).slice(2)}.sql`);
  writeFileSync(f, sql);
  const cikti = execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['supabase', 'db', 'query', '--linked', '--project-ref', REF, '-f', f, '-o', 'json'],
    { cwd: KOK, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  const j = cikti.slice(cikti.indexOf('{'), cikti.lastIndexOf('}') + 1);
  return JSON.parse(j).rows ?? [];
}
const tirnak = (s) => `'${String(s).replace(/'/g, "''")}'`;

const [{ id }] = sorgu(`insert into public.okuma_testleri (etiket, dosya_yolu, model, malzemeler) values (${tirnak(ETIKET + '-' + Date.now())}, ${tirnak(`_test/${ETIKET}/${dosya}`)}, ${tirnak(MODEL)}, ${tirnak(JSON.stringify(MALZEMELER))}::jsonb) returning id`);
let satir = null;
for (let i = 0; i < 60; i++) {           // en çok ~3 dk
  BEK(3000);
  [satir] = sorgu(`select durum, sonuc, hata, ai_ms, toplam_ms, maliyet_usd, giris_token, cikis_token from public.okuma_testleri where id = ${tirnak(id)}`);
  if (satir && satir.durum !== 'bekliyor') break;
}
if (!satir || satir.durum !== 'tamam') { console.error(`okuma başarısız: ${satir?.durum} ${satir?.hata ?? ''}`); process.exit(3); }
if (process.env.HAM === '1') { console.log(JSON.stringify(satir, null, 1)); process.exit(0); }

// --- Uygulamanın kendi hattı: ham AI sonucu → okuma.js → eslestirme.js sınıflandırma ---
const ham = satir.sonuc;
const sonuc = aiSonucunuCevir(ham);
const ctx = { malzemeler: MALZEMELER, defter: [], tedarikciAnahtar: ham.vkn ?? '', tedarikciAdi: ham.tedarikci };
const kalemler = sonuc.satirlar.map((s) => {
  const karar = aiIleSiniflandir(s, ctx);
  const m = MALZEMELER.find((x) => x.id === karar.malzeme_id);
  const stok = ['eslesti', 'soru'].includes(karar.sinif);
  const carpan = Number(karar.carpan);
  const stokMiktar = stok && s.miktar != null && carpan > 0 ? (karar.miktarDuzelt ?? s.miktar) * carpan
    : stok && s.ai?.stok_miktari != null ? s.ai.stok_miktari : null;
  // Gösterim birimi: uygulama stoğu ml/g tutar; ürün adı büyük birimle yazılmışsa ("1L", "5.5L", "1kg") miktar L/kg olarak verilir.
  const buyuk = m && ['ml', 'g'].includes(m.birim) && /\d[\d.,]*\s*(l|lt|litre|kg)(?![a-zA-Z])/i.test(s.metin) && stokMiktar != null;
  const stokGosterim = buyuk ? stokMiktar / 1000 : stokMiktar;
  const belirsiz = karar.sinif === 'kurulum' || karar.sinif === 'belirsiz' || karar.say || karar.stokBirimi || s.miktar == null
    ? `uygulama bu satır için ${s.miktar == null ? 'miktar/kg sorar' : karar.sinif === 'kurulum' ? 'kuruluma düşer' : karar.say || karar.stokBirimi ? 'barista saydırır' : 'emin değil'}` : null;
  return {
    urun: s.metin, miktar: karar.miktarDuzelt ?? s.miktar, birim: s.birim === 'diger' ? null : s.birim,
    stok_miktar: stokGosterim, stok_birim: m ? (buyuk ? { ml: 'L', g: 'kg' }[m.birim] : { ml: 'ml', g: 'g', adet: 'adet' }[m.birim]) : null,
    tutar: s.tutar_dahil ?? s.tutar_belge ?? null,
    sinif: karar.sinif === 'takip_disi' ? 'gider' : 'stok',
    belirsiz, _karar: karar.sinif,
  };
});
console.log(JSON.stringify({
  tip: ham.belge_turu === 'diger' ? 'fis' : ham.belge_turu, tedarikci: ham.tedarikci, no: ham.fatura_no, tarih: ham.tarih,
  genel_toplam: sonuc.toplamlar.genel, kalemler,
  _olcum: { ai_ms: satir.ai_ms, toplam_ms: satir.toplam_ms, usd: Number(satir.maliyet_usd), token: [satir.giris_token, satir.cikis_token] },
}));
