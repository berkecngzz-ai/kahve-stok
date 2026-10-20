// okuma_testleri satırlarını ekleyen SQL'i üretir. Malzeme listesi cevap anahtarındaki
// "Önce şu malzemeleri tanımla: **Süt (litre), Kahve çekirdeği (gram), …**" satırından okunur.
// Kullanım: node test/okuma-testi-hazirla.mjs <cevap_anahtari.md> <etiket> <model1,model2> <dosya1> [dosya2 …]
import { readFileSync } from 'node:fs';
import { anahtar } from '../eslestirme.js';

const [anahtarDosyasi, etiket, modeller, ...dosyalar] = process.argv.slice(2);
const md = readFileSync(anahtarDosyasi, 'utf8');
const satir = md.match(/malzemeleri tanımla:\s*\*\*(.+?)\*\*/i)?.[1];
if (!satir) { console.error('Cevap anahtarında malzeme listesi satırı bulunamadı.'); process.exit(1); }
const BIRIM = { litre: 'ml', lt: 'ml', l: 'ml', ml: 'ml', gram: 'g', gr: 'g', g: 'g', kg: 'g', kilogram: 'g', adet: 'adet' };
const malzemeler = satir.split(',').map((p) => {
  const m = p.trim().match(/^(.+?)\s*\(([^)]+)\)$/);
  if (!m) throw new Error(`Malzeme okunamadı: ${p}`);
  const birim = BIRIM[m[2].trim().toLowerCase()];
  if (!birim) throw new Error(`Birim tanınmadı: ${m[2]}`);
  return { id: anahtar(m[1]).replace(/ /g, '_'), ad: m[1].trim(), birim };
});
const tirnak = (s) => `'${String(s).replace(/'/g, "''")}'`;
const degerler = [];
for (const d of dosyalar) for (const model of modeller.split(',')) {
  degerler.push(`(${tirnak(etiket)}, ${tirnak(`_test/${etiket}/${d}`)}, ${tirnak(model.trim())}, ${tirnak(JSON.stringify(malzemeler))}::jsonb)`);
}
console.log(`insert into public.okuma_testleri (etiket, dosya_yolu, model, malzemeler) values\n${degerler.join(',\n')};`);
