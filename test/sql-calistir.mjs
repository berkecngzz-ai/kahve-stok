// SQL testlerini bilgisayarda Postgres kurmadan çalıştırır (PGlite = tarayıcı/Node içinde gerçek Postgres).
// psql'in testlerde kullanılan özelliklerini taklit eder: \set, sorgu sonunda \gset, :'değişken' ve :değişken.
// Kullanım: node test/sql-calistir.mjs dosya1.sql dosya2.sql …   (hepsi aynı veritabanında sırayla)
//           node test/sql-calistir.mjs --hepsi                      (README'deki zincir + yeni testler)
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const KOK = join(dirname(fileURLToPath(import.meta.url)), '..');

// README'deki yerel test sırası + bu düzeltmelerin testleri.
export const ZINCIR = [
  'test/supabase_taklit.sql', 'sql/01_giris_mekan.sql', 'sql/02_malzeme_tarif.sql', 'test/izolasyon_test.sql',
  'test/malzeme_tarif_test.sql', 'sql/03_girisler.sql', 'test/girisler_test.sql',
  'sql/04_fatura_belge_kdv.sql', 'test/fatura_kdv_test.sql', 'sql/05_belge_okuma_kurulum.sql', 'test/belge_kurulum_test.sql',
  'sql/06_ai_okuma.sql', 'test/ai_okuma_test.sql', 'sql/09_olagandisi_miktar.sql', 'sql/10_sifir_fiyat.sql',
  'sql/11_acik_yetkiler.sql', 'sql/12_stok_duzeltmeleri.sql', 'test/stok_duzeltmeleri_test.sql',
  'sql/13_rapor_uyarilari.sql', 'test/iki_hafta_test.sql',
  'sql/14_fatura_patron_yetkisi.sql', 'test/fatura_patron_test.sql',
  'sql/15_satis_excel_dosya.sql', 'test/satis_excel_test.sql',
  'sql/20_patron_ekranlari.sql', 'test/patron_ekranlari_test.sql',
  'sql/21_mal_kabul.sql', 'test/mal_kabul_test.sql',
  'sql/22_gunluk_kontrol.sql', 'test/gunluk_kontrol_test.sql',
  'sql/23_kdv_sade_eslesme.sql', 'test/kdv_eslesme_test.sql',
  'sql/24_sade_metinler.sql',
  'sql/25_satis_yalniz_rapor.sql', 'test/satis_raporu_test.sql',
  'sql/26_dogru_hesap.sql', 'sql/27_fire_recete_surumu.sql', 'test/dogru_hesap_test.sql',
  'sql/28_fatura_birim_fiyat.sql', 'test/fatura_birim_fiyat_test.sql',
  'sql/29_sayim_tarihi.sql', 'test/sayim_tarihi_test.sql',
  'sql/30_ayni_gun_sirasi.sql', 'test/ayni_gun_test.sql',
  'sql/31_okuma_duzeltme.sql', 'test/okuma_duzeltme_test.sql',
  'sql/32_menude_olmayan.sql', 'test/menude_olmayan_test.sql',
];

// SQL metnini ifadelere böler: tırnak, $etiket$ gövdeleri ve yorumlar içindeki ';' bölmez.
// Satır başındaki \komutlar ayrı "meta" ifade olur; "… \gset" ifadeyi bitirir.
export function bol(metin) {
  const sonuc = [];
  let buf = '', i = 0, satirBasi = true;
  const bitir = (gset = false) => { if (buf.trim()) sonuc.push({ sql: buf.trim(), gset }); buf = ''; };
  while (i < metin.length) {
    const c = metin[i];
    if (satirBasi && c === '\\' && !buf.trim()) {
      const son = metin.indexOf('\n', i);
      const satir = metin.slice(i, son < 0 ? undefined : son).trim();
      sonuc.push({ meta: satir });
      i = son < 0 ? metin.length : son + 1; continue;
    }
    if (c === '\\' && metin.startsWith('\\gset', i)) { bitir(true); i += 5; continue; }
    if (c === '-' && metin[i + 1] === '-') { const son = metin.indexOf('\n', i); i = son < 0 ? metin.length : son; continue; }
    if (c === "'") {
      let j = i + 1;
      while (j < metin.length && !(metin[j] === "'" && metin[j + 1] !== "'")) j += metin[j] === "'" ? 2 : 1;
      buf += metin.slice(i, j + 1); i = j + 1; satirBasi = false; continue;
    }
    if (c === '$') {
      const m = /^\$[A-Za-z_]*\$/.exec(metin.slice(i));
      if (m) {
        const son = metin.indexOf(m[0], i + m[0].length);
        const bitis = son < 0 ? metin.length : son + m[0].length;
        buf += metin.slice(i, bitis); i = bitis; satirBasi = false; continue;
      }
    }
    if (c === ';') { buf += c; bitir(); i++; continue; }
    buf += c; satirBasi = c === '\n' ? true : (satirBasi && /\s/.test(c)); i++;
  }
  bitir();
  return sonuc;
}

// psql değişkenleri: :'x' → 'değer' (tırnaklı), :x → değer. "::tip" dönüşümlerine dokunmaz.
function yerlestir(sql, deg) {
  return sql
    .replace(/(?<!:):'([A-Za-z_][A-Za-z0-9_]*)'/g, (t, ad) => (ad in deg ? `'${String(deg[ad]).replace(/'/g, "''")}'` : t))
    .replace(/(?<![:\w]):([A-Za-z_][A-Za-z0-9_]*)\b/g, (t, ad) => (ad in deg ? String(deg[ad]) : t));
}

const metin = (v) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

export async function calistir(dosyalar, { sessiz = false } = {}) {
  const db = await veritabani(dosyalar, { sessiz });
  await db.close();
}

// Dosyaları sırayla çalıştırır ve açık veritabanını döndürür (karşılaştırma araçları için).
export async function veritabani(dosyalar, { sessiz = false } = {}) {
  const db = new PGlite();
  // Gerçek Postgres'te herkes geçici nesne (pg_temp) açabilir; PGlite'ta bu varsayılan kapalı.
  await db.exec(`grant temporary on database ${(await db.query('select current_database() d')).rows[0].d} to public;`);
  // pgcrypto PGlite'ta yok: "create extension pgcrypto" yerine 01'in kullandığı tek işlevi taklit et.
  const pgcryptoTaklit = `create schema if not exists extensions;
    create or replace function extensions.gen_random_bytes(n int) returns bytea language sql volatile as
      $$ select decode(string_agg(lpad(to_hex((random()*255)::int), 2, '0'), ''), 'hex') from generate_series(1, n) $$;
    grant execute on function extensions.gen_random_bytes(int) to public;`;
  const deg = {};
  for (const d of dosyalar) {
    const ifadeler = bol(readFileSync(join(KOK, d), 'utf8'));
    for (const f of ifadeler) {
      if (f.meta) {
        const m = /^\\set\s+(\S+)\s+(.*)$/.exec(f.meta);
        if (m) deg[m[1]] = m[2];
        continue;
      }
      let sql = yerlestir(f.sql, deg);
      if (/^create extension if not exists pgcrypto/i.test(sql)) { await db.exec(pgcryptoTaklit); continue; }
      try {
        const r = await db.query(sql.replace(/;\s*$/, ''));
        if (f.gset) {
          if (r.rows.length !== 1) throw new Error(`\\gset tek satır bekliyordu, ${r.rows.length} geldi`);
          for (const [k, v] of Object.entries(r.rows[0])) deg[k] = metin(v);
        }
      } catch (e) {
        const hata = new Error(`${d}: ${e.message}\n--- ifade ---\n${sql.slice(0, 600)}`);
        hata.dosya = d;
        throw hata;
      }
    }
    if (!sessiz) console.log(`✓ ${d}`);
  }
  return db;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = process.argv.slice(2);
  calistir(arg[0] === '--hepsi' || !arg.length ? ZINCIR : arg)
    .then(() => console.log('Tüm SQL testleri geçti.'))
    .catch((e) => { console.error('✗', e.message); process.exit(1); });
}
