// Yerel demo sunucusu: uygulamayı canlı Supabase'e HİÇ bağlanmadan, bilgisayardaki bir veritabanıyla açar.
// Veritabanı PGlite (Node içinde gerçek Postgres); sql/ dosyaları + demo verisi her açılışta sıfırdan kurulur.
// Supabase'in uygulamanın kullandığı küçük bir kısmını taklit eder: giriş, tablo okuma/yazma, rpc.
// Dosya yükleme ve AI okuma demoda yoktur.
//
// Kullanım:  node scripts/demo/sunucu.mjs [--port 8787] [--kok <klasör>] [--veri scripts/demo/demo-veri.sql]
// Sonra tarayıcıda http://localhost:8787 → demo hesapları scripts/demo/demo-veri.sql'in başında yazıyor.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { veritabani } from '../../test/sql-calistir.mjs';

const KOK = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (ad, varsayilan) => {
  const i = process.argv.indexOf(`--${ad}`);
  return i > 0 ? process.argv[i + 1] : varsayilan;
};
const PORT = Number(arg('port', 8787));
const SITE = resolve(arg('kok', KOK));          // Sunulacak ön yüz (önce/sonra karşılaştırması için başka klasör olabilir)
const VERI = arg('veri', 'scripts/demo/demo-veri.sql');

// Canlıdaki sırayla şema; testler değil. 07/08 (okuma testi, pg_net) demoda yok.
const SEMA = [
  'test/supabase_taklit.sql', 'sql/01_giris_mekan.sql', 'sql/02_malzeme_tarif.sql', 'sql/03_girisler.sql',
  'sql/04_fatura_belge_kdv.sql', 'sql/05_belge_okuma_kurulum.sql', 'sql/06_ai_okuma.sql',
  'sql/09_olagandisi_miktar.sql', 'sql/10_sifir_fiyat.sql', 'sql/11_acik_yetkiler.sql', 'sql/12_stok_duzeltmeleri.sql',
];
for (const d of ['sql/13_rapor_uyarilari.sql', 'sql/14_fatura_patron_yetkisi.sql', 'sql/15_satis_excel_dosya.sql',
  'sql/20_patron_ekranlari.sql', 'sql/21_mal_kabul.sql', 'sql/22_gunluk_kontrol.sql', 'sql/23_kdv_sade_eslesme.sql',
  'sql/24_sade_metinler.sql']) {
  if (existsSync(join(KOK, d))) SEMA.push(d);
}

// Mal kabul demosu (eksik teslimat görevi) yalnız 21 kuruluysa
const EK = SEMA.includes('sql/21_mal_kabul.sql') && existsSync(join(KOK, 'scripts/demo/demo-mal-kabul.sql'))
  ? ['scripts/demo/demo-mal-kabul.sql'] : [];
// 25 (elle satış kapalı) demo verisinden SONRA: demo-veri.sql geçmiş haftaların satışını eski yoldan yazar.
const SON = ['sql/25_satis_yalniz_rapor.sql', 'sql/26_dogru_hesap.sql', 'sql/27_fire_recete_surumu.sql', 'sql/28_fatura_birim_fiyat.sql', 'sql/29_sayim_tarihi.sql', 'sql/30_ayni_gun_sirasi.sql', 'sql/31_okuma_duzeltme.sql', 'sql/32_menude_olmayan.sql', 'sql/33_icerik_mukerrer.sql'].filter((d) => existsSync(join(KOK, d)));
const db = await veritabani([...SEMA, VERI, ...EK, ...SON], { sessiz: true });
// Demo hesapları: demo-veri.sql "-- hesap: e-posta şifre" satırlarıyla tanımlar (yalnız bu yerel demo için).
const HESAPLAR = new Map([...readFileSync(join(KOK, VERI), 'utf8').matchAll(/^-- hesap: (\S+) (\S+)/gm)]
  .map((m) => [m[1], m[2]]));
const kullanicilar = new Map((await db.query('select id, email from auth.users')).rows.map((r) => [r.email, r.id]));

// PGlite tek bağlantı: istekler sırayla işlenir.
let kuyruk = Promise.resolve();
const sirayla = (is) => (kuyruk = kuyruk.then(is, is));

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function jeton(id, email) {
  const exp = Math.floor(Date.now() / 1000) + 3600 * 24;
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: id, email, role: 'authenticated', exp })}.demo`;
}
function jetonOku(baslik) {
  const t = /^Bearer (.+)$/.exec(baslik || '')?.[1];
  try { return JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()); } catch { return null; }
}

const id = (s) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw Object.assign(new Error(`geçersiz ad: ${s}`), { kod: 400 });
  return `"${s}"`;
};

// PostgREST select dili: "a, b, ilişki(c, d)" → SQL ifadeleri. İlişki: tekil üst tablo (mekanlar → mekan_id).
function secimCevir(secim, tablo) {
  const parcalar = [];
  let derin = 0, buf = '';
  for (const c of secim || '*') {
    if (c === '(') derin++;
    if (c === ')') derin--;
    if (c === ',' && !derin) { parcalar.push(buf.trim()); buf = ''; } else buf += c;
  }
  if (buf.trim()) parcalar.push(buf.trim());
  return parcalar.map((p) => {
    if (p === '*') return `${id(tablo)}.*`;
    const m = /^([a-z_]+)\((.*)\)$/.exec(p);
    if (m) {
      const ust = m[1];
      const fk = `${ust.replace(/(lar|ler)$/, '')}_id`;
      const alt = m[2].split(',').map((x) => id(x.trim())).join(', ');
      return `(select to_jsonb(x) from (select ${alt} from public.${id(ust)} u where u.id = ${id(tablo)}.${id(fk)}) x) as ${id(ust)}`;
    }
    return id(p);
  }).join(', ');
}

// Süzgeçler: kolon=op.değer (eq, neq, gt, gte, lt, lte, in.(..), is.null, not.is.null)
function suzgecCevir(params, tablo, degerler) {
  const kosul = [];
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'offset', 'columns', 'on_conflict'].includes(k)) continue;
    let deger = v, degil = false;
    if (deger.startsWith('not.')) { degil = true; deger = deger.slice(4); }
    const nokta = deger.indexOf('.');
    const op = deger.slice(0, nokta), d = deger.slice(nokta + 1);
    const kol = `${id(tablo)}.${id(k)}`;
    let ifade;
    const yer = (x) => { degerler.push(x); return `$${degerler.length}`; };
    if (op === 'is') ifade = `${kol} is ${d === 'null' ? 'null' : d === 'true' ? 'true' : 'false'}`;
    else if (op === 'in') {
      const liste = d.replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, ''));
      ifade = `${kol}::text = any(${yer(liste)}::text[])`;
    } else {
      const ops = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' };
      if (!ops[op]) throw Object.assign(new Error(`desteklenmeyen süzgeç: ${op}`), { kod: 400 });
      // eşitlik metin olarak (true, uuid, metin); büyük/küçük kolon tipinde (tarih, sayı)
      ifade = op === 'eq' || op === 'neq' ? `${kol}::text ${ops[op]} ${yer(d)}::text` : `${kol} ${ops[op]} ${yer(d)}`;
    }
    kosul.push(degil ? `not (${ifade})` : ifade);
  }
  return kosul.length ? `where ${kosul.join(' and ')}` : '';
}

function siraCevir(order, tablo) {
  if (!order) return '';
  return `order by ${order.split(',').map((o) => {
    const [kol, ...ek] = o.split('.');
    return `${id(tablo)}.${id(kol)} ${ek.includes('desc') ? 'desc' : 'asc'}${ek.includes('nullslast') ? ' nulls last' : ek.includes('nullsfirst') ? ' nulls first' : ''}`;
  }).join(', ')}`;
}

// Kullanıcı adına (authenticated rolü + jwt sub) bir işlem içinde sorgu çalıştırır; RLS geçerlidir.
async function kullaniciAdina(kim, is) {
  await db.exec('begin');
  try {
    if (kim) {
      await db.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.email', $2, true)`,
        [kim.sub, kim.email]);
      await db.exec('set local role authenticated');
    } else {
      await db.query(`select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claim.email', '', true)`);
      await db.exec('set local role anon');
    }
    const r = await is();
    await db.exec('commit');
    return r;
  } catch (e) {
    await db.exec('rollback');
    throw e;
  }
}

async function rpc(ad, govde) {
  const f = (await db.query(`
    select p.proargnames, p.pronargs, p.proretset, format_type(p.prorettype, null) donus,
           (select array_agg(format_type(t, null) order by o) from unnest(p.proargtypes) with ordinality a(t, o)) tipler
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = $1 order by p.pronargs desc`, [ad])).rows;
  if (!f.length) throw Object.assign(new Error(`Could not find the function public.${ad}`), { kod: 404 });
  const anahtarlar = Object.keys(govde || {});
  const uygun = f.find((x) => anahtarlar.every((k) => (x.proargnames || []).includes(k))) || f[0];
  const degerler = [];
  const argumanlar = anahtarlar.map((k) => {
    const i = uygun.proargnames.indexOf(k);
    const tip = uygun.tipler[i];
    const v = govde[k];
    degerler.push(v == null ? null : (tip === 'jsonb' || tip === 'json') ? JSON.stringify(v)
      : Array.isArray(v) ? `{${v.map((x) => `"${String(x).replace(/"/g, '\\"')}"`).join(',')}}` : String(v));
    return `${id(k)} => $${degerler.length}::${tip}`;
  }).join(', ');
  const cagri = `public.${id(ad)}(${argumanlar})`;
  if (uygun.proretset) {
    const r = await db.query(`select to_jsonb(r) j from ${cagri} r`, degerler);
    return r.rows.map((x) => x.j);   // tablo dönen işlevde satır nesnesi, tekil tipte değerin kendisi
  }
  const r = await db.query(`select to_jsonb(${cagri}) j`, degerler);
  return r.rows[0]?.j ?? null;
}

async function tabloIstegi(yontem, tablo, params, govde, basliklar) {
  const degerler = [];
  const where = suzgecCevir(params, tablo, degerler);
  const t = `public.${id(tablo)}`;
  if (yontem === 'GET' || yontem === 'HEAD') {
    const limit = params.get('limit') ? `limit ${Number(params.get('limit'))}` : '';
    const offset = params.get('offset') ? `offset ${Number(params.get('offset'))}` : '';
    const sql = `select to_jsonb(s) j from (select ${secimCevir(params.get('select'), tablo)} from ${t} ${where}
      ${siraCevir(params.get('order'), tablo)} ${limit} ${offset}) s`;
    return (await db.query(sql, degerler)).rows.map((r) => r.j);
  }
  const donsun = /return=representation/.test(basliklar.prefer || '');
  const secim = params.get('select') ? secimCevir(params.get('select'), tablo) : '*';
  if (yontem === 'POST') {
    const satirlar = Array.isArray(govde) ? govde : [govde];
    const kollar = Object.keys(satirlar[0]).map(id).join(', ');
    degerler.push(JSON.stringify(satirlar));
    const r = await db.query(`insert into ${t} (${kollar}) select ${kollar} from jsonb_populate_recordset(null::${t}, $${degerler.length})
      returning ${secim.replaceAll(`${id(tablo)}.`, '')}`, degerler);
    return donsun ? r.rows : null;
  }
  if (yontem === 'PATCH') {
    const kollar = Object.keys(govde).map(id);
    degerler.push(JSON.stringify(govde));
    const r = await db.query(`update ${t} set (${kollar.join(', ')}) = (select ${kollar.join(', ')}
      from jsonb_populate_record(null::${t}, $${degerler.length})) ${where} returning ${secim.replaceAll(`${id(tablo)}.`, '')}`, degerler);
    return donsun ? r.rows : null;
  }
  throw Object.assign(new Error(`${yontem} desteklenmiyor`), { kod: 405 });
}

const TIPLER = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.wasm': 'application/wasm', '.traineddata': 'application/octet-stream', '.gz': 'application/octet-stream' };

function dosyaSun(yol, res) {
  let p = decodeURIComponent(yol.split('?')[0]);
  if (p === '/') p = '/index.html';
  const tam = resolve(join(SITE, p));
  if (!tam.startsWith(SITE) || !existsSync(tam) || statSync(tam).isDirectory()) { res.writeHead(404); return res.end(); }
  let icerik = readFileSync(tam);
  // Demo: config.js yerel sunucuyu gösterir; eski sürümlerdeki "https ile başlamalı" kontrolü localhost'a izin verir.
  if (p === '/config.js') {
    icerik = `export const SUPABASE_URL = 'http://localhost:${PORT}';\nexport const SUPABASE_KEY = 'demo';\n`;
  } else if (p === '/app.js') {
    icerik = icerik.toString().replace("SUPABASE_URL.startsWith('https://')", "/^https?:\\/\\//.test(SUPABASE_URL)");
  }
  res.writeHead(200, { 'content-type': TIPLER[extname(tam)] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(icerik);
}

function json(res, kod, veri, ek = {}) {
  res.writeHead(kod, { 'content-type': 'application/json', ...ek });
  res.end(veri === undefined ? '' : JSON.stringify(veri));
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'access-control-expose-headers': '*' };

createServer(async (req, res) => {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let govdeMetni = '';
  for await (const p of req) govdeMetni += p;
  // Dosya yüklemesinin gövdesi JSON değildir (multipart / ikili): yalnız JSON çözülür.
  let govde = null;
  if (govdeMetni && /json/.test(req.headers['content-type'] || 'application/json')) {
    try { govde = JSON.parse(govdeMetni); } catch { govde = null; }
  }
  const kim = jetonOku(req.headers.authorization);
  try {
    if (url.pathname === '/auth/v1/token') {
      const { email, password } = govde || {};
      if (!HESAPLAR.has(email) || HESAPLAR.get(email) !== password) {
        return json(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials' });
      }
      const uid = kullanicilar.get(email);
      const user = { id: uid, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {},
        created_at: new Date().toISOString() };
      return json(res, 200, { access_token: jeton(uid, email), token_type: 'bearer', expires_in: 86400,
        expires_at: Math.floor(Date.now() / 1000) + 86400, refresh_token: `yenile-${uid}`, user });
    }
    if (url.pathname === '/auth/v1/user') {
      if (!kim) return json(res, 401, { msg: 'oturum yok' });
      return json(res, 200, { id: kim.sub, email: kim.email, aud: 'authenticated', role: 'authenticated' });
    }
    if (url.pathname.startsWith('/auth/v1/')) return json(res, 204);
    // Dosya yükleme taklidi: içerik saklanmaz, yalnız storage.objects'e kayıt düşülür (RLS: mekanın klasörü).
    const yukle = req.method === 'POST' && /^\/storage\/v1\/object\/([^/]+)\/(.+)$/.exec(url.pathname);
    if (yukle) {
      const [, kova, yol] = yukle.map(decodeURIComponent);
      await sirayla(() => kullaniciAdina(kim, () => db.query('insert into storage.objects (bucket_id, name) values ($1, $2)', [kova, yol])));
      return json(res, 200, { Key: `${kova}/${yol}`, Id: yol });
    }
    if (url.pathname.startsWith('/storage/v1/')) return json(res, 200, []);
    if (url.pathname.startsWith('/functions/v1/')) return json(res, 503, { message: 'Demoda AI okuma yok.' });
    const m = /^\/rest\/v1\/(rpc\/)?([a-z_]+)$/.exec(url.pathname);
    if (m) {
      const sonuc = await sirayla(() => kullaniciAdina(kim, () => (m[1]
        ? rpc(m[2], govde)
        : tabloIstegi(req.method, m[2], url.searchParams, govde, req.headers))));
      const tek = /vnd\.pgrst\.object/.test(req.headers.accept || '');
      if (tek && !m[1]) {
        if (sonuc.length !== 1) return json(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' });
        return json(res, 200, sonuc[0]);
      }
      if (sonuc === null && !m[1]) return json(res, 201);
      const n = Array.isArray(sonuc) ? sonuc.length : 1;
      const aralik = { 'content-range': `${n ? `0-${n - 1}` : '*'}/${/count=exact/.test(req.headers.prefer || '') ? n : '*'}` };
      if (req.method === 'HEAD') { res.writeHead(200, aralik); return res.end(); }
      return json(res, 200, sonuc, aralik);
    }
    return dosyaSun(req.url, res);
  } catch (e) {
    return json(res, e.kod || 400, { message: e.message, code: e.code || 'P0001', details: e.detail ?? null, hint: e.hint ?? null });
  }
}).listen(PORT, () => console.log(`Demo hazır: http://localhost:${PORT}  (ön yüz: ${SITE})`));
