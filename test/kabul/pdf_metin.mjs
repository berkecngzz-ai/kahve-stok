// Metinli PDF yolu: uygulamanın çözücüsü (metinCoz) ↔ kaynak belge. Çıktı: cikti/belge/pdf-metin.json
import { readFileSync, writeFileSync } from 'node:fs';
import { metinCoz } from '../../okuma.js';
const K = JSON.parse(readFileSync(new URL('./cikti/belge/kaynak.json', import.meta.url), 'utf8'));
const sonuc = {};
for (const [ad, k] of Object.entries(K)) {
  const r = metinCoz(k.metin);
  const fark = [];
  const esit = (a, b, alan) => { if (String(a) !== String(b)) fark.push(`${alan}: belge ${b} / okunan ${a}`); };
  esit(r.fatura_no, k.fatura_no, 'fatura no'); esit(r.tedarikci, k.tedarikci, 'tedarikçi'); esit(r.tedarikci_vkn, k.vkn, 'VKN');
  esit(r.tarih, k.tarih, 'tarih'); esit(r.toplamlar.genel, k.genel, 'genel toplam'); esit(r.toplamlar.indirim, k.iskonto, 'iskonto');
  esit(r.satirlar.length, k.satirlar.length, 'satır sayısı');
  k.satirlar.forEach((s, i) => {
    const o = r.satirlar[i] ?? {};
    esit(o.miktar, s.miktar, `satır ${i + 1} miktar`); esit(o.tutar_haric ?? o.tutar_dahil, s.tutar, `satır ${i + 1} tutar`);
    esit(o.kdv_orani, s.kdv, `satır ${i + 1} KDV`);
    if (!String(o.metin ?? '').includes(s.metin.slice(0, 12))) fark.push(`satır ${i + 1} ad: belge "${s.metin}" / okunan "${o.metin}"`);
  });
  sonuc[ad] = { fark, okunan: { no: r.fatura_no, ted: r.tedarikci, tarih: r.tarih, toplamlar: r.toplamlar, notlar: r.notlar } };
  console.log(ad, fark.length ? `✗ ${fark.length} fark` : '✓ birebir', fark.slice(0, 8));
}
writeFileSync(new URL('./cikti/belge/pdf-metin.json', import.meta.url), JSON.stringify(sonuc, null, 1));
