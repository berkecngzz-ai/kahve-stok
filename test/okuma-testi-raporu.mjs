// Okuma testi raporu: okuma_testleri sonuçlarını (CLI ile indirilmiş JSON) cevap anahtarıyla karşılaştırır.
// Kullanım: node test/okuma-testi-raporu.mjs <sonuclar.json> <00_CEVAP_ANAHTARI.md>
import { readFileSync } from 'node:fs';
import { aiSonucunuCevir, toplamKontrol } from '../okuma.js';
import { aiIleSiniflandir } from '../eslestirme.js';
import { cevapAnahtariniOku, anahtarBelgesi, karsilastir } from '../okuma-testi.js';

const [sonucDosyasi, anahtarDosyasi] = process.argv.slice(2);
const satirlar = JSON.parse(readFileSync(sonucDosyasi, 'utf8')).rows;
const anahtarlar = cevapAnahtariniOku(readFileSync(anahtarDosyasi, 'utf8'));

const rapor = [];
for (const r of satirlar) {
  const dosya = r.dosya_yolu.split('/').pop();
  const beklenen = anahtarBelgesi(anahtarlar, dosya);
  const malzemeler = (r.malzemeler ?? [
    ['sut', 'Süt', 'ml'], ['kahve_cekirdegi', 'Kahve çekirdeği', 'g'], ['filtre_kahve', 'Filtre kahve', 'g'],
    ['karamel_surubu', 'Karamel şurubu', 'ml'], ['vanilya_surubu', 'Vanilya şurubu', 'ml'], ['bardak', 'Bardak', 'adet'],
  ].map(([id, ad, birim]) => ({ id, ad, birim }))).map((m) => ({ ...m, aktif: true }));
  const sonuc = aiSonucunuCevir(r.sonuc);
  const ctx = { malzemeler, defter: [], tedarikciAnahtar: sonuc.tedarikci_vkn ?? '', tedarikciAdi: sonuc.tedarikci };
  sonuc.satirlar.forEach((s) => { s.karar = aiIleSiniflandir(s, ctx); });
  const k = karsilastir(beklenen, sonuc, new Map(malzemeler.map((m) => [m.id, m.ad])));
  rapor.push({ dosya, model: r.model, k, tutuyor: toplamKontrol(sonuc).tutuyor, ai_ms: r.ai_ms, toplam_ms: r.toplam_ms,
               maliyet: Number(r.maliyet_usd), token: `${r.giris_token}/${r.cikis_token}`, kb: r.boyut_kb,
               tedarikci: sonuc.tedarikci, fatura_no: sonuc.fatura_no, tarih: sonuc.tarih });
}

for (const r of rapor) {
  const o = r.k.ozet;
  console.log(`\n### ${r.dosya} · ${r.model}`);
  console.log(`doğru ${o.dogru} · yanlış ${o.yanlis} · kuyruk ${o.kuyruk} · okunamadı ${o.okunamadi} · rakam okuması ${o.okuma_dogru}/${o.satir}`
    + ` · genel toplam ${r.k.genel.okunan} (${r.k.genel.dogru ? 'doğru' : 'YANLIŞ'}) · kontrol ${r.tutuyor ? 'tutuyor' : 'TUTMUYOR'}`
    + ` · AI ${(r.ai_ms / 1000).toFixed(1)} sn · sunucu ${(r.toplam_ms / 1000).toFixed(1)} sn · ${r.kb} KB · token ${r.token} · $${r.maliyet.toFixed(5)}`);
  console.log(`tedarikçi: ${r.tedarikci} · no: ${r.fatura_no} · tarih: ${r.tarih}`);
  for (const x of r.k.satirlar) {
    console.log(`  ${x.sonuc.padEnd(9)} okuma:${x.okuma.padEnd(6)} ${x.beklenen.metin} → ${x.aciklama}${x.okumaNotu ? ` [${x.okumaNotu}]` : ''}`);
  }
  if (r.k.fazla.length) console.log(`  fazladan okunan: ${r.k.fazla.join(', ')}`);
}
const ozet = {};
for (const r of rapor) {
  const o = (ozet[r.model] ??= { satir: 0, dogru: 0, yanlis: 0, kuyruk: 0, ai: [], maliyet: 0 });
  o.satir += r.k.ozet.satir; o.dogru += r.k.ozet.dogru; o.yanlis += r.k.ozet.yanlis; o.kuyruk += r.k.ozet.kuyruk + r.k.ozet.okunamadi;
  o.ai.push(r.ai_ms); o.maliyet += r.maliyet;
}
console.log('\n### MODEL ÖZETİ');
for (const [m, o] of Object.entries(ozet)) {
  console.log(`${m}: ${o.dogru}/${o.satir} doğru, ${o.yanlis} yanlış, ${o.kuyruk} kuyruk · ort. AI ${(o.ai.reduce((a, b) => a + b, 0) / o.ai.length / 1000).toFixed(1)} sn`
    + ` · fatura başı ort. $${(o.maliyet / o.ai.length).toFixed(5)}`);
}
