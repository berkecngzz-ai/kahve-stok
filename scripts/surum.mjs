// Ön yüz sürüm etiketi. GitHub Pages dosyaları telefonda ~10 dakika önbellekte tutar (Cache-Control: max-age=600);
// yayından sonra telefon eski app.js'i ya da yeni app.js + eski modül karışımını çalıştırabilir. Bu betik ön yüz
// dosyalarının içeriğinden bir etiket üretir ve her yerel bağlantıya ?v=<etiket> ekler: içerik değişince adres değişir,
// önbellek devre dışı kalır. surum.json'a da yazar; uygulama açılışta onu önbelleksiz okuyup yeni sürüme geçer.
//
// Kullanım (her ön yüz değişikliğinden sonra, commit'ten önce):  node scripts/surum.mjs
// Denetim: node scripts/surum.mjs --kontrol (test/js/surum.test.mjs; npm test içinde)
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODULLER = ['app.js', 'satis-okuma.js', 'okuma.js', 'eslestirme.js', 'karekod.js', 'mal-kabul.js', 'patron-hesap.js',
  'okuma-testi.js', 'config.js'];
const DIGER = ['style.css', 'index.html', 'fonts/fonts.css'];
const oku = (d) => readFileSync(join(KOK, d), 'utf8');
// Etiketin kendisi hesaba girmesin (aynı içerik → aynı etiket)
const temiz = (t) => t.replace(/\r\n/g, '\n').replace(/\?v=[0-9a-f]{10}/g, '').replace(/const SURUM = '[0-9a-f]*';/, "const SURUM = '';");

const h = createHash('sha256');
for (const d of [...MODULLER, ...DIGER]) h.update(d).update(temiz(oku(d)));
const v = h.digest('hex').slice(0, 10);

// --kontrol (npm test çalıştırır): hiçbir dosya yazılmaz; etiket güncel değilse hata verir.
const KONTROL = process.argv.includes('--kontrol');
const eskimis = [];
const yaz = (d, t) => {
  if (t === oku(d)) return;
  if (KONTROL) eskimis.push(d); else writeFileSync(join(KOK, d), t);
};
const yerel = new RegExp(`(from\\s+'\\./(?:${MODULLER.map((m) => m.replace('.', '\\.')).join('|')}))(?:\\?v=[0-9a-f]{10})?'`, 'g');
for (const d of MODULLER) {
  let t = oku(d).replace(yerel, `$1?v=${v}'`);
  if (d === 'app.js') t = t.replace(/const SURUM = '[0-9a-f]*';/, `const SURUM = '${v}';`);
  yaz(d, t);
}
yaz('index.html', oku('index.html')
  .replace(/src="app\.js(?:\?v=[0-9a-f]{10})?"/, `src="app.js?v=${v}"`)
  .replace(/href="style\.css(?:\?v=[0-9a-f]{10})?"/, `href="style.css?v=${v}"`));
if (KONTROL) {
  if (JSON.parse(oku('surum.json')).v !== v) eskimis.push('surum.json');
  if (eskimis.length) {
    console.error(`Sürüm etiketi eski (${eskimis.join(', ')}): node scripts/surum.mjs çalıştır.`);
    process.exit(1);
  }
  console.log('sürüm güncel', v);
} else {
  writeFileSync(join(KOK, 'surum.json'), `${JSON.stringify({ v })}\n`);
  console.log('sürüm', v);
}
