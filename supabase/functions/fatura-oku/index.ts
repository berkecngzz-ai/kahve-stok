// Supabase Edge Function: fatura-oku
// Fatura/fiş FOTOĞRAFINI OpenAI görsel modeliyle okur; satırları takip edilen malzemelerle eşleştirir.
// (XML ve metinli PDF'ler buraya gelmez; telefonda doğrudan okunur.)
//
// GİZLİ DEĞİŞKENLER (Supabase → Edge Functions → Secrets). Bu dosyada ANAHTAR YOKTUR.
//   OPENAI_API_KEY   (zorunlu)  OpenAI API anahtarı
//   AI_MODELLER      (isteğe bağlı) izin verilen modeller, virgülle; ilk yazılan varsayılan.
//                    Varsayılan: "gpt-4.1-mini,gpt-4.1-nano"
//   AI_FIYATLAR      (isteğe bağlı) JSON, 1 milyon token başına dolar: {"gpt-4.1-mini":[0.40,1.60]}
// Supabase'in kendi verdiği değişkenler: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//
// Güvenlik: yalnızca giriş yapmış ve bir mekana bağlı kullanıcı çağırabilir (ai_okuma_baslat bunu ve
// mekanın günlük sınırını kontrol eder). AI sonucu yalnızca bu işlev (service_role) tarafından kaydedilir.

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const cevap = (govde: unknown, durum = 200) =>
  new Response(JSON.stringify(govde), { status: durum, headers: { ...CORS, 'Content-Type': 'application/json' } });

// Tahmini fiyatlar (1M token başına USD: [girdi, çıktı]). OpenAI fiyat sayfasından doğrulanmalı; AI_FIYATLAR ile değiştirilebilir.
const VARSAYILAN_FIYATLAR: Record<string, [number, number]> = {
  'gpt-4.1-mini': [0.40, 1.60], 'gpt-4.1-nano': [0.10, 0.40], 'gpt-4o-mini': [0.15, 0.60],
  'gpt-5-mini': [0.25, 2.00], 'gpt-5-nano': [0.05, 0.40],
};

const SATIR = {
  type: 'object', additionalProperties: false,
  required: ['metin', 'miktar', 'birim', 'birim_fiyat', 'tutar', 'kdv_orani', 'eslesme'],
  properties: {
    metin: { type: 'string', description: 'Ürün adı, faturada yazdığı gibi' },
    miktar: { type: ['number', 'null'], description: 'Miktar sütunundaki sayı (ürün adındaki paket boyu değil)' },
    birim: { type: 'string', enum: ['adet', 'kg', 'g', 'lt', 'ml', 'paket', 'diger'] },
    birim_fiyat: { type: ['number', 'null'] },
    tutar: { type: ['number', 'null'], description: 'Satır tutarı, yazdığı gibi' },
    kdv_orani: { type: ['number', 'null'], description: 'Yüzde olarak: 1, 10, 20…' },
    eslesme: {
      type: 'object', additionalProperties: false,
      required: ['karar', 'malzeme_id', 'stok_miktari', 'guven'],
      properties: {
        karar: { type: 'string', enum: ['malzeme', 'takip_disi', 'emin_degil'] },
        malzeme_id: { type: ['string', 'null'] },
        stok_miktari: { type: ['number', 'null'], description: 'Malzemenin kendi biriminde (g / ml / adet) stoğa girecek toplam miktar' },
        guven: { type: 'number', description: '0 ile 1 arası; dürüst ol' },
      },
    },
  },
};
const SEMA = {
  type: 'object', additionalProperties: false,
  required: ['belge_turu', 'okunabilirlik', 'tedarikci', 'vkn', 'fatura_no', 'tarih', 'tutarlar_kdv_dahil',
             'genel_toplam', 'kdv_haric_toplam', 'kdv_toplam', 'indirim', 'satirlar'],
  properties: {
    belge_turu: { type: 'string', enum: ['fatura', 'fis', 'diger'] },
    okunabilirlik: { type: 'string', enum: ['iyi', 'bulanik', 'eksik'], description: 'eksik: belgenin bir kısmı (ör. alt toplamlar) görünmüyor' },
    tedarikci: { type: ['string', 'null'] },
    vkn: { type: ['string', 'null'], description: 'Satıcının VKN/TCKN numarası (yalnız rakam)' },
    fatura_no: { type: ['string', 'null'] },
    tarih: { type: ['string', 'null'], description: 'YYYY-AA-GG' },
    tutarlar_kdv_dahil: { type: 'boolean', description: 'Satır tutarları KDV dahil mi (fişlerde genelde evet, faturalarda hayır)' },
    genel_toplam: { type: ['number', 'null'], description: 'Ödenecek / genel toplam' },
    kdv_haric_toplam: { type: ['number', 'null'] },
    kdv_toplam: { type: ['number', 'null'] },
    indirim: { type: ['number', 'null'] },
    satirlar: { type: 'array', items: SATIR },
  },
};

const TALIMAT = `Sen Türkiye'deki tedarikçi faturalarını ve market fişlerini okuyan bir asistansın. Bir kafe için stok kaydı yapılıyor.
KURALLAR:
- Yalnızca görüntüde YAZANI oku; tahmin edip uydurma. Okuyamadığın alanı null bırak.
- Sayıları ondalık sayı olarak ver: "1.234,56" → 1234.56, "49,505" → 49.505.
- Her ürün satırı için: miktar ve birim MİKTAR sütunundan (ürün adındaki "1L", "1KG", "70CL" paket boyudur, miktar değildir).
  Fişlerde "6 x 41,00" satırı alttaki ürünün miktarıdır.
  Birim: ADET/AD/ADT → adet; KG → kg; GR/G → g; LT/L → lt; ML → ml; PK/PAKET/KOLİ/KUTU → paket.
- tutar: satırın tutarı, yazdığı gibi. tutarlar_kdv_dahil: satır tutarları KDV dahilse true.
- Toplam, iskonto, KDV satırlarını ürün satırı sayma.
EŞLEŞTİRME (takip edilen malzeme listesi verilecek):
- Ürün açıkça listedeki bir malzemeyse (marka, kısaltma, yazım farkı olabilir: "ACIFTLIK T.YAG SUT 1LT" → Süt; "MNN KRML SRP 70CL" → Karamel şurubu):
  karar "malzeme", malzeme_id, ve stok_miktari = malzemenin kendi biriminde (g / ml / adet) TOPLAM miktar.
  Örnek: 12 AD × 1LT süt → 12000 (ml); 3 AD × 1KG kahve → 3000 (g); 4 PK × 50'Lİ bardak → 200 (adet).
  Paket içi miktar yazmıyorsa stok_miktari null ve güveni düşür.
- Ürün listedeki hiçbir malzeme değilse (peçete, deterjan; listede yoksa şeker, kakao…): karar "takip_disi".
- Emin değilsen: karar "emin_degil". Güveni dürüst ver; yanlış eşleştirme stok hesabını bozar.`;

// OpenAI'a fotoğraf(lar)ı ve malzeme listesini gönderir; yapılandırılmış sonucu döner.
async function openaiOku(anahtar: string, model: string, liste: unknown[], gorseller: string[],
                         fiyatlar: Record<string, [number, number]>) {
  const ai0 = Date.now();
  const kes = new AbortController();
  const zaman = setTimeout(() => kes.abort(), 30000);
  const istek: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: TALIMAT },
      { role: 'user', content: [
        { type: 'text', text: `Takip edilen malzemeler (JSON): ${JSON.stringify(liste)}` },
        ...gorseller.map((g) => ({ type: 'image_url', image_url: { url: g, detail: 'high' } })),
      ] },
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'fatura', strict: true, schema: SEMA } },
    max_completion_tokens: 6000,
  };
  if (model.startsWith('gpt-5')) istek.reasoning_effort = 'minimal';
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', signal: kes.signal,
    headers: { Authorization: `Bearer ${anahtar}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(istek),
  }).finally(() => clearTimeout(zaman));
  const aiMs = Date.now() - ai0;
  const veri = await r.json().catch(() => ({}));
  if (!r.ok) {
    const kod = r.status === 429 ? 'AI_SINIR' : 'AI_HATA';
    throw Object.assign(new Error(`${kod}: ${veri?.error?.message ?? r.status}`), { kod });
  }
  const metin = veri.choices?.[0]?.message?.content;
  if (!metin) throw Object.assign(new Error('AI_HATA: boş cevap'), { kod: 'AI_HATA' });
  const sonuc = JSON.parse(metin);
  const giris = veri.usage?.prompt_tokens ?? null;
  const cikis = veri.usage?.completion_tokens ?? null;
  const f = fiyatlar[model];
  const maliyet = f && giris != null && cikis != null ? (giris * f[0] + cikis * f[1]) / 1_000_000 : null;
  return { sonuc, giris, cikis, maliyet, aiMs };
}

// Sabit sürede karşılaştırma (imza tahmin edilemesin)
function ayniMi(a: string, b: string) {
  if (a.length !== b.length) return false;
  let fark = 0;
  for (let i = 0; i < a.length; i++) fark |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return fark === 0;
}

// TEST MODU: okuma_testleri satırını okur. Yalnızca veritabanındaki gizli imzayla çağrılabilir (bkz. sql/07).
async function testModu(req: Request, imza: string, anahtar: string, fiyatlar: Record<string, [number, number]>) {
  const t0 = Date.now();
  const sunucu = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const ayarlar = await sunucu.from('ic_ayarlar').select('ad, deger').in('ad', ['okuma_testi_imza', 'okuma_testi_acik']);
  const ayar = new Map((ayarlar.data ?? []).map((a) => [a.ad, a.deger]));
  if (ayarlar.error || !ayar.get('okuma_testi_imza') || !ayniMi(imza, ayar.get('okuma_testi_imza')!)) return cevap({ hata: 'YETKI' }, 403);
  if (ayar.get('okuma_testi_acik') !== 'evet') return cevap({ hata: 'TEST_KAPALI' }, 403);   // sql/08: okuma_testi_ac(false)
  let govde: { okuma_testi?: string };
  try { govde = await req.json(); } catch { return cevap({ hata: 'GECERSIZ' }, 400); }
  const satir = await sunucu.from('okuma_testleri').select('*').eq('id', govde.okuma_testi ?? '').maybeSingle();
  if (satir.error || !satir.data) return cevap({ hata: 'BULUNAMADI' }, 404);
  const t = satir.data;
  try {
    const dosya = await sunucu.storage.from('fatura-belgeleri').download(t.dosya_yolu);
    if (dosya.error) throw new Error(dosya.error.message);
    const bayt = new Uint8Array(await dosya.data.arrayBuffer());
    let ikili = '';
    for (let i = 0; i < bayt.length; i += 0x8000) ikili += String.fromCharCode(...bayt.subarray(i, i + 0x8000));
    const tip = /\.png$/i.test(t.dosya_yolu) ? 'image/png' : 'image/jpeg';
    const r = await openaiOku(anahtar, t.model, t.malzemeler, [`data:${tip};base64,${btoa(ikili)}`], fiyatlar);
    await sunucu.from('okuma_testleri').update({ durum: 'tamam', sonuc: r.sonuc, giris_token: r.giris, cikis_token: r.cikis,
      maliyet_usd: r.maliyet, ai_ms: r.aiMs, toplam_ms: Date.now() - t0, boyut_kb: Math.round(bayt.length / 1024) }).eq('id', t.id);
    return cevap({ ok: true });
  } catch (e) {
    const mesaj = e instanceof Error ? e.message : String(e);
    await sunucu.from('okuma_testleri').update({ durum: 'hata', hata: mesaj.slice(0, 500), toplam_ms: Date.now() - t0 }).eq('id', t.id);
    return cevap({ hata: 'AI_HATA', mesaj }, 502);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return cevap({ hata: 'Yalnızca POST' }, 405);
  const t0 = Date.now();
  const anahtar = Deno.env.get('OPENAI_API_KEY');
  if (!anahtar) return cevap({ hata: 'AYAR_EKSIK', mesaj: 'Okuma servisi kurulmamış.' }, 503);
  let fiyatlar = VARSAYILAN_FIYATLAR;
  try { fiyatlar = { ...VARSAYILAN_FIYATLAR, ...JSON.parse(Deno.env.get('AI_FIYATLAR') ?? '{}') }; } catch { /* varsayılan */ }

  const testImzasi = req.headers.get('x-okuma-testi');
  if (testImzasi) return testModu(req, testImzasi, anahtar, fiyatlar);

  const yetki = req.headers.get('Authorization');
  if (!yetki) return cevap({ hata: 'GIRIS_GEREKLI', mesaj: 'Giriş yapmalısın.' }, 401);
  const URL_ = Deno.env.get('SUPABASE_URL')!;
  const kullanici = createClient(URL_, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: yetki } } });
  const sunucu = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const modeller = (Deno.env.get('AI_MODELLER') ?? 'gpt-4.1-mini,gpt-4.1-nano').split(',').map((m) => m.trim()).filter(Boolean);

  let govde: { gorseller?: string[]; model?: string };
  try { govde = await req.json(); } catch { return cevap({ hata: 'GECERSIZ', mesaj: 'Geçersiz istek.' }, 400); }
  const gorseller = Array.isArray(govde.gorseller) ? govde.gorseller : [];
  if (!gorseller.length || gorseller.length > 4
      || gorseller.some((g) => typeof g !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(g) || g.length > 4_500_000)) {
    return cevap({ hata: 'GECERSIZ', mesaj: 'Fotoğraf geçersiz ya da çok büyük.' }, 400);
  }
  const model = govde.model && modeller.includes(govde.model) ? govde.model : modeller[0];

  // Hak al (giriş + mekan + günlük sınır). Kullanıcının oturumuyla.
  const hak = await kullanici.rpc('ai_okuma_baslat', { p_model: model });
  if (hak.error) {
    const m = hak.error.message ?? '';
    if (m.includes('GUNLUK_SINIR')) return cevap({ hata: 'GUNLUK_SINIR', mesaj: m.replace('GUNLUK_SINIR: ', '') }, 429);
    return cevap({ hata: 'YETKI', mesaj: m || 'Yetki yok.' }, 403);
  }
  const okumaId = hak.data as string;
  const bitir = (durum: 'tamam' | 'hata', ek: Record<string, unknown>) =>
    sunucu.rpc('ai_okuma_bitir', { p_id: okumaId, p_durum: durum, p_sonuc: ek.sonuc ?? null,
      p_giris_token: ek.giris ?? null, p_cikis_token: ek.cikis ?? null, p_maliyet: ek.maliyet ?? null,
      p_sure_ms: Date.now() - t0, p_hata: ek.hata ?? null });

  try {
    // Takip edilen malzemeler (fiyat yok; yalnız ad ve birim)
    const mz = await kullanici.from('malzemeler').select('id, ad, birim, aktif');
    if (mz.error) throw new Error(mz.error.message);
    const liste = mz.data.filter((m) => m.aktif).map((m) => ({ id: m.id, ad: m.ad, birim: m.birim }));
    const r = await openaiOku(anahtar, model, liste, gorseller, fiyatlar);
    const b = await bitir('tamam', { sonuc: r.sonuc, giris: r.giris, cikis: r.cikis, maliyet: r.maliyet });
    if (b.error) throw new Error(b.error.message);
    return cevap({ okuma_id: okumaId, model, sonuc: r.sonuc, token: { giris: r.giris, cikis: r.cikis }, maliyet_usd: r.maliyet,
                   sure: { ai_ms: r.aiMs, toplam_ms: Date.now() - t0 } });
  } catch (e) {
    const mesaj = e instanceof Error ? e.message : String(e);
    await bitir('hata', { hata: mesaj });
    const kod = (e as { kod?: string }).kod ?? (mesaj.includes('abort') ? 'AI_ZAMAN_ASIMI' : 'AI_HATA');
    return cevap({ hata: kod, mesaj: 'Okuma servisi şu an cevap vermedi.', okuma_id: okumaId }, 502);
  }
});
