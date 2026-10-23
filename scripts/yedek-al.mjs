// Canlı veritabanının salt-okuma yedeği: her public tablo JSON, işlevler (.sql), RLS politikaları, tablo yetkileri, özet.
// Yalnız SELECT çalıştırır; hiçbir şey yazmaz. Gizli değerler (ic_ayarlar.okuma_testi_imza) yedeğe yazılmaz.
// Kullanım: node scripts/yedek-al.mjs <klasör>     (Supabase CLI girişi gerekir: npx supabase login)
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REF = 'urklrolemeacguleadwa';
const hedef = process.argv[2];
if (!hedef) { console.error('Kullanım: node scripts/yedek-al.mjs <klasör>'); process.exit(1); }
if (existsSync(hedef) && readdirSync(hedef).length) { console.error(`Klasör boş değil, üzerine yazılmaz: ${hedef}`); process.exit(1); }
mkdirSync(hedef, { recursive: true });

// Sorgu geçici dosyadan okutulur (-f): Windows'ta komut satırı tırnakları ve satır sonları güvenilmez.
const GECICI = mkdtempSync(join(tmpdir(), 'yedek-'));
let sira = 0;
function sorgu(sql) {
  const dosya = join(GECICI, `${++sira}.sql`);
  writeFileSync(dosya, sql);
  const cikti = execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['supabase', 'db', 'query', '--linked', '--project-ref', REF, '-f', dosya],
    { cwd: KOK, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  const json = JSON.parse(cikti.slice(cikti.indexOf('{')));
  return json.rows;
}
const yaz = (ad, veri) => writeFileSync(join(hedef, ad), typeof veri === 'string' ? veri : `${JSON.stringify(veri, null, 1)}\n`);

const tablolar = sorgu(`select tablename from pg_tables where schemaname = 'public' order by tablename`).map((r) => r.tablename);
const sayilar = {};
for (const t of tablolar) {
  if (!/^[a-z_][a-z0-9_]*$/.test(t)) throw new Error(`beklenmeyen tablo adı: ${t}`);
  let satirlar = sorgu(`select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]'::jsonb) as v from public."${t}" x`)[0].v;
  if (t === 'ic_ayarlar') satirlar = satirlar.map((r) => (/imza|gizli|secret|key/i.test(r.ad) ? { ...r, deger: '<gizli - yedeğe yazılmadı>' } : r));
  yaz(`${t}.json`, satirlar);
  sayilar[t] = satirlar.length;
  console.log(`✓ ${t}: ${satirlar.length}`);
}
const fonksiyonlar = sorgu(`select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as ad, pg_get_functiondef(p.oid) as tanim
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f' order by 1`);
yaz('_fonksiyonlar.sql', fonksiyonlar.map((f) => `-- ${f.ad}\n${f.tanim};\n`).join('\n'));
const politikalar = sorgu(`select tablename, policyname, cmd, roles::text as roles, qual, with_check from pg_policies where schemaname in ('public', 'storage') order by 1, 2`);
yaz('_politikalar.json', politikalar);
const yetkiler = sorgu(`select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as yetki from information_schema.role_table_grants
  where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role') group by 1, 2 order by 1, 2`);
yaz('_yetkiler.json', yetkiler);
yaz('_ozet.json', { zaman: new Date().toISOString(), satir_sayilari: sayilar, fonksiyon: fonksiyonlar.length, politika: politikalar.length, yetki: yetkiler.length });
console.log(`Yedek tamam: ${tablolar.length} tablo, ${fonksiyonlar.length} işlev, ${politikalar.length} politika → ${hedef}`);
