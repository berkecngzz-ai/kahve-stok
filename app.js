import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { dosyaTuru, dosyaOzeti, xmlDosyaOku, pdfOku, fotolariOku, toplamKontrol, aiSonucunuCevir } from './okuma.js';
import { anahtar, siniflandir, aiIleSiniflandir, carpanBul } from './eslestirme.js';
import { cevapAnahtariniOku, anahtarBelgesi, karsilastir } from './okuma-testi.js';

const app = document.getElementById('app');
const ustSag = document.getElementById('ust-sag');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Supabase'den gelen İngilizce hataları Türkçeye çevirir.
function hataMetni(err) {
  const m = err?.message || String(err);
  const tablo = [
    ['Invalid login credentials', 'E-posta veya şifre yanlış.'],
    ['User already registered', 'Bu e-posta ile zaten bir hesap var. Giriş yap.'],
    ['Password should be at least', 'Şifre en az 6 karakter olmalı.'],
    ['Email not confirmed', 'E-posta adresin henüz onaylanmamış. Gelen kutunu kontrol et.'],
    ['Unable to validate email', 'E-posta adresi geçersiz.'],
    ['rate limit', 'Çok fazla deneme yapıldı. Biraz bekleyip tekrar dene.'],
    ['Failed to fetch', 'İnternet bağlantısı yok ya da sunucuya ulaşılamıyor.'],
    ['malzemeler_ad_uniq', 'Bu adla bir malzeme zaten var. Pasif malzemeler arasında olabilir; oradan tekrar aktif edebilirsin.'],
    ['urunler_ad_uniq', 'Bu adla bir ürün zaten var.'],
    ['exceeded the maximum allowed size', 'Dosya çok büyük (en fazla 5 MB).'],
    ['mime type', 'Bu dosya türü yüklenemez. Fotoğraf ya da PDF seç.'],
    ['Bucket not found', 'Belge deposu henüz kurulmamış. Patrona haber ver.'],
    ['row-level security', 'Bu işlemi yapma yetkin yok.'],
    ['permission denied', 'Bu işlemi yapma yetkin yok.'],
  ];
  const bulunan = tablo.find(([en]) => m.toLowerCase().includes(en.toLowerCase()));
  return bulunan ? bulunan[1] : m;
}

if (!SUPABASE_URL.startsWith('https://')) {
  app.innerHTML = `<div class="kart"><h2>Kurulum eksik</h2>
    <p class="bilgi">config.js dosyasına Supabase bilgileri henüz girilmemiş.</p></div>`;
  throw new Error('config.js eksik');
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// Bir formu gönderirken düğmeyi kilitler ve hatayı formun altında gösterir.
function formBagla(form, isle) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    const kutu = form.querySelector('.mesaj');
    kutu.className = 'mesaj'; kutu.textContent = '';
    btn.disabled = true;
    try {
      await isle(Object.fromEntries(new FormData(form)), kutu);
    } catch (err) {
      kutu.className = 'mesaj hata'; kutu.textContent = hataMetni(err);
    } finally {
      btn.disabled = false;
    }
  });
}

async function cikis() {
  aktifSekme = 'giris';
  await sb.auth.signOut();
  goster();
}

// ---------- Ekranlar ----------

function girisEkrani(sekme = 'giris') {
  ustSag.innerHTML = '';
  const kayit = sekme === 'kayit';
  app.innerHTML = `
    <div class="sekmeler">
      <button data-sekme="giris" class="${kayit ? '' : 'secili'}">Giriş yap</button>
      <button data-sekme="kayit" class="${kayit ? 'secili' : ''}">Hesap aç</button>
    </div>
    <form class="kart">
      <label for="eposta">E-posta</label>
      <input id="eposta" name="eposta" type="email" autocomplete="email" required>
      <label for="sifre">Şifre</label>
      <input id="sifre" name="sifre" type="password" minlength="6" required
        autocomplete="${kayit ? 'new-password' : 'current-password'}">
      <button class="tam" type="submit">${kayit ? 'Hesap aç' : 'Giriş yap'}</button>
      <p class="mesaj"></p>
    </form>`;
  app.querySelectorAll('[data-sekme]').forEach((b) =>
    b.addEventListener('click', () => girisEkrani(b.dataset.sekme)));
  formBagla(app.querySelector('form'), async ({ eposta, sifre }, kutu) => {
    if (kayit) {
      const { data, error } = await sb.auth.signUp({ email: eposta.trim(), password: sifre });
      if (error) throw error;
      if (!data.session) {
        kutu.className = 'mesaj tamam';
        kutu.textContent = 'Hesap açıldı. E-postana gelen onay bağlantısına tıkla, sonra giriş yap.';
        return;
      }
    } else {
      const { error } = await sb.auth.signInWithPassword({ email: eposta.trim(), password: sifre });
      if (error) throw error;
    }
    goster();
  });
}

function mekanSecEkrani(user) {
  app.innerHTML = `
    <p class="bilgi">${esc(user.email)} olarak giriş yaptın. Bu hesap henüz bir mekana bağlı değil.</p>
    <form class="kart" id="katil">
      <h2>Baristayım: davet koduyla katıl</h2>
      <p class="bilgi">Kodu patronundan iste.</p>
      <label for="kod">Davet kodu</label>
      <input id="kod" name="kod" autocapitalize="characters" autocomplete="off" required>
      <label for="ad1">Adın</label>
      <input id="ad1" name="ad" autocomplete="name" required>
      <button class="tam" type="submit">Mekana katıl</button>
      <p class="mesaj"></p>
    </form>
    <form class="kart" id="olustur">
      <h2>Patronum: mekanımı oluştur</h2>
      <label for="mekan">Mekan adı</label>
      <input id="mekan" name="mekan" required>
      <label for="ad2">Adın</label>
      <input id="ad2" name="ad" autocomplete="name" required>
      <button class="tam" type="submit">Mekanı oluştur</button>
      <p class="mesaj"></p>
    </form>`;
  formBagla(app.querySelector('#katil'), async ({ kod, ad }) => {
    const { error } = await sb.rpc('mekana_katil', { p_kod: kod, p_ad: ad });
    if (error) throw error;
    goster();
  });
  formBagla(app.querySelector('#olustur'), async ({ mekan, ad }) => {
    const { error } = await sb.rpc('mekan_olustur', { p_mekan_ad: mekan, p_ad: ad });
    if (error) throw error;
    goster();
  });
}

// Açık olan sekme. Ekran yenilense de korunur.
let aktifSekme = 'giris';
// Giriş yapan kişinin mekanı: id ve raporlarda KDV gösterimi ('dahil' | 'haric').
let mekan = { id: null, kdv_gosterim: 'dahil' };
// Giriş yapan kişi kurulum (servis) hesabı mı?
let kurulumcu = false;

async function anaEkran(user, uye) {
  const patron = uye.rol === 'patron';
  mekan = { id: uye.mekan_id, kdv_gosterim: uye.mekanlar.kdv_gosterim ?? 'dahil' };
  if (!patron) return baristaEkrani(user, uye);
  const sekmeler = [['giris', 'Girişler'], ['malzeme', 'Malzeme'], ['urun', 'Ürünler'], ['mekan', 'Mekan']];
  if (kurulumcu) sekmeler.push(['kurulum', 'Kurulum']);
  if (aktifSekme === 'kurulum' && !kurulumcu) aktifSekme = 'giris';
  app.innerHTML = `
    <h1>${esc(uye.mekanlar.ad)}</h1>
    <p><span class="rozet">Patron</span> ${esc(uye.ad)}</p>
    <div class="sekmeler ${sekmeler.length > 4 ? 'bes' : 'dort'}">
      ${sekmeler.map(([k, ad]) =>
        `<button data-sekme="${k}" class="${aktifSekme === k ? 'secili' : ''}">${ad}</button>`).join('')}
    </div>
    <div id="icerik"><p class="bilgi">Yükleniyor…</p></div>`;
  app.querySelectorAll('[data-sekme]').forEach((b) => b.addEventListener('click', () => {
    aktifSekme = b.dataset.sekme;
    goster();
  }));
  const icerik = app.querySelector('#icerik');
  if (aktifSekme === 'malzeme') return malzemeSekmesi(icerik, patron);
  if (aktifSekme === 'urun') return urunSekmesi(icerik, patron);
  if (aktifSekme === 'mekan') return mekanSekmesi(icerik, user, uye, patron);
  if (aktifSekme === 'kurulum') return kurulumEkrani(icerik);
  return girisSekmesi(icerik, user, patron);
}

async function mekanSekmesi(icerik, user, uye, patron) {
  const [{ data: uyeler, error }, okuma] = await Promise.all([
    sb.from('uyeler').select('user_id, ad, rol, eposta').order('olusturma'),
    sb.rpc('ai_okuma_durumu'),
  ]);
  if (error) throw error;
  const okumaDurumu = okuma.data?.[0];

  icerik.innerHTML = `
    ${patron ? `
    <div class="kart">
      <h2>Barista davet kodu</h2>
      <p class="bilgi">Baristan "Hesap aç" dedikten sonra bu kodu girerek mekanına katılır.</p>
      <div class="kod">${esc(uye.mekanlar.davet_kodu)}</div>
      <button class="ikincil kucuk" id="yenile">Kodu yenile</button>
      <p class="bilgi">Kodu yenilersen eski kod çalışmaz. Birini çıkardıktan sonra yenilemen iyi olur.</p>
      <p class="mesaj"></p>
    </div>` : ''}
    ${okumaDurumu ? `<div class="kart"><h2>Fatura okuma (AI)</h2>
      <p class="bilgi">Bugün <b>${okumaDurumu.bugun} / ${okumaDurumu.sinir}</b> okuma kullanıldı. Sınır dolarsa telefondaki
        yedek okuyucu çalışır. XML ve PDF faturalar sınırdan düşmez.</p></div>` : ''}
    <div class="kart">
      <h2>Fiyat gösterimi</h2>
      <p class="bilgi">Ekranlarda ve raporlarda fiyatlar ${kdvHaric() ? '<b>KDV hariç</b>' : '<b>KDV dahil</b>'} gösteriliyor.
        Kayıtlı veriler değişmez; ikisi de saklanır.</p>
      ${patron ? `<div class="sekmeler">
        <button data-kdv="dahil" class="${kdvHaric() ? '' : 'secili'}">KDV dahil</button>
        <button data-kdv="haric" class="${kdvHaric() ? 'secili' : ''}">KDV hariç</button></div>` : ''}
    </div>
    <div class="kart">
      <h2>Mekandaki kişiler</h2>
      ${uyeler.map((u) => `
        <div class="satir">
          <div>${esc(u.ad)} <span class="rozet">${u.rol === 'patron' ? 'Patron' : 'Barista'}</span>
            <small>${esc(u.eposta)}</small></div>
          ${patron && u.user_id !== user.id
            ? `<button class="ikincil kucuk" data-cikar="${esc(u.user_id)}" data-ad="${esc(u.ad)}">Çıkar</button>` : ''}
        </div>`).join('')}
    </div>`;

  icerik.querySelectorAll('[data-kdv]').forEach((b) => b.addEventListener('click', async () => {
    if (b.dataset.kdv === mekan.kdv_gosterim) return;
    b.disabled = true;
    const { error } = await sb.rpc('kdv_gosterim_ayarla', { p_deger: b.dataset.kdv });
    if (error) { hataGoster(error); b.disabled = false; return; }
    goster();
  }));
  icerik.querySelector('#yenile')?.addEventListener('click', async (e) => {
    if (!confirm('Davet kodu yenilensin mi? Eski kod artık çalışmayacak.')) return;
    e.target.disabled = true;
    const { error } = await sb.rpc('davet_kodu_yenile');
    if (error) { alert(hataMetni(error)); e.target.disabled = false; return; }
    goster();
  });
  icerik.querySelectorAll('[data-cikar]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(`${b.dataset.ad} mekandan çıkarılsın mı?`)) return;
    const { error } = await sb.rpc('uye_cikar', { p_user_id: b.dataset.cikar });
    if (error) { alert(hataMetni(error)); return; }
    goster();
  }));
}

// ---------- Malzemeler ve ürünler ----------

// Tarifler g/ml/adet ile yazılır; fiyat kg/litre/adet başına girilir.
const BIRIMLER = {
  g: { fiyatBirimi: 'kg', bolen: 1000, ad: 'Gram (kahve, şeker…)' },
  ml: { fiyatBirimi: 'litre', bolen: 1000, ad: 'Mililitre (süt, şurup…)' },
  adet: { fiyatBirimi: 'adet', bolen: 1, ad: 'Adet (bardak, kapak…)' },
};
const tl = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' });
const sayiYaz = (n) => new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 3 }).format(n);
const adaGore = (a, b) => a.ad.localeCompare(b.ad, 'tr');
const hataGoster = (err) => alert(hataMetni(err));

// "42,50", "42.5", "1.200" (bin iki yüz) ya da "1.250,75" gibi yazılan sayıyı okur; okunamazsa NaN döner.
function sayiOku(s) {
  let t = String(s ?? '').replace(/\s/g, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');   // nokta binlik ayırıcı
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
}

// Malzemeler. Fiyatlar veritabanında yalnız patrona açık (malzeme_fiyatlari); barista adları ve birimleri görür.
async function malzemeleriGetir(fiyatli = true) {
  const [mr, fr] = await Promise.all([
    sb.from('malzemeler').select('id, ad, birim, aktif'),
    fiyatli ? sb.rpc('malzeme_fiyatlari') : Promise.resolve({ data: [] }),
  ]);
  if (mr.error) throw mr.error;
  if (fr.error) throw fr.error;
  const fiyat = new Map(fr.data.map((f) => [f.id, f]));
  return mr.data.map((m) => ({ fiyat: 0, fiyat_haric: null, kdv_orani: null, ...m, ...fiyat.get(m.id) })).sort(adaGore);
}

// ---------- KDV ----------
// Veritabanında: fiyat = KDV dahil, fiyat_haric + kdv_orani ayrı. Eski kayıtlarda oran yok (yalnız KDV dahil bilinir).
const KDV_ORANLARI = [0, 1, 10, 20];
const kdvHaric = () => mekan.kdv_gosterim === 'haric';
const kdvEtiketi = () => (kdvHaric() ? 'KDV hariç' : 'KDV dahil');
const oranYaz = (oran) => (oran == null ? 'oran yok' : `%${sayiYaz(Number(oran))}`);
const yuvarla = (n, basamak = 2) => Math.round(n * 10 ** basamak) / 10 ** basamak;

// Ayara göre gösterilecek tutar. Hariç isteniyor ama bilinmiyorsa KDV dahil tutar döner, bilinmiyor = true.
function kdvliTutar(dahil, haric) {
  if (kdvHaric() && haric == null) return { deger: Number(dahil), bilinmiyor: true };
  return { deger: Number(kdvHaric() ? haric : dahil), bilinmiyor: false };
}
// "45,00 ₺ · KDV dahil · %1" gibi tek satırlık fiyat yazısı.
function fiyatYazisi(dahil, haric, oran) {
  const t = kdvliTutar(dahil, haric);
  return `${tl.format(t.deger)} · ${t.bilinmiyor ? 'KDV dahil (hariç bilinmiyor)' : kdvEtiketi()} · ${oranYaz(oran)}`;
}

// Satır güncellendi mi kontrol eder (yetki yoksa veritabanı sessizce 0 satır günceller).
async function guncelle(tablo, id, alanlar) {
  const { data, error } = await sb.from(tablo).update(alanlar).eq('id', id).select('id');
  if (error) throw error;
  if (!data.length) throw new Error('Kaydedilemedi. Sayfayı yenileyip tekrar dene.');
}

async function malzemeSekmesi(icerik, patron, duzenlenen = null) {
  const malzemeler = await malzemeleriGetir();
  const aktifler = malzemeler.filter((m) => m.aktif);
  const pasifler = malzemeler.filter((m) => !m.aktif);
  const d = duzenlenen;
  const satir = (m) => `
    <div class="satir">
      <div class="genis">${esc(m.ad)}
        <small>${Number(m.fiyat) > 0
          ? `1 ${BIRIMLER[m.birim].fiyatBirimi}: ${fiyatYazisi(m.fiyat, m.fiyat_haric, m.kdv_orani)}`
          : '<span class="uyari">Fiyat girilmemiş</span>'}</small>
        <details class="gecmis" data-gecmis="${esc(m.id)}"><summary>Fiyat geçmişi</summary>
          <div><p class="bilgi">Yükleniyor…</p></div></details></div>
      ${!patron ? '' : m.aktif
        ? `<span class="dugmeler">
            <button class="ikincil kucuk" data-duzenle="${esc(m.id)}">Düzenle</button>
            <button class="ikincil kucuk" data-aktif="${esc(m.id)}" data-deger="0">Pasife al</button></span>`
        : `<button class="ikincil kucuk" data-aktif="${esc(m.id)}" data-deger="1">Aktif et</button>`}
    </div>`;

  icerik.innerHTML = `
    ${patron ? `
    <form class="kart" id="malzeme-form">
      <h2>${d ? 'Malzemeyi düzenle' : 'Yeni malzeme'}</h2>
      <label for="m-ad">Adı</label>
      <input id="m-ad" name="ad" maxlength="60" required value="${esc(d?.ad)}" placeholder="Örn. Tam yağlı süt">
      <label for="m-birim">Birimi</label>
      <select id="m-birim" name="birim" ${d ? 'disabled' : ''}>
        ${Object.entries(BIRIMLER).map(([k, b]) =>
          `<option value="${k}" ${d?.birim === k ? 'selected' : ''}>${b.ad}</option>`).join('')}
      </select>
      ${d ? '<p class="bilgi">Birim sonradan değiştirilemez.</p>' : ''}
      <label for="m-fiyat" id="m-fiyat-etiket"></label>
      <input id="m-fiyat" name="fiyat" inputmode="decimal" autocomplete="off" required
        value="${d ? esc(String(d.kdv_orani != null && kdvHaric() ? yuvarla(Number(d.fiyat_haric)) : d.fiyat).replace('.', ',')) : ''}"
        placeholder="Örn. 42,50">
      <div class="iki">
        <div><label for="m-dahil">Bu fiyat</label>
          <select id="m-dahil" name="dahil">
            <option value="1" ${d?.kdv_orani != null && kdvHaric() ? '' : 'selected'}>KDV dahil</option>
            <option value="0" ${d?.kdv_orani != null && kdvHaric() ? 'selected' : ''}>KDV hariç</option>
          </select></div>
        <div><label for="m-oran">KDV oranı</label>
          <select id="m-oran" name="oran" required>
            <option value="">Seç</option>
            ${KDV_ORANLARI.map((o) => `<option value="${o}" ${d?.kdv_orani != null && Number(d.kdv_orani) === o
              ? 'selected' : ''}>%${o}</option>`).join('')}
          </select></div>
      </div>
      ${d && d.kdv_orani == null ? '<p class="bilgi">Bu malzemenin KDV oranı daha önce girilmemiş. Oranı seçip kaydet.</p>' : ''}
      <button class="tam" type="submit">${d ? 'Kaydet' : 'Malzemeyi ekle'}</button>
      ${d ? '<button class="tam ikincil" type="button" id="vazgec">Vazgeç</button>' : ''}
      <p class="mesaj"></p>
    </form>` : ''}
    <div class="kart">
      <h2>Malzemeler (${aktifler.length})</h2>
      ${aktifler.length ? aktifler.map(satir).join('')
        : `<p class="bilgi">Henüz malzeme yok.${patron ? '' : ' Malzemeleri patron ekler.'}</p>`}
      ${pasifler.length ? `<details><summary>Pasif malzemeler (${pasifler.length})</summary>
        ${pasifler.map(satir).join('')}</details>` : ''}
    </div>`;

  icerik.querySelectorAll('[data-gecmis]').forEach((det) =>
    det.addEventListener('toggle', () => { if (det.open) fiyatGecmisiAc(det); }));
  if (!patron) return;
  const form = icerik.querySelector('#malzeme-form');
  const birimSec = form.querySelector('#m-birim');
  const etiketYaz = () => {
    form.querySelector('#m-fiyat-etiket').textContent = `1 ${BIRIMLER[birimSec.value].fiyatBirimi} fiyatı (TL)`;
  };
  birimSec.addEventListener('change', etiketYaz);
  etiketYaz();
  form.querySelector('#vazgec')?.addEventListener('click', () => malzemeSekmesi(icerik, patron).catch(hataGoster));
  formBagla(form, async ({ ad, birim, fiyat, dahil, oran }) => {
    const f = sayiOku(fiyat);
    if (!Number.isFinite(f) || f >= 10000000) throw new Error('Fiyatı sayı olarak yaz. Örn. 42,50');
    if (oran === '') throw new Error('KDV oranını seç.');
    const o = Number(oran);
    // Her zaman KDV hariç fiyat + oran saklanır; KDV dahil fiyatı veritabanı hesaplar.
    const kayit = { ad: ad.trim(), kdv_orani: o, fiyat_haric: yuvarla(dahil === '1' ? f / (1 + o / 100) : f, 4) };
    if (d) {
      await guncelle('malzemeler', d.id, kayit);
    } else {
      const { error } = await sb.from('malzemeler').insert({ ...kayit, birim });
      if (error) throw error;
    }
    await malzemeSekmesi(icerik, patron);
  });

  icerik.querySelectorAll('[data-duzenle]').forEach((b) => b.addEventListener('click', () => {
    const m = malzemeler.find((x) => x.id === b.dataset.duzenle);
    malzemeSekmesi(icerik, patron, m).then(() => window.scrollTo(0, 0)).catch(hataGoster);
  }));
  icerik.querySelectorAll('[data-aktif]').forEach((b) => b.addEventListener('click', async () => {
    const m = malzemeler.find((x) => x.id === b.dataset.aktif);
    const aktif = b.dataset.deger === '1';
    if (!aktif && !confirm(`${m.ad} pasife alınsın mı? Yeni tariflere eklenemez; mevcut tariflerde kalır.`)) return;
    b.disabled = true;
    try {
      await guncelle('malzemeler', m.id, { aktif });
      await malzemeSekmesi(icerik, patron);
    } catch (err) { hataGoster(err); b.disabled = false; }
  }));
}

// Bir tarifin maliyetini ve eksiklerini hesaplar.
function tarifMaliyeti(kalemler, malzemeBul) {
  let toplam = 0, fiyatsiz = false, pasif = false, haricBilinmiyor = false;
  for (const k of kalemler) {
    const m = malzemeBul.get(k.malzeme_id);
    const miktar = sayiOku(k.miktar);
    if (!m || !(miktar > 0)) continue;
    const f = kdvliTutar(m.fiyat, m.fiyat_haric);
    toplam += (miktar * f.deger) / BIRIMLER[m.birim].bolen;
    if (f.bilinmiyor) haricBilinmiyor = true;
    if (!(Number(m.fiyat) > 0)) fiyatsiz = true;
    if (!m.aktif) pasif = true;
  }
  return `Maliyet: ${tl.format(toplam)} (${kdvEtiketi()})`
    + (haricBilinmiyor ? ' <span class="uyari">· bazı malzemelerin KDV oranı yok, KDV dahil fiyatı kullanıldı</span>' : '')
    + (fiyatsiz ? ' <span class="uyari">· fiyatı girilmemiş malzeme var</span>' : '')
    + (pasif ? ' <span class="uyari">· pasif malzeme içeriyor</span>' : '');
}

async function urunSekmesi(icerik, patron, taslak = null) {
  const [malzemeler, ur, tk] = await Promise.all([
    malzemeleriGetir(),
    sb.from('urunler').select('id, ad, aktif'),
    sb.from('tarif_kalemleri').select('urun_id, malzeme_id, miktar'),
  ]);
  if (ur.error) throw ur.error;
  if (tk.error) throw tk.error;
  const malzemeBul = new Map(malzemeler.map((m) => [m.id, m]));
  const urunler = ur.data.sort(adaGore).map((u) => ({
    ...u, kalemler: tk.data.filter((k) => k.urun_id === u.id).map((k) => ({ ...k, miktar: String(k.miktar) })),
  }));
  const aktifMalzemeVar = malzemeler.some((m) => m.aktif);

  const satir = (u) => `
    <div class="satir">
      <div>${esc(u.ad)}
        <small>${u.kalemler.map((k) => {
          const m = malzemeBul.get(k.malzeme_id);
          return m ? `${sayiYaz(Number(k.miktar))} ${m.birim} ${esc(m.ad)}` : '';
        }).join(' · ')}</small>
        <small>${tarifMaliyeti(u.kalemler, malzemeBul)}</small></div>
      ${!patron ? '' : u.aktif
        ? `<span class="dugmeler">
            <button class="ikincil kucuk" data-duzenle="${esc(u.id)}">Düzenle</button>
            <button class="ikincil kucuk" data-aktif="${esc(u.id)}" data-deger="0">Pasife al</button></span>`
        : `<button class="ikincil kucuk" data-aktif="${esc(u.id)}" data-deger="1">Aktif et</button>`}
    </div>`;
  const aktifler = urunler.filter((u) => u.aktif);
  const pasifler = urunler.filter((u) => !u.aktif);

  icerik.innerHTML = `
    ${patron && taslak ? '<div id="editor"></div>' : ''}
    ${patron && !taslak ? (aktifMalzemeVar
      ? '<button class="tam" id="yeni-urun">+ Yeni ürün ekle</button><p></p>'
      : '<div class="kart"><p class="bilgi">Ürün eklemeden önce Malzemeler sekmesinden malzeme ekle.</p></div>') : ''}
    <div class="kart">
      <h2>Ürünler (${aktifler.length})</h2>
      <p class="bilgi">Her ürünün yanında 1 adedinin içine giren malzemeler yazar.</p>
      ${aktifler.length ? aktifler.map(satir).join('')
        : `<p class="bilgi">Henüz ürün yok.${patron ? '' : ' Ürünleri patron ekler.'}</p>`}
      ${pasifler.length ? `<details><summary>Pasif ürünler (${pasifler.length})</summary>
        ${pasifler.map(satir).join('')}</details>` : ''}
    </div>`;

  if (!patron) return;
  icerik.querySelector('#yeni-urun')?.addEventListener('click', () =>
    urunSekmesi(icerik, patron, { id: null, ad: '', kalemler: [{ malzeme_id: '', miktar: '' }] }).catch(hataGoster));
  icerik.querySelectorAll('[data-duzenle]').forEach((b) => b.addEventListener('click', () => {
    const u = urunler.find((x) => x.id === b.dataset.duzenle);
    urunSekmesi(icerik, patron, { id: u.id, ad: u.ad, kalemler: u.kalemler.map((k) => ({ ...k })) })
      .then(() => window.scrollTo(0, 0)).catch(hataGoster);
  }));
  icerik.querySelectorAll('[data-aktif]').forEach((b) => b.addEventListener('click', async () => {
    const u = urunler.find((x) => x.id === b.dataset.aktif);
    const aktif = b.dataset.deger === '1';
    if (!aktif && !confirm(`${u.ad} pasife alınsın mı? Menüden kalkmış gibi davranır; istersen tekrar aktif edebilirsin.`)) return;
    b.disabled = true;
    try {
      await guncelle('urunler', u.id, { aktif });
      await urunSekmesi(icerik, patron);
    } catch (err) { hataGoster(err); b.disabled = false; }
  }));
  if (taslak) urunEditoru(icerik.querySelector('#editor'), taslak, malzemeler, malzemeBul,
    () => urunSekmesi(icerik, patron));
}

// Ürün adı + tarif satırları. Kaydedince ya da vazgeçince bitti() çağrılır.
function urunEditoru(kutu, taslak, malzemeler, malzemeBul, bitti) {
  kutu.innerHTML = `
    <form class="kart" id="urun-form">
      <h2>${taslak.id ? 'Ürünü düzenle' : 'Yeni ürün'}</h2>
      <label for="u-ad">Ürün adı</label>
      <input id="u-ad" name="ad" maxlength="60" required value="${esc(taslak.ad)}" placeholder="Örn. Latte (büyük)">
      <label>Tarif: 1 adet satılınca ne harcanıyor?</label>
      <div id="kalemler"></div>
      <button class="ikincil kucuk" type="button" id="kalem-ekle">+ Malzeme ekle</button>
      <p class="bilgi" id="taslak-maliyet"></p>
      <button class="tam" type="submit">Kaydet</button>
      <button class="tam ikincil" type="button" id="vazgec">Vazgeç</button>
      <p class="mesaj"></p>
    </form>`;
  const form = kutu.querySelector('form');
  const liste = form.querySelector('#kalemler');
  const maliyetYaz = () => { form.querySelector('#taslak-maliyet').innerHTML = tarifMaliyeti(taslak.kalemler, malzemeBul); };

  const kalemleriCiz = () => {
    liste.innerHTML = taslak.kalemler.map((k, i) => {
      // Seçilebilenler: aktif malzemeler + bu satırda zaten seçili olan (pasif olsa bile).
      const secenekler = malzemeler.filter((m) => m.aktif || m.id === k.malzeme_id);
      const birim = malzemeBul.get(k.malzeme_id)?.birim ?? '';
      return `
        <div class="tarif-satir">
          <select data-i="${i}" aria-label="Malzeme">
            <option value="">Malzeme seç</option>
            ${secenekler.map((m) => `<option value="${esc(m.id)}" ${m.id === k.malzeme_id ? 'selected' : ''}>
              ${esc(m.ad)}${m.aktif ? '' : ' (pasif)'}</option>`).join('')}
          </select>
          <input data-i="${i}" inputmode="decimal" autocomplete="off" aria-label="Miktar"
            value="${esc(k.miktar).replace('.', ',')}" placeholder="Miktar">
          <span class="birim">${birim}</span>
          <button class="ikincil kucuk" type="button" data-sil="${i}" aria-label="Satırı sil">✕</button>
        </div>`;
    }).join('');
    liste.querySelectorAll('select').forEach((s) => s.addEventListener('change', () => {
      taslak.kalemler[s.dataset.i].malzeme_id = s.value;
      kalemleriCiz();
    }));
    liste.querySelectorAll('input').forEach((inp) => inp.addEventListener('input', () => {
      taslak.kalemler[inp.dataset.i].miktar = inp.value;
      maliyetYaz();
    }));
    liste.querySelectorAll('[data-sil]').forEach((b) => b.addEventListener('click', () => {
      taslak.kalemler.splice(Number(b.dataset.sil), 1);
      kalemleriCiz();
    }));
    maliyetYaz();
  };
  kalemleriCiz();

  form.querySelector('#kalem-ekle').addEventListener('click', () => {
    taslak.kalemler.push({ malzeme_id: '', miktar: '' });
    kalemleriCiz();
  });
  form.querySelector('#vazgec').addEventListener('click', () => bitti().catch(hataGoster));
  formBagla(form, async ({ ad }) => {
    const dolu = taslak.kalemler.filter((k) => k.malzeme_id || String(k.miktar).trim());
    if (!dolu.length) throw new Error('Tarife en az bir malzeme ekle.');
    const kalemler = dolu.map((k) => {
      if (!k.malzeme_id) throw new Error('Her satırda bir malzeme seç ya da boş satırı sil.');
      const miktar = sayiOku(k.miktar);
      if (!(miktar > 0) || miktar >= 100000) {
        throw new Error(`${malzemeBul.get(k.malzeme_id).ad} için miktarı sayı olarak yaz. Örn. 18`);
      }
      return { malzeme_id: k.malzeme_id, miktar };
    });
    if (new Set(kalemler.map((k) => k.malzeme_id)).size !== kalemler.length) {
      throw new Error('Aynı malzeme iki satırda var. Tek satırda topla.');
    }
    const { error } = await sb.rpc('urun_kaydet', { p_id: taslak.id, p_ad: ad, p_kalemler: kalemler });
    if (error) throw error;
    await bitti();
  });
}

// ---------- Fiyat geçmişi ----------

const KAYNAKLAR = { baslangic: 'İlk kayıt', elle: 'Elle değiştirildi', fatura: 'Faturadan' };

// Türkiye saatine göre bugün (YYYY-AA-GG).
const bugunStr = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date());
const tarihYaz = (t) => new Date(`${t}T12:00:00`).toLocaleDateString('tr-TR',
  { day: 'numeric', month: 'long', year: 'numeric', weekday: 'short' });
const zamanYaz = (ts) => new Date(ts).toLocaleString('tr-TR',
  { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const gunu = (ts) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date(ts));

// Bir malzemenin fiyat geçmişini, kutu ilk açıldığında yükler (en yeni 100 kayıt).
async function fiyatGecmisiAc(det) {
  if (det.dataset.yuklendi) return;
  det.dataset.yuklendi = '1';
  const kutu = det.querySelector('div');
  try {
    const { data, error } = await sb.from('fiyat_gecmisi')
      .select('fiyat, fiyat_haric, kdv_orani, tarih, kaynak, degistiren_ad, giris_id')
      .eq('malzeme_id', det.dataset.gecmis)
      .order('tarih', { ascending: false }).order('zaman', { ascending: false }).limit(100);
    if (error) throw error;
    const ids = [...new Set(data.map((f) => f.giris_id).filter(Boolean))];
    let iptaller = new Set();
    if (ids.length) {
      const r = await sb.from('girisler').select('id').in('id', ids).not('iptal_zamani', 'is', null);
      if (r.error) throw r.error;
      iptaller = new Set(r.data.map((g) => g.id));
    }
    kutu.innerHTML = data.length ? data.map((f) => {
      const iptal = iptaller.has(f.giris_id);
      return `<div class="gecmis-satir${iptal ? ' iptal' : ''}">${tarihYaz(f.tarih)} ·
        <b>${fiyatYazisi(f.fiyat, f.fiyat_haric, f.kdv_orani)}</b> · ${KAYNAKLAR[f.kaynak]}${f.degistiren_ad ? ` (${esc(f.degistiren_ad)})` : ''}${iptal ? ' · fatura iptal edildi' : ''}</div>`;
    }).join('') : '<p class="bilgi">Henüz kayıt yok.</p>';
  } catch (err) {
    delete det.dataset.yuklendi;
    kutu.innerHTML = `<p class="hata">${esc(hataMetni(err))}</p>`;
  }
}

// ---------- Girişler: fatura, satış, fire, sayım ----------

const TURLER = {
  fatura: { ad: 'Fatura', dugme: 'Fatura gir' },
  satis: { ad: 'Satış', dugme: 'Satış gir', not: 'Gün sonu kasa raporundaki adetleri yaz. Satılmayanı boş bırak.' },
  fire: { ad: 'Fire', dugme: 'Fire gir', not: 'Dökülen, bozulan ya da yanlış yapılanları gir.' },
  sayim: { ad: 'Sayım', dugme: 'Sayım gir', not: 'Elde kalan miktarı yaz. Saymadığın malzemeyi boş bırak.' },
};
const FIRE_SEBEPLERI = ['Döküldü', 'Bozuldu / tarihi geçti', 'Yanlış yapıldı', 'Deneme / tadım', 'Diğer'];

// Gösterim: g/ml veritabanında, ekranda kg/litre.
const buyukMiktar = (miktar, birim) =>
  `${sayiYaz(Number(miktar) / BIRIMLER[birim].bolen)} ${BIRIMLER[birim].fiyatBirimi}`;
// Ekrandan gelen kg/litre/adet miktarını g/ml/adet'e çevirir.
const kucukMiktar = (miktar, birim) => Math.round(miktar * BIRIMLER[birim].bolen * 1000) / 1000;

let secilenAy = null;   // Geçmişte gösterilen ay (YYYY-AA)

async function girisSekmesi(icerik, user, patron) {
  secilenAy ??= bugunStr().slice(0, 7);
  const [y, a] = secilenAy.split('-').map(Number);
  const sonraki = a === 12 ? `${y + 1}-01-01` : `${y}-${String(a + 1).padStart(2, '0')}-01`;

  const [malzemeler, ur, gr] = await Promise.all([
    malzemeleriGetir(),
    sb.from('urunler').select('id, ad, aktif'),
    sb.from('girisler').select('*').gte('tarih', `${secilenAy}-01`).lt('tarih', sonraki)
      .order('tarih', { ascending: false }).order('olusturma', { ascending: false }).limit(1000),
  ]);
  if (ur.error) throw ur.error;
  if (gr.error) throw gr.error;
  const girisler = gr.data;
  // Satırları 100'erli gruplar halinde çek (adres çok uzamasın diye).
  const kalemler = [];
  const belgeler = [];
  for (let i = 0; i < girisler.length; i += 100) {
    const idler = girisler.slice(i, i + 100).map((g) => g.id);
    const [kr, br] = await Promise.all([
      sb.from('giris_kalemleri')
        .select('giris_id, malzeme_id, urun_id, miktar, tutar, tutar_kdv_haric, kdv_orani, stok_disi, satir_metni')
        .in('giris_id', idler).order('id'),
      sb.from('giris_belgeleri').select('giris_id, yol, tur').in('giris_id', idler).order('id'),
    ]);
    if (kr.error) throw kr.error;
    if (br.error) throw br.error;
    kalemler.push(...kr.data);
    belgeler.push(...br.data);
    // "Mal geldi" ile okunan faturaların dosyaları belge_dosyalari'nda
    const okunan = await sb.from('belgeler').select('id, giris_id').in('giris_id', idler);
    if (okunan.error) throw okunan.error;
    if (okunan.data.length) {
      const dr = await sb.from('belge_dosyalari').select('belge_id, yol, tur').in('belge_id', okunan.data.map((b) => b.id));
      if (dr.error) throw dr.error;
      const girisi = new Map(okunan.data.map((b) => [b.id, b.giris_id]));
      belgeler.push(...dr.data.map((d) => ({ giris_id: girisi.get(d.belge_id), yol: d.yol, tur: d.tur === 'foto' ? 'foto' : 'pdf' })));
    }
  }
  const [eksik] = await rpcVeri('eksik_belge_ozeti');
  const malzemeBul = new Map(malzemeler.map((m) => [m.id, m]));
  const urunBul = new Map(ur.data.map((u) => [u.id, u]));
  const ctx = { user, patron, malzemeler, malzemeBul, urunler: ur.data.sort(adaGore), urunBul };

  // Fatura satırında tutar: ayara göre KDV dahil/hariç + oran. Eski satırlarda yalnız KDV dahil bilinir.
  const tutarYaz = (k) => (k.tutar == null ? ''
    : ` · ${tl.format(kdvliTutar(k.tutar, k.tutar_kdv_haric).deger)} (${oranYaz(k.kdv_orani)})`);
  const kalemYaz = (k) => {
    if (k.stok_disi) return `${esc(k.satir_metni)} <i>(stoğa eklenmedi)</i>${tutarYaz(k)}`;
    if (k.urun_id) return `${esc(urunBul.get(k.urun_id)?.ad ?? '?')} × ${sayiYaz(Number(k.miktar))}`;
    const m = malzemeBul.get(k.malzeme_id);
    if (!m) return '?';
    return `${esc(m.ad)}: ${buyukMiktar(k.miktar, m.birim)}${tutarYaz(k)}`;
  };
  // Faturanın toplamı ayara göre: faturadaki genel/KDV hariç toplam, yoksa satırların toplamı.
  const faturaToplami = (g, satirlar) => {
    const dahil = g.belge_genel_toplam ?? satirlar.reduce((t, k) => t + Number(k.tutar ?? 0), 0);
    const haric = g.belge_kdv_haric_toplam
      ?? (satirlar.length && satirlar.every((k) => k.tutar_kdv_haric != null)
        ? satirlar.reduce((t, k) => t + Number(k.tutar_kdv_haric), 0) - Number(g.belge_indirim ?? 0) : null);
    const t = kdvliTutar(dahil, haric);
    return `${tl.format(t.deger)} ${t.bilinmiyor ? 'KDV dahil' : kdvEtiketi()}`;
  };
  const bugun = bugunStr();
  const girisYaz = (g) => {
    const satirlar = kalemler.filter((k) => k.giris_id === g.id);
    const gBelgeler = belgeler.filter((b) => b.giris_id === g.id);
    const fatura = g.tur === 'fatura';
    const iptalEdebilir = !g.iptal_zamani
      && (patron || (g.giren === user.id && gunu(g.olusturma) === bugun));
    return `
      <details class="giris${g.iptal_zamani ? ' iptal' : ''}" ${gBelgeler.length ? `data-belgeli="${esc(g.id)}"` : ''}>
        <summary>
          <b>${TURLER[g.tur].ad}</b> · ${tarihYaz(g.tarih)}${g.aciklama ? ` · ${esc(g.aciklama)}` : ''}
          <small>${esc(g.giren_ad)} · ${satirlar.length} satır${fatura ? ` · ${faturaToplami(g, satirlar)}` : ''}
            ${fatura ? (gBelgeler.length ? ` · 📷 ${gBelgeler.length}` : ' · <span class="uyari">📷 yok</span>') : ''}
            ${g.iptal_zamani ? ' · <span class="uyari">İPTAL</span>' : ''}</small>
        </summary>
        <ul>${satirlar.map((k) => `<li>${kalemYaz(k)}</li>`).join('')}</ul>
        ${fatura && g.belge_genel_toplam != null ? `<small>Faturadaki genel toplam: ${tl.format(g.belge_genel_toplam)}
          ${g.belge_kdv_haric_toplam != null ? ` · KDV hariç: ${tl.format(g.belge_kdv_haric_toplam)}` : ''}
          ${g.belge_kdv_toplam != null ? ` · KDV: ${tl.format(g.belge_kdv_toplam)}` : ''}
          ${Number(g.belge_indirim) > 0 ? ` · İndirim: ${tl.format(g.belge_indirim)}` : ''}</small>` : ''}
        ${gBelgeler.length ? '<div class="belgeler"><p class="bilgi">Belgeler yükleniyor…</p></div>' : ''}
        <small>Giren: ${esc(g.giren_ad)}, ${zamanYaz(g.olusturma)}</small>
        ${g.iptal_zamani ? `<small class="uyari">İptal eden: ${esc(g.iptal_eden_ad)}, ${zamanYaz(g.iptal_zamani)}</small>` : ''}
        ${iptalEdebilir ? `<button class="ikincil kucuk" data-iptal="${esc(g.id)}">Bu girişi iptal et</button>` : ''}
      </details>`;
  };

  const eksikMetni = [
    eksik?.bekleyen_fatura ? `${eksik.bekleyen_fatura} faturada eşleştirme bekleniyor` : '',
    eksik?.bekleyen_satis_raporu ? `${eksik.bekleyen_satis_raporu} satış raporu işlenmeyi bekliyor` : '',
  ].filter(Boolean).join(', ');
  icerik.innerHTML = `
    ${eksikMetni ? `<div class="sade-uyari">⚠️ ${eksikMetni}; sonuç eksik olabilir.
      <small>En eskisi: ${eksik.en_eski ? tarihYaz(eksik.en_eski) : '?'}. Kurulum ekibi çözünce bu uyarı kalkar.</small></div>` : ''}
    <div class="buyuk-dugmeler yatay">
      <button data-is="mal"><span class="simge">📦</span>Mal geldi</button>
      <button data-is="fire"><span class="simge">🗑️</span>Fire var</button>
      <button data-is="sayim"><span class="simge">📋</span>Haftalık sayım</button>
    </div>
    <div class="izgara">
      <button class="ikincil" data-yeni="fatura">🧾 Fatura elle gir</button>
      <button class="ikincil" data-yeni="satis">💰 Satış gir</button>
    </div>
    <div class="kart">
      <h2>Geçmiş girişler</h2>
      <label for="ay">Ay</label>
      <input id="ay" type="month" value="${secilenAy}" max="${bugun.slice(0, 7)}">
      ${girisler.length ? girisler.map(girisYaz).join('')
        : '<p class="bilgi">Bu ayda giriş yok.</p>'}
      ${girisler.length === 1000 ? '<p class="uyari">Bu ayda çok fazla giriş var; yalnızca son 1000 tanesi gösteriliyor.</p>' : ''}
    </div>`;

  const yenile = () => girisSekmesi(icerik, user, patron).catch(hataGoster);
  icerik.querySelector('#ay').addEventListener('change', (e) => {
    if (!/^\d{4}-\d{2}$/.test(e.target.value)) return;
    secilenAy = e.target.value;
    yenile();
  });
  icerik.querySelectorAll('[data-is]').forEach((b) => b.addEventListener('click', () =>
    isBaslat(icerik, b.dataset.is, user, yenile)));
  icerik.querySelectorAll('[data-yeni]').forEach((b) => b.addEventListener('click', async () => {
    if (b.dataset.yeni === 'fatura') {
      b.disabled = true;
      try { await faturaFormu(icerik, ctx, yenile); } catch (err) { hataGoster(err); b.disabled = false; return; }
    } else {
      girisFormu(icerik, b.dataset.yeni, ctx, yenile);
    }
    window.scrollTo(0, 0);
  }));
  // Belgeler, kayıt ilk açıldığında geçici (1 saatlik) bağlantılarla yüklenir.
  icerik.querySelectorAll('[data-belgeli]').forEach((det) => det.addEventListener('toggle', () => {
    if (det.open) belgeleriGoster(det.querySelector('.belgeler'), belgeler.filter((b) => b.giris_id === det.dataset.belgeli));
  }));
  icerik.querySelectorAll('[data-iptal]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Bu giriş iptal edilsin mi? Silinmez; iptal edildi olarak kalır ve hesaplara katılmaz.')) return;
    b.disabled = true;
    const { error } = await sb.rpc('giris_iptal', { p_id: b.dataset.iptal });
    if (error) { hataGoster(error); b.disabled = false; return; }
    yenile();
  }));
}

// Satış, fire ve sayım formu. Fire satır satır; satış ve sayım tam liste halinde girilir. (Fatura: faturaFormu)
function girisFormu(icerik, tur, ctx, bitti) {
  const { malzemeler, malzemeBul, urunler, urunBul } = ctx;
  const aktifMalzemeler = malzemeler.filter((m) => m.aktif);
  const aktifUrunler = urunler.filter((u) => u.aktif);
  const liste = tur === 'satis' ? aktifUrunler : tur === 'sayim' ? aktifMalzemeler : null;
  const bugun = bugunStr();
  const enEski = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  // Fire satırları: { secim: 'm:<id>' | 'u:<id>' | '', miktar }
  const satirlar = [{ secim: '', miktar: '' }];

  const bos = liste ? !liste.length : !aktifMalzemeler.length && !(tur === 'fire' && aktifUrunler.length);
  if (bos) {
    icerik.innerHTML = `<div class="kart"><h2>${TURLER[tur].dugme}</h2>
      <p class="bilgi">Önce ${tur === 'satis' ? 'Ürünler' : 'Malzeme'} sekmesinden ${tur === 'satis' ? 'ürün' : 'malzeme'} eklenmeli.</p>
      <button class="tam ikincil" id="vazgec">Geri</button></div>`;
    icerik.querySelector('#vazgec').onclick = bitti;
    return;
  }

  icerik.innerHTML = `
    <form class="kart" id="giris-form">
      <h2>${TURLER[tur].dugme}</h2>
      <p class="bilgi">${TURLER[tur].not}</p>
      <label for="g-tarih">Tarih</label>
      <input id="g-tarih" name="tarih" type="date" value="${bugun}" max="${bugun}" min="${enEski}" required>
      ${tur === 'fire' ? `<label for="g-aciklama">Sebep</label>
        <select id="g-aciklama" name="aciklama" required><option value="">Seç</option>
          ${FIRE_SEBEPLERI.map((s) => `<option>${s}</option>`).join('')}</select>` : ''}
      <div id="satirlar"></div>
      ${liste ? '' : '<button class="ikincil kucuk" type="button" id="satir-ekle">+ Satır ekle</button>'}
      <button class="tam" type="submit">Kaydet</button>
      <button class="tam ikincil" type="button" id="vazgec">Vazgeç</button>
      <p class="mesaj"></p>
    </form>`;
  const form = icerik.querySelector('form');
  const kutu = form.querySelector('#satirlar');
  form.querySelector('#vazgec').onclick = () => bitti();

  const birimEtiketi = (secim) => {
    if (secim.startsWith('u:')) return 'adet';
    const m = malzemeBul.get(secim.slice(2));
    return m ? BIRIMLER[m.birim].fiyatBirimi : '';
  };

  if (liste) {
    // Satış: ürün başına adet. Sayım: malzeme başına kg/litre/adet.
    kutu.innerHTML = liste.map((x) => `
      <div class="liste-satir">
        <label for="l-${esc(x.id)}">${esc(x.ad)}</label>
        <input id="l-${esc(x.id)}" data-id="${esc(x.id)}" inputmode="${tur === 'satis' ? 'numeric' : 'decimal'}"
          autocomplete="off" placeholder="—">
        <span class="birim">${tur === 'satis' ? 'adet' : BIRIMLER[x.birim].fiyatBirimi}</span>
      </div>`).join('');
  } else {
    const secenekler = (secili) => `
      <option value="">Malzeme ya da ürün seç</option>
      <optgroup label="Malzemeler">${aktifMalzemeler.map((m) =>
        `<option value="m:${esc(m.id)}" ${secili === `m:${m.id}` ? 'selected' : ''}>${esc(m.ad)}</option>`).join('')}</optgroup>
      ${aktifUrunler.length ? `<optgroup label="Ürünler (tarifiyle düşülür)">${aktifUrunler.map((u) =>
        `<option value="u:${esc(u.id)}" ${secili === `u:${u.id}` ? 'selected' : ''}>${esc(u.ad)}</option>`).join('')}</optgroup>` : ''}`;
    const ciz = () => {
      kutu.innerHTML = satirlar.map((s, i) => `
        <div class="giris-satir">
          <select data-i="${i}" aria-label="Malzeme">${secenekler(s.secim)}</select>
          <div class="giris-alt">
            <input data-i="${i}" data-alan="miktar" inputmode="decimal" autocomplete="off"
              placeholder="Miktar" aria-label="Miktar" value="${esc(s.miktar)}">
            <span class="birim">${birimEtiketi(s.secim)}</span>
            <button class="ikincil kucuk" type="button" data-sil="${i}" aria-label="Satırı sil">✕</button>
          </div>
        </div>`).join('');
      kutu.querySelectorAll('select').forEach((sel) => sel.addEventListener('change', () => {
        satirlar[sel.dataset.i].secim = sel.value;
        ciz();
      }));
      kutu.querySelectorAll('input').forEach((inp) => inp.addEventListener('input', () => {
        satirlar[inp.dataset.i][inp.dataset.alan] = inp.value;
      }));
      kutu.querySelectorAll('[data-sil]').forEach((b) => b.addEventListener('click', () => {
        satirlar.splice(Number(b.dataset.sil), 1);
        if (!satirlar.length) satirlar.push({ secim: '', miktar: '' });
        ciz();
      }));
    };
    ciz();
    form.querySelector('#satir-ekle').addEventListener('click', () => {
      satirlar.push({ secim: '', miktar: '' });
      ciz();
    });
  }

  formBagla(form, async ({ tarih, aciklama }) => {
    let gonder = [];
    if (liste) {
      for (const inp of kutu.querySelectorAll('input')) {
        if (!inp.value.trim()) continue;
        const x = (tur === 'satis' ? urunBul : malzemeBul).get(inp.dataset.id);
        const n = sayiOku(inp.value);
        if (tur === 'satis') {
          if (!Number.isInteger(n) || n < 0 || n > 100000) throw new Error(`${x.ad} için adedi tam sayı olarak yaz.`);
          if (n > 0) gonder.push({ urun_id: x.id, miktar: n });
        } else {
          if (!Number.isFinite(n)) throw new Error(`${x.ad} için miktarı sayı olarak yaz. Örn. 2,5`);
          gonder.push({ malzeme_id: x.id, miktar: kucukMiktar(n, x.birim) });
        }
      }
      if (!gonder.length) throw new Error(tur === 'satis' ? 'En az bir ürünün adedini yaz.' : 'En az bir malzemenin miktarını yaz.');
    } else {
      const dolu = satirlar.filter((s) => s.secim || String(s.miktar).trim());
      if (!dolu.length) throw new Error('En az bir satır gir.');
      gonder = dolu.map((s) => {
        if (!s.secim) throw new Error('Her satırda bir seçim yap ya da boş satırı sil.');
        const id = s.secim.slice(2);
        const n = sayiOku(s.miktar);
        if (s.secim.startsWith('u:')) {
          if (!Number.isInteger(n) || n < 1) throw new Error(`${urunBul.get(id).ad} için adedi tam sayı olarak yaz.`);
          return { urun_id: id, miktar: n };
        }
        const m = malzemeBul.get(id);
        if (!(n > 0)) throw new Error(`${m.ad} için miktarı sayı olarak yaz. Örn. 2,5`);
        return { malzeme_id: id, miktar: kucukMiktar(n, m.birim) };
      });
      const idler = gonder.map((k) => k.malzeme_id ?? k.urun_id);
      if (new Set(idler).size !== idler.length) throw new Error('Aynı malzeme ya da ürün iki satırda var. Tek satırda topla.');
    }
    const { error } = await sb.rpc('giris_kaydet',
      { p_tur: tur, p_tarih: tarih, p_aciklama: aciklama ?? null, p_kalemler: gonder });
    if (error) throw error;
    secilenAy = tarih.slice(0, 7);
    await bitti();
  });
}

// ---------- Fatura: belge + KDV'li satırlar + kontroller + onay ----------

const BELGE_KOVASI = 'fatura-belgeleri';
const MAX_BELGE = 5;
// Uyarı eşikleri: birim fiyat son fiyattan %30'dan fazla farklı; miktar normalin 3 katı / üçte biri
// (en az 3 geçmiş fatura varsa). Toplam payı veritabanıyla aynı: 1 TL ya da satır başına 1 kuruş.
const ESIK = { fiyatFarki: 0.30, miktarKat: 3, minFatura: 3 };

// Fotoğrafı telefonda küçültür (uzun kenar en fazla 2000 piksel, JPEG). Böylece yükleme hızlı, depo küçük kalır.
async function fotoKucult(dosya, enUzun = 2000, kalite = 0.8) {
  const url = URL.createObjectURL(dosya);
  try {
    const img = new Image();
    img.src = url;
    try { await img.decode(); } catch { throw new Error('Fotoğraf açılamadı. Başka bir fotoğraf dene.'); }
    const olcek = Math.min(1, enUzun / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * olcek);
    c.height = Math.round(img.naturalHeight * olcek);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', kalite));
    if (!blob) throw new Error('Fotoğraf işlenemedi.');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Kayıtlı belgeleri 1 saatlik geçici bağlantılarla gösterir (kova gizli; bağlantı yalnız bu mekana açılır).
async function belgeleriGoster(kutu, liste) {
  if (!kutu || kutu.dataset.yuklendi) return;
  kutu.dataset.yuklendi = '1';
  try {
    const { data, error } = await sb.storage.from(BELGE_KOVASI).createSignedUrls(liste.map((b) => b.yol), 3600);
    if (error) throw error;
    const url = new Map(data.map((d) => [d.path, d.signedUrl]));
    kutu.innerHTML = liste.map((b, i) => {
      const u = url.get(b.yol);
      if (!u) return '<span class="uyari">Belge açılamadı</span>';
      return b.tur === 'pdf'
        ? `<a class="belge-pdf" href="${esc(u)}" target="_blank" rel="noopener">📄 PDF ${i + 1}</a>`
        : `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Fatura fotoğrafı ${i + 1}"></a>`;
    }).join('');
  } catch (err) {
    delete kutu.dataset.yuklendi;
    kutu.innerHTML = `<p class="hata">${esc(hataMetni(err))}</p>`;
  }
}

async function faturaFormu(icerik, ctx, bitti) {
  const { malzemeler, malzemeBul } = ctx;
  const aktifMalzemeler = malzemeler.filter((m) => m.aktif);
  if (!aktifMalzemeler.length) {
    icerik.innerHTML = `<div class="kart"><h2>Fatura gir</h2>
      <p class="bilgi">Önce Malzeme sekmesinden malzeme eklenmeli.</p>
      <button class="tam ikincil" id="vazgec">Geri</button></div>`;
    icerik.querySelector('#vazgec').onclick = bitti;
    return;
  }
  const { data: refler, error } = await sb.rpc('fatura_referanslari');
  if (error) throw error;
  const refBul = new Map(refler.map((r) => [r.malzeme_id, r]));

  const bugun = bugunStr();
  const enEski = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  const taslak = crypto.randomUUID();       // belgelerin depodaki klasörü
  let belgeNo = 0;
  const belgeler = [];                      // { no, tur: 'foto'|'pdf', blob, ad, onizleme, yol }
  const yeniSatir = () => ({ secim: '', metin: '', miktar: '', tutar: '', oran: '', onay: {} });
  const satirlar = [yeniSatir()];
  let tutarlarDahil = false;                // satır tutarları KDV dahil mi yazılıyor
  let denendi = false;                      // "Onayla"ya basıldı mı (boş alan hatalarını o zaman göster)

  icerik.innerHTML = `
    <form class="kart" id="fatura-form" novalidate>
      <h2>Fatura gir</h2>
      <p class="bilgi">Faturadaki satırları ve alt kısımdaki toplamları gir. Toplamlar tutmadan stoğa hiçbir şey eklenmez.</p>
      <label for="f-tarih">Fatura tarihi</label>
      <input id="f-tarih" name="tarih" type="date" value="${bugun}" max="${bugun}" min="${enEski}" required>
      <label for="f-tedarikci">Tedarikçi (isteğe bağlı)</label>
      <input id="f-tedarikci" name="tedarikci" maxlength="200" placeholder="Örn. Metro">

      <h3>Belge (isteğe bağlı)</h3>
      <div class="belge-dugmeler">
        <label class="dugme ikincil">📷 Fotoğraf çek
          <input type="file" accept="image/*" capture="environment" id="f-kamera" hidden></label>
        <label class="dugme ikincil">📎 Dosya / PDF seç
          <input type="file" accept="image/*,application/pdf" multiple id="f-dosya" hidden></label>
      </div>
      <div id="f-belgeler" class="belgeler"></div>

      <h3>Satırlar</h3>
      <label for="f-tutar-turu">Satır tutarlarını nasıl yazacaksın?</label>
      <select id="f-tutar-turu">
        <option value="haric">KDV hariç (faturalarda genelde böyle)</option>
        <option value="dahil">KDV dahil</option>
      </select>
      <div id="f-satirlar"></div>
      <button class="ikincil kucuk" type="button" id="f-satir-ekle">+ Satır ekle</button>

      <h3>Faturanın alt kısmı</h3>
      <label for="f-genel">Genel toplam (ödenecek tutar)</label>
      <input id="f-genel" data-toplam="genel" inputmode="decimal" autocomplete="off" placeholder="Örn. 1.320,00">
      <details class="ek-toplamlar"><summary>Faturada yazıyorsa: KDV hariç toplam, KDV, indirim</summary>
        <label for="f-haric">KDV hariç toplam (mal/hizmet toplamı)</label>
        <input id="f-haric" data-toplam="kdv_haric" inputmode="decimal" autocomplete="off">
        <label for="f-kdv">Toplam KDV</label>
        <input id="f-kdv" data-toplam="kdv" inputmode="decimal" autocomplete="off">
        <label for="f-indirim">İndirim (KDV dahil)</label>
        <input id="f-indirim" data-toplam="indirim" inputmode="decimal" autocomplete="off">
      </details>

      <div id="f-kontrol" class="kontrol"></div>
      <button class="tam" type="submit" id="f-onayla">Onayla ve stoğa ekle</button>
      <button class="tam ikincil" type="button" id="vazgec">Vazgeç</button>
      <p class="mesaj"></p>
    </form>`;
  const form = icerik.querySelector('form');
  const satirKutu = form.querySelector('#f-satirlar');
  const kontrolKutu = form.querySelector('#f-kontrol');
  const onayla = form.querySelector('#f-onayla');
  const mesaj = form.querySelector('.mesaj');
  form.querySelector('#vazgec').onclick = () => {
    if ((belgeler.length || satirlar.some(dokunuldu)) && !confirm('Girdiklerin kaydedilmeden çıkılsın mı?')) return;
    bitti();
  };

  // ----- Belgeler -----
  const belgeKutu = form.querySelector('#f-belgeler');
  const belgeCiz = () => {
    belgeKutu.innerHTML = belgeler.length ? belgeler.map((b, i) => `
      <span class="belge-kucuk">
        ${b.tur === 'pdf' ? `<span class="belge-pdf">📄 ${esc(b.ad)}</span>` : `<img src="${b.onizleme}" alt="Fatura fotoğrafı ${i + 1}">`}
        <button class="ikincil kucuk" type="button" data-belge-sil="${i}" aria-label="Belgeyi kaldır">✕</button>
      </span>`).join('')
      : '<p class="bilgi">Belge eklenmedi. Fatura listede "📷 yok" olarak görünecek.</p>';
    belgeKutu.querySelectorAll('[data-belge-sil]').forEach((b) => b.addEventListener('click', () => {
      const [silinen] = belgeler.splice(Number(b.dataset.belgeSil), 1);
      if (silinen.onizleme) URL.revokeObjectURL(silinen.onizleme);
      belgeCiz();
    }));
  };
  const belgeEkle = async (dosyalar) => {
    for (const d of dosyalar) {
      if (belgeler.length >= MAX_BELGE) { alert(`Bir faturaya en fazla ${MAX_BELGE} belge eklenebilir.`); break; }
      const pdf = d.type === 'application/pdf' || /\.pdf$/i.test(d.name);
      try {
        if (pdf) {
          if (d.size > 5 * 1024 * 1024) throw new Error('PDF en fazla 5 MB olabilir.');
          belgeler.push({ no: ++belgeNo, tur: 'pdf', blob: d, ad: d.name });
        } else {
          const blob = await fotoKucult(d);
          belgeler.push({ no: ++belgeNo, tur: 'foto', blob, onizleme: URL.createObjectURL(blob) });
        }
      } catch (err) { hataGoster(err); }
    }
    belgeCiz();
  };
  for (const id of ['#f-kamera', '#f-dosya']) {
    const inp = form.querySelector(id);
    inp.addEventListener('change', async () => {
      const dosyalar = [...inp.files];
      inp.value = '';
      belgeKutu.innerHTML = '<p class="bilgi">Fotoğraf hazırlanıyor…</p>';
      await belgeEkle(dosyalar);
    });
  }
  belgeCiz();

  // ----- Satırlar -----
  const dokunuldu = (s) => Boolean(s.secim || s.metin.trim() || String(s.miktar).trim() || String(s.tutar).trim());

  // Bir satırın hesabı: eksikler (kırmızı), uyarılar (sarı, kontrol gerektirir), tutarlar.
  const satirHesap = (s) => {
    const r = { hatalar: [], uyarilar: [] };
    if (!s.secim) { r.hatalar.push('Malzeme seç ya da satırı sil.'); return r; }
    r.stokDisi = s.secim === 'stokdisi';
    if (r.stokDisi) {
      if (!s.metin.trim()) r.hatalar.push('Ne olduğunu yaz (örn. Deterjan).');
    } else {
      r.m = malzemeBul.get(s.secim.slice(2));
      const n = sayiOku(s.miktar);
      if (!(n > 0)) r.hatalar.push('Miktarı yaz.');
      else r.miktar = kucukMiktar(n, r.m.birim);
    }
    const t = sayiOku(s.tutar);
    if (!Number.isFinite(t)) r.hatalar.push('Tutarı yaz (ücretsizse 0).');
    if (s.oran === '') r.hatalar.push('KDV oranını seç.');
    if (r.hatalar.length) return r;
    r.oran = Number(s.oran);
    r.haric = yuvarla(tutarlarDahil ? t / (1 + r.oran / 100) : t);
    r.dahil = yuvarla(r.haric * (1 + r.oran / 100));
    if (r.stokDisi) return r;

    const b = BIRIMLER[r.m.birim];
    if (r.haric === 0) {
      r.uyarilar.push({ kod: 'ucretsiz', metin: 'Tutar 0. Ücretsiz / numune olarak geldiyse onayla.' });
    } else if (Number(r.m.fiyat) > 0) {
      const birim = (r.dahil / r.miktar) * b.bolen;
      const fark = (birim - Number(r.m.fiyat)) / Number(r.m.fiyat);
      if (Math.abs(fark) > ESIK.fiyatFarki) {
        r.uyarilar.push({ kod: 'fiyat', metin: `Birim fiyat ${tl.format(birim)}/${b.fiyatBirimi} (KDV dahil); `
          + `son kayıtlı fiyat ${tl.format(r.m.fiyat)}/${b.fiyatBirimi}. %${Math.round(Math.abs(fark) * 100)} `
          + `${fark > 0 ? 'daha pahalı' : 'daha ucuz'}.` });
      }
    }
    const ref = refBul.get(r.m.id);
    const medyan = Number(ref?.medyan_miktar);
    if (ref && ref.fatura_sayisi >= ESIK.minFatura && medyan > 0
        && (r.miktar > medyan * ESIK.miktarKat || r.miktar < medyan / ESIK.miktarKat)) {
      r.uyarilar.push({ kod: 'miktar', metin: `Genelde ${buyukMiktar(medyan, r.m.birim)} geliyor, `
        + `bu sefer ${buyukMiktar(r.miktar, r.m.birim)}. Miktarı ve birimi kontrol et.` });
    }
    return r;
  };

  const secenekler = (secili) => `
    <option value="">Malzeme seç</option>
    ${aktifMalzemeler.map((m) => `<option value="m:${esc(m.id)}" ${secili === `m:${m.id}` ? 'selected' : ''}>${esc(m.ad)}</option>`).join('')}
    <option value="stokdisi" ${secili === 'stokdisi' ? 'selected' : ''}>— Stoğa eklenmeyen kalem (deterjan, peçete…)</option>`;
  const oranSecenekleri = (secili) => `<option value="">KDV %</option>
    ${KDV_ORANLARI.map((o) => `<option value="${o}" ${secili !== '' && Number(secili) === o ? 'selected' : ''}>%${o}</option>`).join('')}`;

  const satirlariCiz = () => {
    satirKutu.innerHTML = satirlar.map((s, i) => {
      const m = s.secim.startsWith('m:') ? malzemeBul.get(s.secim.slice(2)) : null;
      return `
        <div class="fatura-satir" data-satir="${i}">
          <div class="satir-ust">
            <select data-i="${i}" data-alan="secim" aria-label="Malzeme">${secenekler(s.secim)}</select>
            <button class="ikincil kucuk" type="button" data-sil="${i}" aria-label="Satırı sil">✕</button>
          </div>
          ${s.secim === 'stokdisi'
            ? `<input data-i="${i}" data-alan="metin" maxlength="200" placeholder="Ne? Örn. Deterjan" value="${esc(s.metin)}">`
            : `<div class="giris-alt">
                <input data-i="${i}" data-alan="miktar" inputmode="decimal" autocomplete="off" placeholder="Miktar"
                  aria-label="Miktar" value="${esc(s.miktar)}">
                <span class="birim">${m ? BIRIMLER[m.birim].fiyatBirimi : ''}</span></div>`}
          <div class="giris-alt">
            <input data-i="${i}" data-alan="tutar" inputmode="decimal" autocomplete="off"
              placeholder="Tutar (${tutarlarDahil ? 'KDV dahil' : 'KDV hariç'})" aria-label="Satır tutarı" value="${esc(s.tutar)}">
            <select data-i="${i}" data-alan="oran" aria-label="KDV oranı" class="oran">${oranSecenekleri(s.oran)}</select>
          </div>
          <div class="satir-durum"></div>
        </div>`;
    }).join('');
    satirKutu.querySelectorAll('[data-alan]').forEach((el) => {
      const olay = el.tagName === 'SELECT' ? 'change' : 'input';
      el.addEventListener(olay, () => {
        const s = satirlar[el.dataset.i];
        s[el.dataset.alan] = el.value;
        s.onay = {};   // değer değişince eski onaylar geçersiz
        if (el.dataset.alan === 'secim') {
          const m = malzemeBul.get(el.value.slice(2));
          if (m && s.oran === '') {
            const o = refBul.get(m.id)?.son_kdv_orani ?? m.kdv_orani;
            if (o != null) s.oran = String(Number(o));
          }
          satirlariCiz();
          return;
        }
        kontrol();
      });
    });
    satirKutu.querySelectorAll('[data-sil]').forEach((b) => b.addEventListener('click', () => {
      satirlar.splice(Number(b.dataset.sil), 1);
      if (!satirlar.length) satirlar.push(yeniSatir());
      satirlariCiz();
    }));
    kontrol();
  };

  form.querySelector('#f-satir-ekle').addEventListener('click', () => {
    satirlar.push(yeniSatir());
    satirlariCiz();
    satirKutu.lastElementChild?.querySelector('select')?.focus();
  });
  form.querySelector('#f-tutar-turu').addEventListener('change', (e) => {
    tutarlarDahil = e.target.value === 'dahil';
    satirlar.forEach((s) => { s.onay = {}; });
    satirlariCiz();
  });
  form.querySelectorAll('[data-toplam]').forEach((inp) => inp.addEventListener('input', () => kontrol()));

  // ----- Kontrol: her değişiklikte satır durumları + toplam kontrolü + onay düğmesi -----
  const toplamOku = (alan) => {
    const v = form.querySelector(`[data-toplam="${alan}"]`).value.trim();
    if (!v) return null;
    const n = sayiOku(v);
    return Number.isFinite(n) ? n : NaN;
  };
  function kontrol() {
    const engeller = [];
    let sumH = 0, sumD = 0, eksikSatir = 0, bekleyenUyari = 0;
    const oranlar = new Set();
    const malzemeSayisi = new Map();
    const hesaplar = satirlar.map((s, i) => {
      const kutu = satirKutu.querySelector(`[data-satir="${i}"]`);
      const durum = kutu.querySelector('.satir-durum');
      if (!dokunuldu(s)) {
        kutu.className = 'fatura-satir';
        durum.innerHTML = denendi && satirlar.length === 1 ? '<span class="uyari">En az bir satır gir.</span>' : '';
        return null;
      }
      const r = satirHesap(s);
      if (r.hatalar.length) {
        eksikSatir++;
        kutu.className = `fatura-satir${denendi ? ' kirmizi' : ''}`;
        durum.innerHTML = denendi ? r.hatalar.map((h) => `<span class="uyari">${h}</span>`).join(' ') : '';
        return r;
      }
      sumH += r.haric; sumD += r.dahil; oranlar.add(r.oran);
      if (r.m) malzemeSayisi.set(r.m.id, (malzemeSayisi.get(r.m.id) ?? 0) + 1);
      const bekleyen = r.uyarilar.filter((u) => !s.onay[u.kod]).length;
      bekleyenUyari += bekleyen;
      kutu.className = `fatura-satir ${r.uyarilar.length ? (bekleyen ? 'sari' : 'onayli') : 'yesil'}`;
      durum.innerHTML = `<small>KDV hariç ${tl.format(r.haric)} · KDV dahil ${tl.format(r.dahil)}
          ${r.m ? ` · stoğa: ${buyukMiktar(r.miktar, r.m.birim)}` : ' · stoğa eklenmez'}</small>
        ${r.uyarilar.map((u) => `<label class="onay-kutu"><input type="checkbox" data-onay="${i}:${u.kod}"
          ${s.onay[u.kod] ? 'checked' : ''}> ⚠️ ${esc(u.metin)} <b>Kontrol ettim, doğru.</b></label>`).join('')}`;
      return r;
    });
    satirKutu.querySelectorAll('[data-onay]').forEach((cb) => cb.addEventListener('change', () => {
      const [i, kod] = cb.dataset.onay.split(':');
      satirlar[i].onay[kod] = cb.checked;
      kontrol();
    }));

    const doluSayisi = hesaplar.filter(Boolean).length;
    if (!doluSayisi) engeller.push('En az bir satır gir.');
    if (eksikSatir) engeller.push(`${eksikSatir} satırda eksik bilgi var.`);
    if (bekleyenUyari) engeller.push(`${bekleyenUyari} uyarı kontrol edilmedi (sarı satırlar).`);
    if ([...malzemeSayisi.values()].some((n) => n > 1)) engeller.push('Aynı malzeme iki satırda var. Tek satırda topla.');

    const T = { genel: toplamOku('genel'), kdv_haric: toplamOku('kdv_haric'), kdv: toplamOku('kdv'), indirim: toplamOku('indirim') };
    if (Object.values(T).some((v) => Number.isNaN(v))) engeller.push('Alt kısımdaki rakamlardan biri sayı değil.');
    const ind = T.indirim || 0;
    const pay = Math.max(1, 0.01 * doluSayisi);
    const satirKontrolleri = [];
    if (T.genel == null || Number.isNaN(T.genel)) {
      engeller.push('Faturanın genel toplamını yaz.');
    } else if (!eksikSatir && doluSayisi) {
      const fark = sumD - ind - T.genel;
      satirKontrolleri.push({ ok: Math.abs(fark) <= pay,
        metin: `Satırlar${ind ? ' − indirim' : ''}: ${tl.format(sumD - ind)} · Faturadaki genel toplam: ${tl.format(T.genel)}`
          + (Math.abs(fark) > pay ? ` → <b>${tl.format(Math.abs(fark))} fark var.</b> Eksik ya da yanlış bir satır olabilir.` : '') });
      if (T.kdv_haric != null && !Number.isNaN(T.kdv_haric)) {
        const f = sumH - T.kdv_haric;
        satirKontrolleri.push({ ok: Math.abs(f) <= pay,
          metin: `Satırların KDV hariç toplamı: ${tl.format(sumH)} · Faturada: ${tl.format(T.kdv_haric)}` });
      }
      if (T.kdv != null && !Number.isNaN(T.kdv)) {
        const f = (sumD - sumH) - T.kdv;
        satirKontrolleri.push({ ok: Math.abs(f) <= pay * Math.max(1, oranlar.size),
          metin: `Satırlardan hesaplanan KDV: ${tl.format(sumD - sumH)} · Faturada: ${tl.format(T.kdv)}`
            + (Math.abs(f) > pay * Math.max(1, oranlar.size) ? ' → KDV oranlarını kontrol et.' : '') });
      }
      if (T.kdv_haric != null && T.kdv != null && !Number.isNaN(T.kdv_haric) && !Number.isNaN(T.kdv)) {
        const f = T.kdv_haric + T.kdv - ind - T.genel;
        satirKontrolleri.push({ ok: Math.abs(f) <= pay,
          metin: 'Faturanın kendi alt toplamları (KDV hariç + KDV − indirim = genel toplam)' });
      }
      if (satirKontrolleri.some((k) => !k.ok)) engeller.push('Toplamlar tutmuyor.');
    }

    kontrolKutu.innerHTML = `
      ${satirKontrolleri.map((k) => `<div class="${k.ok ? 'tamam' : 'hata'}">${k.ok ? '✓' : '✗'} ${k.metin}</div>`).join('')}
      ${engeller.length ? `<div class="engeller"><b>Onaylamak için:</b><ul>${engeller.map((e) => `<li>${e}</li>`).join('')}</ul></div>`
        : '<div class="tamam"><b>Her şey tutuyor. Onaylayınca stoğa eklenecek.</b></div>'}`;
    onayla.disabled = engeller.length > 0;
    return { engeller, hesaplar, T };
  }

  satirlariCiz();

  // ----- Onay: önce belgeler yüklenir, sonra fatura tek seferde kaydedilir -----
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    denendi = true;
    const { engeller, hesaplar, T } = kontrol();
    if (engeller.length) return;
    const tarih = form.querySelector('#f-tarih').value;
    if (!tarih) { mesaj.className = 'mesaj hata'; mesaj.textContent = 'Fatura tarihini seç.'; return; }
    onayla.disabled = true;
    mesaj.className = 'mesaj'; mesaj.textContent = '';
    try {
      for (const [i, b] of belgeler.entries()) {
        if (b.yol) continue;   // tekrar denemede yüklenmiş belgeyi yeniden yükleme
        onayla.textContent = `Belgeler yükleniyor (${i + 1}/${belgeler.length})…`;
        const yol = `${mekan.id}/${taslak}/${b.no}.${b.tur === 'pdf' ? 'pdf' : 'jpg'}`;
        const { error: ye } = await sb.storage.from(BELGE_KOVASI).upload(yol, b.blob,
          { contentType: b.tur === 'pdf' ? 'application/pdf' : 'image/jpeg', upsert: false });
        if (ye && !/exists|duplicate/i.test(ye.message)) throw ye;
        b.yol = yol;
      }
      onayla.textContent = 'Kaydediliyor…';
      const kalemler = satirlar.map((s, i) => [s, hesaplar[i]]).filter(([, r]) => r).map(([s, r]) => (r.stokDisi
        ? { stok_disi: true, satir_metni: s.metin.trim(), tutar_kdv_haric: r.haric, kdv_orani: r.oran }
        : { malzeme_id: r.m.id, miktar: r.miktar, tutar_kdv_haric: r.haric, kdv_orani: r.oran,
            uyarilar: r.uyarilar.map((u) => u.kod) }));
      const toplamlar = Object.fromEntries(Object.entries(T).filter(([, v]) => v != null));
      const { error: fe } = await sb.rpc('fatura_kaydet', {
        p_tarih: tarih, p_tedarikci: form.querySelector('#f-tedarikci').value || null,
        p_kalemler: kalemler, p_toplamlar: toplamlar, p_belgeler: belgeler.map((b) => b.yol),
      });
      if (fe) throw fe;
      belgeler.forEach((b) => b.onizleme && URL.revokeObjectURL(b.onizleme));
      secilenAy = tarih.slice(0, 7);
      await bitti();
    } catch (err) {
      mesaj.className = 'mesaj hata';
      mesaj.textContent = hataMetni(err);
      onayla.textContent = 'Onayla ve stoğa ekle';
      kontrol();
    }
  });
}

// =====================================================================================
// BARİSTA: sade ekran — üç büyük düğme. Fiyat, KDV, eşleştirme, tarif, rapor yok.
// (Patron da aynı akışları Girişler sekmesinden kullanır.)
// =====================================================================================

const istekKimligi = () => crypto.randomUUID();

function baristaEkrani(user, uye) {
  app.innerHTML = `
    <h1 class="ortada">${esc(uye.mekanlar.ad)}</h1>
    <div class="buyuk-dugmeler">
      <button data-is="mal"><span class="simge">📦</span>Mal geldi</button>
      <button data-is="fire"><span class="simge">🗑️</span>Fire var</button>
      <button data-is="sayim"><span class="simge">📋</span>Haftalık sayım</button>
    </div>
    <p class="bilgi ortada">${esc(uye.ad)}</p>`;
  const ana = () => baristaEkrani(user, uye);
  app.querySelectorAll('[data-is]').forEach((b) => b.addEventListener('click', () => isBaslat(app, b.dataset.is, user, ana)));
}

function isBaslat(kutu, is, user, bitti) {
  const f = { mal: malGeldi, fire: fireVar, sayim: haftalikSayim }[is];
  window.scrollTo(0, 0);
  f(kutu, user, bitti).catch((err) => sadeHata(kutu, hataMetni(err), bitti));
}

// Tek cümlelik hata ekranı
function sadeHata(kutu, metin, geri, tekrar = null) {
  kutu.innerHTML = `<div class="sade-ekran ortada">
      <div class="buyuk-simge">⚠️</div><h2>${esc(metin)}</h2>
      ${tekrar ? '<button class="dev" id="tekrar">Tekrar dene</button>' : ''}
      <button class="dev ikincil" id="geri">Ana ekran</button></div>`;
  kutu.querySelector('#geri').onclick = () => geri();
  if (tekrar) kutu.querySelector('#tekrar').onclick = () => tekrar();
}

// "✓ Kaydedildi" + 2 dakika "Geri al"
function kaydedildi(kutu, { baslik, alt, geriAl, bitti }) {
  kutu.innerHTML = `<div class="sade-ekran ortada">
      <div class="buyuk-simge tamam">✓</div><h2>${esc(baslik)}</h2>
      ${alt ? `<p class="buyuk-yazi">${esc(alt)}</p>` : ''}
      <button class="dev" id="bitti">Tamam</button>
      ${geriAl ? '<button class="dev ikincil" id="geri-al">↩ Geri al</button>' : ''}
      <p class="mesaj"></p></div>`;
  const zaman = setTimeout(() => kutu.querySelector('#geri-al')?.remove(), 110000);
  kutu.querySelector('#bitti').onclick = () => { clearTimeout(zaman); bitti(); };
  kutu.querySelector('#geri-al')?.addEventListener('click', async (e) => {
    if (!confirm('Bu kayıt geri alınsın mı?')) return;
    e.target.disabled = true;
    try {
      await geriAl();
      clearTimeout(zaman);
      kutu.innerHTML = `<div class="sade-ekran ortada"><div class="buyuk-simge">↩</div><h2>Geri alındı</h2>
        <button class="dev" id="bitti">Tamam</button></div>`;
      kutu.querySelector('#bitti').onclick = () => bitti();
    } catch (err) {
      e.target.disabled = false;
      kutu.querySelector('.mesaj').className = 'mesaj hata';
      kutu.querySelector('.mesaj').textContent = hataMetni(err);
    }
  });
}

async function rpcVeri(ad, args) {
  const { data, error } = await sb.rpc(ad, args);
  if (error) throw error;
  return data;
}
const geriAlIstegi = (tur, id) => () => rpcVeri('kaydi_geri_al', { p_tur: tur, p_id: id });

// Büyük rakam kutusu ekranı (fire miktarı, sayım). Döner: { input, ileri } kurulduktan sonra.
function rakamKutusu(birim, deger = '') {
  return `<div class="rakam-kutu">
      <input id="rakam" inputmode="decimal" autocomplete="off" value="${esc(deger)}" aria-label="Miktar">
      <span>${esc(birim)}</span></div>`;
}

// ---------- 🗑️ Fire var: Ne? → Ne kadar? → Neden? ----------

const FIRE_NEDENLERI = [['Döküldü', '💧'], ['Bozuldu', '🦠'], ['Yanlış yapıldı', '✋']];

// Fire, tarifteki küçük birimle girilir (kahve gram, süt ml). Hızlı düğmeler tariflerden gelir:
// Latte'de 18 g kahve varsa kahvede "☕ Latte · 18 g". Büyük dökülme için 1 kg / 1 litre.
const KUCUK_BIRIM = { g: 'g', ml: 'ml', adet: 'adet' };
const BUYUK_KISAYOL = { g: ['1 kg', 1000], ml: ['1 litre', 1000] };

async function fireVar(kutu, user, bitti) {
  const [malzemeler, ur, tr] = await Promise.all([
    malzemeleriGetir(false),
    sb.from('urunler').select('id, ad, aktif'),
    sb.from('tarif_kalemleri').select('urun_id, malzeme_id, miktar'),
  ]);
  if (ur.error) throw ur.error;
  if (tr.error) throw tr.error;
  const urunAdi = new Map(ur.data.filter((u) => u.aktif).map((u) => [u.id, u.ad]));
  const kisayollar = (m) => {
    const goruldu = new Set();
    const liste = tr.data
      .filter((k) => k.malzeme_id === m.id && urunAdi.has(k.urun_id))
      .map((k) => ({ ad: urunAdi.get(k.urun_id), miktar: Number(k.miktar) }))
      .sort((a, b) => a.miktar - b.miktar || a.ad.localeCompare(b.ad, 'tr'))
      .filter((k) => !goruldu.has(k.miktar) && goruldu.add(k.miktar))
      .slice(0, 4)
      .map((k) => ({ etiket: `☕ ${k.ad} · ${sayiYaz(k.miktar)} ${KUCUK_BIRIM[m.birim]}`, miktar: k.miktar }));
    const b = BUYUK_KISAYOL[m.birim];
    if (b) liste.push({ etiket: `📦 ${b[0]}`, miktar: b[1] });
    return liste;
  };
  const secenekler = [
    ...malzemeler.filter((m) => m.aktif).map((m) => ({ tur: 'm', id: m.id, ad: m.ad, birim: KUCUK_BIRIM[m.birim], m,
      kisayollar: kisayollar(m) })),
    ...ur.data.filter((u) => u.aktif).sort(adaGore).map((u) => ({ tur: 'u', id: u.id, ad: u.ad, birim: 'adet', kisayollar: [] })),
  ];
  if (!secenekler.length) return sadeHata(kutu, 'Henüz malzeme eklenmemiş. Patrona haber ver.', bitti);
  let secim = null, miktar = null;
  const istek = istekKimligi();

  const neEkrani = (ara = '') => {
    const k = anahtar(ara);
    const liste = secenekler.filter((s) => !k || anahtar(s.ad).includes(k));
    kutu.innerHTML = `<div class="sade-ekran">
        <h2>🗑️ Ne gitti?</h2>
        ${secenekler.length > 10 ? `<input id="ara" class="buyuk-giris" placeholder="🔍 Ara" value="${esc(ara)}">` : ''}
        <div class="kartlar">${liste.map((s, i) => `<button class="kart-dugme" data-i="${secenekler.indexOf(s)}">
          ${s.tur === 'u' ? '☕ ' : ''}${esc(s.ad)}</button>`).join('') || '<p class="bilgi">Bulunamadı.</p>'}</div>
        <button class="dev ikincil" id="geri">◀ Ana ekran</button></div>`;
    kutu.querySelector('#geri').onclick = () => bitti();
    const ar = kutu.querySelector('#ara');
    if (ar) { ar.oninput = () => { neEkrani(ar.value); }; ar.focus(); ar.setSelectionRange(ar.value.length, ar.value.length); }
    kutu.querySelectorAll('[data-i]').forEach((b) => b.onclick = () => { secim = secenekler[b.dataset.i]; nekadarEkrani(); });
  };

  const nekadarEkrani = () => {
    kutu.innerHTML = `<div class="sade-ekran">
        <h2>${esc(secim.ad)}</h2><p class="buyuk-yazi">Ne kadar?</p>
        ${secim.kisayollar.length ? `<div class="kisayollar">${secim.kisayollar.map((k, i) =>
          `<button class="kart-dugme" data-kisayol="${i}">${esc(k.etiket)}</button>`).join('')}</div>
          <p class="bilgi ortada">Birkaç kez basabilirsin, toplanır. Ya da kendin yaz.</p>` : ''}
        ${rakamKutusu(secim.birim, miktar ?? '')}
        <p class="mesaj"></p>
        <div class="iki-dugme"><button class="dev ikincil" id="geri">◀</button><button class="dev" id="ileri">Devam ▶</button></div></div>`;
    const inp = kutu.querySelector('#rakam');
    kutu.querySelectorAll('[data-kisayol]').forEach((b) => b.onclick = () => {
      const simdiki = sayiOku(inp.value);
      const toplam = (Number.isFinite(simdiki) ? simdiki : 0) + secim.kisayollar[b.dataset.kisayol].miktar;
      inp.value = sayiYaz(Math.round(toplam * 1000) / 1000).replace(/\./g, '');
    });
    if (!secim.kisayollar.length) inp.focus();
    const ileri = () => {
      const n = sayiOku(inp.value);
      const urun = secim.tur === 'u';
      if (!(n > 0) || (urun && !Number.isInteger(n)) || n >= (urun ? 100000 : 10000000)) {
        kutu.querySelector('.mesaj').className = 'mesaj hata';
        kutu.querySelector('.mesaj').textContent = urun ? 'Kaç tane? Tam sayı yaz.' : 'Rakamı yaz.';
        return;
      }
      miktar = inp.value;
      nedenEkrani(n);
    };
    inp.onkeydown = (e) => { if (e.key === 'Enter') ileri(); };
    kutu.querySelector('#ileri').onclick = ileri;
    kutu.querySelector('#geri').onclick = () => neEkrani();
  };

  const nedenEkrani = (n) => {
    kutu.innerHTML = `<div class="sade-ekran">
        <h2>${esc(secim.ad)} · ${sayiYaz(n)} ${esc(secim.birim)}</h2><p class="buyuk-yazi">Neden?</p>
        ${FIRE_NEDENLERI.map(([ad, s]) => `<button class="dev neden" data-neden="${ad}">${s} ${ad}</button>`).join('')}
        <p class="mesaj"></p>
        <button class="dev ikincil" id="geri">◀</button></div>`;
    kutu.querySelector('#geri').onclick = () => nekadarEkrani();
    kutu.querySelectorAll('[data-neden]').forEach((b) => b.onclick = async () => {
      kutu.querySelectorAll('button').forEach((x) => { x.disabled = true; });
      // Miktar zaten tarif birimiyle (g / ml / adet) girildi; çevirme yok.
      const kalem = secim.tur === 'u' ? { urun_id: secim.id, miktar: n } : { malzeme_id: secim.id, miktar: Math.round(n * 1000) / 1000 };
      try {
        const id = await rpcVeri('giris_kaydet_tek', { p_istek: istek, p_tur: 'fire', p_tarih: bugunStr(),
          p_aciklama: b.dataset.neden, p_kalemler: [kalem] });
        kaydedildi(kutu, { baslik: 'Fire kaydedildi', alt: `${secim.ad} · ${sayiYaz(n)} ${secim.birim}`,
          geriAl: geriAlIstegi('giris', id), bitti });
      } catch (err) {
        sadeHata(kutu, hataMetni(err), bitti, () => nedenEkrani(n));
      }
    });
  };
  neEkrani();
}

// ---------- 📋 Haftalık sayım: her ekranda tek malzeme (alfabetik) → özet → kaydet → satış raporu ----------

async function haftalikSayim(kutu, user, bitti) {
  const malzemeler = (await malzemeleriGetir(false)).filter((m) => m.aktif);
  if (!malzemeler.length) return sadeHata(kutu, 'Henüz malzeme eklenmemiş. Patrona haber ver.', bitti);
  // Yarım kalan sayım telefonda saklanır (kilitlenme, müşteri…); kaldığı yerden devam edilir.
  const anahtarAd = `kahve-sayim:${mekan.id}:${user.id}`;
  let t = null;
  try { t = JSON.parse(localStorage.getItem(anahtarAd) || 'null'); } catch { t = null; }
  if (!t || t.gun !== bugunStr()) t = { gun: bugunStr(), i: 0, degerler: {}, istek: istekKimligi() };
  const sakla = () => { try { localStorage.setItem(anahtarAd, JSON.stringify(t)); } catch { /* özel pencere */ } };
  const sil = () => { try { localStorage.removeItem(anahtarAd); } catch { /* yok say */ } };

  const ekran = () => {
    if (t.i >= malzemeler.length) return ozet();
    const m = malzemeler[t.i];
    const d = t.degerler[m.id];
    kutu.innerHTML = `<div class="sade-ekran">
        <p class="ilerleme">${t.i + 1} / ${malzemeler.length}</p>
        <div class="cubuk"><div style="width:${Math.round((t.i / malzemeler.length) * 100)}%"></div></div>
        <h2 class="malzeme-adi">${esc(m.ad)}</h2>
        ${rakamKutusu(BIRIMLER[m.birim].fiyatBirimi, d === 'atla' || d == null ? '' : d)}
        <p class="mesaj"></p>
        <div class="iki-dugme"><button class="dev ikincil" id="geri">◀</button><button class="dev" id="ileri">Sonraki ▶</button></div>
        <button class="dev ikincil kucuk-dev" id="atla">Bilmiyorum, geç</button>
        <button class="metin-dugme" id="cik">Sonra devam et</button></div>`;
    const inp = kutu.querySelector('#rakam');
    inp.focus();
    const ileri = () => {
      const n = sayiOku(inp.value);
      if (!Number.isFinite(n) || n >= 10000000) {
        kutu.querySelector('.mesaj').className = 'mesaj hata';
        kutu.querySelector('.mesaj').textContent = inp.value.trim() ? 'Rakamı yaz.' : 'Rakamı yaz ya da "Bilmiyorum, geç" de.';
        return;
      }
      t.degerler[m.id] = inp.value.trim(); t.i++; sakla(); ekran();
    };
    inp.onkeydown = (e) => { if (e.key === 'Enter') ileri(); };
    kutu.querySelector('#ileri').onclick = ileri;
    kutu.querySelector('#atla').onclick = () => { t.degerler[m.id] = 'atla'; t.i++; sakla(); ekran(); };
    kutu.querySelector('#geri').onclick = () => { if (t.i === 0) { sakla(); bitti(); } else { t.i--; sakla(); ekran(); } };
    kutu.querySelector('#cik').onclick = () => { sakla(); bitti(); };
  };

  const ozet = () => {
    const sayilan = malzemeler.filter((m) => t.degerler[m.id] != null && t.degerler[m.id] !== 'atla');
    const atlanan = malzemeler.filter((m) => !sayilan.includes(m));
    kutu.innerHTML = `<div class="sade-ekran">
        <h2>📋 Sayım bitti</h2>
        <p class="buyuk-yazi">✓ ${sayilan.length} malzeme sayıldı${atlanan.length ? `<br>— ${atlanan.length} atlandı` : ''}</p>
        ${atlanan.length ? `<p class="bilgi">Atlanan: ${atlanan.map((m) => esc(m.ad)).join(', ')}</p>` : ''}
        <p class="mesaj"></p>
        <button class="dev" id="kaydet" ${sayilan.length ? '' : 'disabled'}>Kaydet ✓</button>
        <button class="dev ikincil" id="geri">◀ Geri dön</button></div>`;
    kutu.querySelector('#geri').onclick = () => { t.i = malzemeler.length - 1; sakla(); ekran(); };
    kutu.querySelector('#kaydet').onclick = async (e) => {
      e.target.disabled = true;
      try {
        const id = await rpcVeri('giris_kaydet_tek', { p_istek: t.istek, p_tur: 'sayim', p_tarih: bugunStr(), p_aciklama: null,
          p_kalemler: sayilan.map((m) => ({ malzeme_id: m.id, miktar: kucukMiktar(sayiOku(t.degerler[m.id]), m.birim) })) });
        sil();
        satisRaporu(id);
      } catch (err) {
        sadeHata(kutu, hataMetni(err), () => { sakla(); bitti(); }, ozet);
      }
    };
  };

  // Son adım: haftanın satış raporu (fotoğraf ya da dosya) → kurulum işler
  const satisRaporu = (sayimId) => {
    kutu.innerHTML = `<div class="sade-ekran">
        <div class="buyuk-simge tamam">✓</div><h2>Sayım kaydedildi</h2>
        <p class="buyuk-yazi">Son adım: bu haftanın satış raporu</p>
        <label class="dev">📷 Fotoğraf çek<input type="file" accept="image/*" capture="environment" id="r-kamera" hidden></label>
        <label class="dev ikincil">📎 Dosya seç<input type="file" accept="image/*,application/pdf,.csv,.txt,.xml" id="r-dosya" hidden></label>
        <p class="mesaj"></p>
        <button class="dev ikincil" id="atla">Şimdi değil</button></div>`;
    const bitir = (alt) => kaydedildi(kutu, { baslik: 'Haftalık sayım tamam', alt, geriAl: geriAlIstegi('giris', sayimId), bitti });
    kutu.querySelector('#atla').onclick = () => bitir('Satış raporunu sonra patrona ver.');
    for (const sec of ['#r-kamera', '#r-dosya']) {
      const inp = kutu.querySelector(sec);
      inp.onchange = async () => {
        const dosya = inp.files[0];
        if (!dosya) return;
        const msj = kutu.querySelector('.mesaj');
        msj.className = 'mesaj'; msj.textContent = 'Gönderiliyor…';
        kutu.querySelectorAll('button, label').forEach((x) => { x.style.pointerEvents = 'none'; x.style.opacity = '.6'; });
        try {
          const istek = istekKimligi();
          const tur = dosyaTuru(dosya);
          const blob = tur === 'foto' ? await fotoKucult(dosya) : dosya;
          if (blob.size > 5 * 1024 * 1024) throw new Error('Dosya çok büyük (en fazla 5 MB).');
          const uzanti = tur === 'foto' ? 'jpg' : tur === 'pdf' ? 'pdf' : tur === 'xml' ? 'xml' : (dosya.name.split('.').pop() || 'txt').toLowerCase();
          const yol = `${mekan.id}/${istek}/rapor.${uzanti}`;
          const tip = tur === 'foto' ? 'image/jpeg' : tur === 'pdf' ? 'application/pdf' : tur === 'xml' ? 'application/xml'
            : uzanti === 'csv' ? 'text/csv' : 'text/plain';
          const { error } = await sb.storage.from(BELGE_KOVASI).upload(yol, blob, { contentType: tip, upsert: false });
          if (error && !/exists|duplicate/i.test(error.message)) throw error;
          await rpcVeri('belge_kaydet', { p: { istek_id: istek, tur: 'satis_raporu', kaynak: 'dosya', dosyalar: [yol],
            dosya_ozeti: await dosyaOzeti(dosya) } });
          bitir('Satış raporu da gönderildi.');
        } catch (err) {
          msj.className = 'mesaj hata';
          msj.textContent = /daha önce yüklenmiş/.test(err.message ?? '') ? 'Bu rapor zaten gönderilmiş.' : hataMetni(err);
          kutu.querySelectorAll('button, label').forEach((x) => { x.style.pointerEvents = ''; x.style.opacity = ''; });
        }
      };
    }
  };

  ekran();
}

// ---------- 📦 Mal geldi: belge → okuma → (gerekirse "Bu ürün süt mü?") → özet → kaydet ----------

const OKUNAMADI = {
  bulanik: 'Fotoğraf bulanık, bir daha çek.',
  satir_yok: 'Fatura okunamadı. Daha yakından ve düz çek.',
};

const blobDataUrl = (blob) => new Promise((ok, hata) => {
  const r = new FileReader();
  r.onload = () => ok(r.result);
  r.onerror = () => hata(r.error);
  r.readAsDataURL(blob);
});
const ms = (a, b) => Math.round(b - a);

// Fotoğrafları AI ile okur (fatura-oku işlevi). Hata olursa fırlatır; çağıran yedek OCR'a düşer.
// Döner: { sonuc (uygulama biçiminde), olcum: süreler (ms) ve boyut }
async function aiIleOku(bloblar, model = undefined) {
  const t0 = performance.now();
  const kucukler = [];
  for (const b of bloblar) kucukler.push(await fotoKucult(b, 1600, 0.78));   // gönderilecek boyut
  const gorseller = await Promise.all(kucukler.map(blobDataUrl));
  const t1 = performance.now();
  const { data, error } = await sb.functions.invoke('fatura-oku', { body: { gorseller, model } });
  const t2 = performance.now();
  if (error) {
    let govde = null;
    try { govde = await error.context?.json?.(); } catch { /* gövde yok */ }
    throw Object.assign(new Error(govde?.mesaj ?? error.message ?? 'AI okuması başarısız'), { kod: govde?.hata ?? 'AI_HATA' });
  }
  const sonuc = aiSonucunuCevir(data.sonuc);
  const sunucu = data.sure?.toplam_ms ?? 0;
  return {
    sonuc: { ...sonuc, ai_okuma_id: data.okuma_id, model: data.model, maliyet_usd: data.maliyet_usd, token: data.token },
    kucukler,
    olcum: { kucultme_ms: ms(t0, t1), gonderme_ms: Math.max(0, ms(t1, t2) - sunucu), ai_ms: data.sure?.ai_ms ?? null,
             sunucu_ms: sunucu, istek_ms: ms(t1, t2), boyut_kb: Math.round(kucukler.reduce((t, b) => t + b.size, 0) / 1024) },
  };
}

async function malGeldi(kutu, user, bitti) {
  const [malzemeler, dr] = await Promise.all([
    malzemeleriGetir(false),
    sb.from('eslestirme_defteri').select('tedarikci_anahtar, metin_anahtar, birim, sonuc, malzeme_id, carpan'),
  ]);
  if (dr.error) throw dr.error;
  const malzemeBul = new Map(malzemeler.map((m) => [m.id, m]));
  let dosyalar = [];          // { dosya (asıl), tur: 'foto'|'pdf'|'xml', onizleme, yuklenen: {blob, yol} }
  let sonuc = null;           // okuma sonucu + satırların sınıfı
  let istek = null;           // kaydetme kimliği (tekrar denemelerde aynı)
  let ayniOnay = false;
  let onOkuma = null;         // ilk fotoğraf eklenir eklenmez arka planda başlayan AI okuması { dosya, is }
  let olcum = {};             // süreler (ms): küçültme, gönderme, AI, kayıt
  const onOkumaBaslat = () => {
    const fotolar = dosyalar.filter((d) => d.tur === 'foto');
    if (fotolar.length !== 1 || onOkuma?.dosya === fotolar[0]) return;
    onOkuma = { dosya: fotolar[0], is: aiIleOku([fotolar[0].dosya]).catch((hata) => ({ hata })) };
  };

  const belgeEkrani = () => {
    const fotolar = dosyalar.filter((d) => d.tur === 'foto');
    kutu.innerHTML = `<div class="sade-ekran">
        <h2>📦 Faturayı göster</h2>
        ${fotolar.length ? `<div class="belgeler buyuk">${fotolar.map((d) => `<img src="${d.onizleme}" alt="Fatura sayfası">`).join('')}</div>
          <button class="dev" id="oku">Oku ▶</button>
          <label class="dev ikincil">📷 Bir sayfa daha<input type="file" accept="image/*" capture="environment" id="kamera" hidden></label>`
        : `<label class="dev">📷 Fotoğraf çek<input type="file" accept="image/*" capture="environment" id="kamera" hidden></label>
          <label class="dev ikincil">📎 PDF / e-fatura seç<input type="file" accept="application/pdf,.pdf,.xml,application/xml,text/xml,image/*" id="dosya" hidden></label>`}
        <p class="mesaj"></p>
        <button class="dev ikincil" id="geri">◀ Ana ekran</button></div>`;
    kutu.querySelector('#geri').onclick = () => { temizle(); bitti(); };
    kutu.querySelector('#oku')?.addEventListener('click', oku);
    const ekle = (inp) => inp && (inp.onchange = () => {
      const yeni = [...inp.files];
      inp.value = '';
      for (const f of yeni) {
        const tur = dosyaTuru(f);
        if (tur === 'diger') { kutu.querySelector('.mesaj').className = 'mesaj hata'; kutu.querySelector('.mesaj').textContent = 'Bu dosya açılamıyor. Fotoğraf, PDF ya da e-fatura seç.'; return; }
        if (tur === 'foto') {
          if (dosyalar.some((d) => d.tur !== 'foto')) dosyalar = [];
          if (dosyalar.length >= 4) break;
          dosyalar.push({ dosya: f, tur, onizleme: URL.createObjectURL(f) });
        } else {
          temizle();
          dosyalar = [{ dosya: f, tur }];
          return oku();
        }
      }
      onOkumaBaslat();         // barista "Oku"ya basmadan okuma başlasın
      belgeEkrani();
    });
    ekle(kutu.querySelector('#kamera'));
    ekle(kutu.querySelector('#dosya'));
  };
  const temizle = () => { dosyalar.forEach((d) => d.onizleme && URL.revokeObjectURL(d.onizleme)); };

  const oku = async () => {
    kutu.innerHTML = `<div class="sade-ekran ortada">
        <div class="buyuk-simge donen">⏳</div><h2>Okunuyor…</h2>
        <div class="cubuk akan"><div id="okuma-cubuk"></div></div>
        <p class="bilgi" id="okuma-not">Birkaç saniye sürer.</p></div>`;
    const cubuk = kutu.querySelector('#okuma-cubuk');
    const not = kutu.querySelector('#okuma-not');
    const uzunSurdu = setTimeout(() => { if (not) not.textContent = 'Biraz uzun sürdü, bekle…'; }, 9000);
    // Yedek OCR'ın ilerlemesi (AI çalışmazsa)
    const ilerleme = (m) => {
      if (m.status === 'recognizing text' && cubuk) {
        cubuk.parentElement.classList.remove('akan');
        const genel = ((m.sayfa - 1) + m.progress) / (m.sayfaSayisi || 1);
        cubuk.style.width = `${Math.max(5, Math.round(genel * 100))}%`;
      }
    };
    // Fotoğraf (ya da taranmış PDF sayfası): önce AI, olmazsa telefondaki OCR
    const fotoOku = async (bloblar, onceden) => {
      try {
        const a = onceden ? await onceden : await aiIleOku(bloblar);
        if (a.hata) throw a.hata;
        olcum = { ...olcum, ...a.olcum };
        return a.sonuc;
      } catch (e) {
        console.warn('AI okuması olmadı, yedek OCR:', e);
        if (not) not.textContent = 'Yedek okuyucu çalışıyor…';
        const t = performance.now();
        const r = await fotolariOku(bloblar, ilerleme);
        olcum = { ...olcum, ocr_ms: ms(t, performance.now()), ai_hata: e.kod ?? 'AI_HATA' };
        r.notlar.push(`ai_yedek:${e.kod ?? 'AI_HATA'}`);
        return r;
      }
    };
    const t0 = performance.now();
    try {
      const d0 = dosyalar[0];
      let r;
      if (d0.tur === 'xml') r = await xmlDosyaOku(d0.dosya);
      else if (d0.tur === 'pdf') {
        r = await pdfOku(d0.dosya);
        if (r.taranmis) r = await fotoOku(r.sayfalar);
      } else {
        const fotolar = dosyalar.map((d) => d.dosya);
        const hazir = dosyalar.length === 1 && onOkuma?.dosya === dosyalar[0] ? onOkuma.is : null;
        r = await fotoOku(fotolar, hazir);
      }
      sonuc = r;
      olcum.okuma_toplam_ms = ms(t0, performance.now());
    } catch (err) {
      console.error(err);
      clearTimeout(uzunSurdu);
      return sorunEkrani('Fatura okunamadı. Tekrar dene ya da daha net çek.', false);
    }
    clearTimeout(uzunSurdu);
    if (sonuc.notlar?.includes('bulanik')) return sorunEkrani(OKUNAMADI.bulanik, true);
    if (!sonuc.satirlar.length) return sorunEkrani(OKUNAMADI.satir_yok, true);
    siniflandirHepsi();
    soruSirasi();
  };

  // Okuma sorunu: tekrar çek ya da yine de devam (belge kuruluma gider)
  const sorunEkrani = (metin, devamEdilebilir) => {
    kutu.innerHTML = `<div class="sade-ekran ortada">
        <div class="buyuk-simge">📷</div><h2>${esc(metin)}</h2>
        <button class="dev" id="tekrar">📷 Tekrar çek</button>
        ${devamEdilebilir ? '<button class="dev ikincil" id="devam">Yine de gönder</button>' : ''}
        <button class="metin-dugme" id="geri">Ana ekran</button></div>`;
    kutu.querySelector('#tekrar').onclick = () => { temizle(); dosyalar = []; onOkuma = null; belgeEkrani(); };
    kutu.querySelector('#geri').onclick = () => { temizle(); bitti(); };
    kutu.querySelector('#devam')?.addEventListener('click', () => {
      if (!sonuc.satirlar.length) sonuc.satirlar = [{ metin: '(fatura okunamadı)', miktar: null, birim: 'diger', tutar_haric: null, kdv_orani: null }];
      siniflandirHepsi();
      soruSirasi();
    });
  };

  const tedarikciAnahtari = () => sonuc.tedarikci_vkn || anahtar(sonuc.tedarikci) || '';
  const siniflandirHepsi = () => {
    const ctx = { malzemeler, defter: dr.data, tedarikciAnahtar: tedarikciAnahtari() };
    const sinifla = sonuc.kaynak === 'ai' ? aiIleSiniflandir : siniflandir;
    sonuc.satirlar.forEach((s) => { s.karar = sinifla(s, ctx); s.cevap = null; });
  };

  // "Bu ürün süt mü?" — yalnızca benzeyen, defterde olmayan satırlar için, tek tek
  const soruSirasi = () => {
    const s = sonuc.satirlar.find((x) => x.karar.sinif === 'soru' && x.cevap == null);
    if (!s) return ozetEkrani();
    const m = malzemeBul.get(s.karar.malzeme_id);
    const stok = Number(s.miktar) * s.karar.carpan;
    kutu.innerHTML = `<div class="sade-ekran ortada">
        <p class="bilgi">Faturada: <b>${esc(s.metin)}</b></p>
        <h2 class="soru">Bu ürün <u>${esc(m.ad)}</u> mü?</h2>
        <p class="buyuk-yazi">${buyukMiktar(stok, m.birim)} olarak eklenecek</p>
        <div class="iki-dugme"><button class="dev hayir" id="hayir">✗ Hayır</button><button class="dev evet" id="evet">✓ Evet</button></div></div>`;
    kutu.querySelector('#evet').onclick = () => { s.cevap = 'evet'; soruSirasi(); };
    kutu.querySelector('#hayir').onclick = () => { s.cevap = 'hayir'; soruSirasi(); };
  };

  const ozetEkrani = (hata = '') => {
    const stokta = sonuc.satirlar.filter((s) => s.karar.sinif === 'eslesti' || (s.karar.sinif === 'soru' && s.cevap === 'evet'));
    const bekleyen = sonuc.satirlar.filter((s) => s.karar.sinif === 'belirsiz' || (s.karar.sinif === 'soru' && s.cevap === 'hayir'));
    const disi = sonuc.satirlar.filter((s) => s.karar.sinif === 'takip_disi');
    const toplamVar = sonuc.toplamlar.genel != null;
    const kontrol = toplamVar ? toplamKontrol(sonuc) : { tutuyor: false, sebep: 'toplam_yok' };
    const tutmuyor = toplamVar && !kontrol.tutuyor;
    kutu.innerHTML = `<div class="sade-ekran">
        <h2>📦 ${esc(sonuc.tedarikci ?? 'Fatura')}</h2>
        ${tutmuyor ? `<div class="sade-uyari">⚠️ Toplam tutmuyor, faturaya tekrar bak.
            <button class="dev ikincil" id="tekrar-cek">📷 Tekrar çek</button></div>` : ''}
        <ul class="sade-liste">
          ${stokta.map((s) => { const m = malzemeBul.get(s.karar.malzeme_id);
            return `<li>${tutmuyor ? '⏳' : '✓'} <b>${buyukMiktar(Number(s.miktar) * s.karar.carpan, m.birim)}</b> ${esc(m.ad)}</li>`; }).join('')}
        </ul>
        ${bekleyen.length ? `<p class="buyuk-yazi">⏳ ${bekleyen.length} kalem sonra kontrol edilecek</p>` : ''}
        ${disi.length ? `<p class="bilgi">— ${disi.length} kalem takip dışı (${disi.slice(0, 3).map((s) => esc(s.metin)).join(', ')}${disi.length > 3 ? '…' : ''})</p>` : ''}
        ${toplamVar ? '' : `<p class="buyuk-yazi">Faturanın en altındaki toplam?</p>${rakamKutusu('TL')}`}
        <p class="mesaj ${hata ? 'hata' : ''}">${esc(hata)}</p>
        <button class="dev" id="kaydet">Kaydet ✓</button>
        <button class="metin-dugme" id="vazgec">Vazgeç</button></div>`;
    kutu.querySelector('#tekrar-cek')?.addEventListener('click', () => { temizle(); dosyalar = []; sonuc = null; istek = null; onOkuma = null; belgeEkrani(); });
    kutu.querySelector('#vazgec').onclick = () => { if (confirm('Fatura kaydedilmeden çıkılsın mı?')) { temizle(); bitti(); } };
    kutu.querySelector('#kaydet').onclick = () => {
      if (!toplamVar) {
        const n = sayiOku(kutu.querySelector('#rakam').value);
        if (!Number.isFinite(n) || n <= 0) return ozetEkrani('Faturanın en altındaki toplamı yaz.');
        sonuc.toplamlar.genel = n;
        return ozetEkrani();          // toplam girildi: kontrolü göster, sonra kaydet
      }
      kaydet();
    };
  };

  const kaydet = async () => {
    istek ??= istekKimligi();
    kutu.innerHTML = `<div class="sade-ekran ortada"><div class="buyuk-simge donen">⏳</div><h2>Kaydediliyor…</h2>
      <p class="bilgi" id="durum"></p></div>`;
    const durum = kutu.querySelector('#durum');
    const tk = performance.now();
    try {
      // 1) Dosyaları yükle (tekrar denemede yüklenmiş olanı atla)
      for (const [i, d] of dosyalar.entries()) {
        if (d.yuklenen) continue;
        durum.textContent = `Belge gönderiliyor (${i + 1}/${dosyalar.length})`;
        const blob = d.tur === 'foto' ? await fotoKucult(d.dosya) : d.dosya;
        if (blob.size > 5 * 1024 * 1024) throw new Error('Dosya çok büyük (en fazla 5 MB).');
        const yol = `${mekan.id}/${istek}/${i + 1}.${d.tur === 'foto' ? 'jpg' : d.tur}`;
        const tip = { foto: 'image/jpeg', pdf: 'application/pdf', xml: 'application/xml' }[d.tur];
        const { error } = await sb.storage.from(BELGE_KOVASI).upload(yol, blob, { contentType: tip, upsert: false });
        if (error && !/exists|duplicate/i.test(error.message)) throw error;
        d.yuklenen = yol;
      }
      // 2) Belgeyi kaydet
      durum.textContent = '';
      const satirlar = sonuc.satirlar.map((s) => {
        const evet = s.karar.sinif === 'eslesti' || (s.karar.sinif === 'soru' && s.cevap === 'evet');
        return {
          metin: s.metin, miktar: s.miktar, birim: s.birim, birim_fiyat: s.birim_fiyat ?? null,
          tutar_haric: s.tutar_haric, kdv_orani: s.kdv_orani,
          sinif: evet ? 'eslesti' : s.karar.sinif === 'takip_disi' ? 'takip_disi' : 'belirsiz',
          malzeme_id: evet ? s.karar.malzeme_id : null, carpan: evet ? s.karar.carpan : null,
          barista_onayi: s.karar.sinif === 'soru' && s.cevap === 'evet',
          aday_malzeme_id: s.karar.aday_malzeme_id ?? null,
        };
      });
      const r = await rpcVeri('belge_kaydet', { p: {
        istek_id: istek, tur: 'fatura', kaynak: sonuc.kaynak, dosya_ozeti: await dosyaOzeti(dosyalar[0].dosya),
        ettn: sonuc.ettn, fatura_no: sonuc.fatura_no, tedarikci: sonuc.tedarikci, tedarikci_vkn: sonuc.tedarikci_vkn,
        tarih: sonuc.tarih, toplamlar: sonuc.toplamlar, ayni_olabilir_onay: ayniOnay,
        ai_okuma_id: sonuc.ai_okuma_id ?? null,
        dosyalar: dosyalar.map((d) => d.yuklenen),
        okunan: { kaynak: sonuc.kaynak, guven: sonuc.guven, netlik: sonuc.netlik ?? null, notlar: sonuc.notlar,
                  model: sonuc.model ?? null, maliyet_usd: sonuc.maliyet_usd ?? null, olcum,
                  toplamlar: sonuc.toplamlar, satirlar: sonuc.satirlar,
                  ham_metin: sonuc.ham_metin ?? null },
        satirlar,
      } });
      olcum.kayit_ms = ms(tk, performance.now());
      temizle();
      kaydedildi(kutu, {
        baslik: 'Kaydedildi',
        alt: r.durum === 'tamam' ? 'Stoğa eklendi.' : 'Bazı kalemler sonra kontrol edilecek.',
        geriAl: geriAlIstegi('belge', r.id), bitti,
      });
    } catch (err) {
      const m = err.message ?? '';
      if (/yüklenmiş olabilir/.test(m)) return ayniMiEkrani(m);
      if (/daha önce yüklenmiş|belgeler_(ozet|ettn|no)_uniq/.test(m)) {
        return sadeHata(kutu, /\(/.test(m) ? m : 'Bu fatura daha önce yüklenmiş.', () => { temizle(); bitti(); });
      }
      sadeHata(kutu, /fetch|network|internet/i.test(m) ? 'İnternet yok. Tekrar dene.' : hataMetni(err),
        () => { temizle(); bitti(); }, kaydet);
    }
  };

  const ayniMiEkrani = (mesaj) => {
    kutu.innerHTML = `<div class="sade-ekran ortada">
        <div class="buyuk-simge">🔁</div><h2>${esc(mesaj)}</h2><p class="buyuk-yazi">Aynı fatura mı?</p>
        <button class="dev" id="ayni">Evet, aynı — gönderme</button>
        <button class="dev ikincil" id="farkli">Hayır, farklı fatura — kaydet</button></div>`;
    kutu.querySelector('#ayni').onclick = () => { temizle(); bitti(); };
    kutu.querySelector('#farkli').onclick = () => { ayniOnay = true; kaydet(); };
  };

  belgeEkrani();
}

// =====================================================================================
// KURULUM PANELİ (servis hesabı): tüm mekanların bekleyen satırları
// =====================================================================================

const BEKLEME_SEBEPLERI = {
  eslesme: 'Hangi malzeme?', donusum: 'Birim çevrilemedi', toplam: 'Faturanın toplamı tutmuyor',
  tutar: 'Miktar × fiyat tutmuyor', fiyat: 'Fiyat olağandışı', miktar: 'Miktar olağandışı', eksik: 'Eksik bilgi',
};
const BELGE_BIRIM = { adet: 'adet', kg: 'kg', g: 'g', lt: 'litre', ml: 'ml', diger: 'paket/diğer' };

async function kurulumEkrani(kutu) {
  kutu.innerHTML = '<p class="bilgi">Yükleniyor…</p>';
  const [kuyruk, aiDisi, aiKullanim] = await Promise.all([
    rpcVeri('kurulum_kuyrugu'), rpcVeri('kurulum_ai_takip_disi'), rpcVeri('kurulum_ai_kullanim')]);
  const yenile = () => kurulumEkrani(kutu).catch(hataGoster);
  const toplamBelge = kuyruk.reduce((t, k) => t + k.belgeler.length, 0);
  kutu.innerHTML = `
    ${mekan.id ? '<button class="ikincil tam" id="okuma-testi">🧪 Okuma testi (cevap anahtarıyla)</button>' : ''}
    ${aiKullanim.length ? `<details class="kart"><summary><b>AI kullanımı (son 30 gün)</b></summary>
      <table class="tablo"><tr><th>Mekan</th><th>Model</th><th>Okuma</th><th>Hata</th><th>Ort. süre</th><th>Maliyet</th></tr>
      ${aiKullanim.map((x) => `<tr><td>${esc(x.mekan)}</td><td>${esc(x.model)}</td><td>${x.okuma}</td><td>${x.hata}</td>
        <td>${x.ort_ms != null ? (x.ort_ms / 1000).toFixed(1) + ' sn' : '-'}</td>
        <td>${x.maliyet_usd != null ? '$' + Number(x.maliyet_usd).toFixed(4) : '-'}</td></tr>`).join('')}</table></details>` : ''}
    ${aiDisi.length ? `<details class="kart"><summary><b>AI'nın takip dışı saydıkları (${aiDisi.length})</b></summary>
      <p class="bilgi">Yanlış olanı "Geri al" ile kuyruğa döndür, sonra malzemeye bağla.</p>
      ${aiDisi.map((s) => `<div class="satir"><div>${esc(s.metin)} <small>${esc(s.mekan)} · ${esc(s.tedarikci ?? '')} ·
        ${zamanYaz(s.tarih)}</small></div><button class="ikincil kucuk" data-disi-geri="${s.id}">Geri al</button></div>`).join('')}
      </details>` : ''}
    <h1>Kurulum kuyruğu</h1>
    <p class="bilgi">${toplamBelge ? `${kuyruk.length} mekanda ${toplamBelge} belge bekliyor.` : 'Bekleyen iş yok ✓'}
      Burada çözülen eşleşmeler deftere yazılır; aynı ürün sonraki faturalarda sorusuz geçer.</p>
    ${kuyruk.map((k) => `<h2>${esc(k.mekan)}</h2>${k.belgeler.map((b) => belgeKarti(k, b)).join('')}`).join('')}`;

  kutu.querySelector('#okuma-testi')?.addEventListener('click', () => okumaTestiEkrani(kutu, yenile).catch(hataGoster));
  kutu.querySelectorAll('[data-disi-geri]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try { await rpcVeri('kurulum_takip_disi_geri_al', { p_satir: Number(b.dataset.disiGeri) }); yenile(); }
    catch (err) { hataGoster(err); b.disabled = false; }
  }));

  // Belgeyi aç (geçici bağlantı)
  kutu.querySelectorAll('[data-belge-ac]').forEach((btn) => btn.addEventListener('click', async () => {
    const yollar = JSON.parse(btn.dataset.belgeAc);
    try {
      const { data, error } = await sb.storage.from(BELGE_KOVASI).createSignedUrls(yollar, 3600);
      if (error) throw error;
      btn.outerHTML = `<div class="belgeler">${data.map((d, i) => /\.(jpg|jpeg|png|webp)$/i.test(d.path)
        ? `<a href="${esc(d.signedUrl)}" target="_blank" rel="noopener"><img src="${esc(d.signedUrl)}" alt="Belge ${i + 1}"></a>`
        : `<a class="belge-pdf" href="${esc(d.signedUrl)}" target="_blank" rel="noopener">📄 ${esc(d.path.split('/').pop())}</a>`).join('')}</div>`;
    } catch (err) { hataGoster(err); }
  }));

  // Satır çözme
  kutu.querySelectorAll('form[data-satir]').forEach((form) => {
    const sec = form.querySelector('select[name=malzeme]');
    const carpanInp = form.querySelector('input[name=carpan]');
    const etiket = form.querySelector('.carpan-birim');
    const malzemeler = JSON.parse(form.dataset.malzemeler);
    const birimYaz = () => {
      const m = malzemeler.find((x) => x.id === sec.value);
      etiket.textContent = m ? m.birim : '';
      if (m && !carpanInp.dataset.elle) carpanInp.value = carpanBul(form.dataset.birim, m.birim, form.dataset.metin) ?? '';
    };
    carpanInp.addEventListener('input', () => { carpanInp.dataset.elle = '1'; });
    sec.addEventListener('change', birimYaz);
    if (!carpanInp.value) birimYaz(); else etiket.textContent = malzemeler.find((x) => x.id === sec.value)?.birim ?? '';
    const gonder = async (sonucTur) => {
      const f = Object.fromEntries(new FormData(form));
      const sayi = (v) => (String(v ?? '').trim() ? sayiOku(v) : null);
      try {
        if (sonucTur === 'malzeme' && !f.malzeme) throw new Error('Malzeme seç.');
        await rpcVeri('kurulum_satir_coz', {
          p_satir: Number(form.dataset.satir), p_sonuc: sonucTur, p_malzeme: f.malzeme || null,
          p_carpan: sayi(f.carpan), p_miktar: sayi(f.miktar), p_tutar_haric: sayi(f.tutar), p_kdv_orani: sayi(f.oran),
          p_deftere_yaz: f.defter === 'on',
        });
        yenile();
      } catch (err) { hataGoster(err); }
    };
    form.querySelector('[data-bagla]').onclick = () => gonder('malzeme');
    form.querySelector('[data-disi]').onclick = () => gonder('takip_disi');
  });

  // Belge düzeyi işlemler
  const belgeIslem = (sec, ad, soru) => kutu.querySelectorAll(sec).forEach((b) => b.addEventListener('click', async () => {
    if (soru && !confirm(soru)) return;
    b.disabled = true;
    try { await rpcVeri(ad, { p_belge: b.dataset.id }); yenile(); } catch (err) { hataGoster(err); b.disabled = false; }
  }));
  belgeIslem('[data-kalanlar]', 'kurulum_kalanlar_takip_disi', 'Eşleşme bekleyen kalan satırların hepsi takip dışı sayılsın ve deftere yazılsın mı?');
  belgeIslem('[data-onayla]', 'kurulum_belge_onayla', 'Faturaya baktın ve rakamlar doğru mu? Eşleşmiş satırlar stoğa eklenecek.');
  belgeIslem('[data-reddet]', 'kurulum_belge_reddet', 'Belge reddedilsin mi? Stoğa etkisi geri alınır; barista yeniden yükleyebilir.');
  belgeIslem('[data-rapor-tamam]', 'kurulum_satis_raporu_tamam', 'Satış raporu işlendi olarak işaretlensin mi?');
}

// ---------- 🧪 Okuma testi: dosyaları cevap anahtarıyla karşılaştırır (hiçbir şey kaydetmez) ----------
const TEST_MODELLERI = ['gpt-4.1-mini', 'gpt-4.1-nano'];

async function okumaTestiEkrani(kutu, geri) {
  const [malzemeler, dr, durum] = await Promise.all([
    malzemeleriGetir(false),
    sb.from('eslestirme_defteri').select('tedarikci_anahtar, metin_anahtar, birim, sonuc, malzeme_id, carpan'),
    rpcVeri('ai_okuma_durumu'),
  ]);
  if (dr.error) throw dr.error;
  const malzemeAdi = new Map(malzemeler.map((m) => [m.id, m.ad]));
  const kalan = durum?.[0] ? durum[0].sinir - durum[0].bugun : '?';
  kutu.innerHTML = `
    <button class="ikincil kucuk" id="geri">◀ Kurulum</button>
    <h1>🧪 Okuma testi</h1>
    <p class="bilgi">Dosyalar okunur ve cevap anahtarıyla karşılaştırılır. <b>Hiçbir şey kaydedilmez.</b>
      Eşleştirme bu mekanın malzemeleri (${malzemeler.filter((m) => m.aktif).map((m) => esc(m.ad)).join(', ') || 'yok'})
      ve defteriyle yapılır. Her fotoğraf × model bir AI okuması harcar (bugün kalan: ${kalan}).</p>
    <div class="kart">
      <label>Test dosyaları (fotoğraf, PDF, XML)<input type="file" id="t-dosyalar" multiple
        accept="image/*,application/pdf,.pdf,.xml,text/xml,application/xml"></label>
      <label>Cevap anahtarı (00_CEVAP_ANAHTARI.md)<input type="file" id="t-anahtar" accept=".md,text/markdown,text/plain"></label>
      <p class="bilgi">Fotoğraf ve taranmış PDF için yöntemler:</p>
      ${TEST_MODELLERI.map((m) => `<label class="onay-kutu"><input type="checkbox" data-model="${m}" checked> AI · ${m}</label>`).join('')}
      <label class="onay-kutu"><input type="checkbox" id="t-ocr"> Telefondaki OCR (AI'sız, karşılaştırma için)</label>
      <button class="tam" id="t-basla">Testi başlat</button>
      <p class="mesaj"></p>
    </div>
    <div id="t-sonuc"></div>`;
  kutu.querySelector('#geri').onclick = () => geri();
  const sonucKutu = kutu.querySelector('#t-sonuc');
  const mesaj = kutu.querySelector('.mesaj');

  kutu.querySelector('#t-basla').onclick = async (e) => {
    const dosyalar = [...kutu.querySelector('#t-dosyalar').files].sort((a, b) => a.name.localeCompare(b.name));
    const anahtarDosya = kutu.querySelector('#t-anahtar').files[0];
    const modeller = [...kutu.querySelectorAll('[data-model]:checked')].map((x) => x.dataset.model);
    const ocrDe = kutu.querySelector('#t-ocr').checked;
    if (!dosyalar.length || !anahtarDosya) { mesaj.className = 'mesaj hata'; mesaj.textContent = 'Dosyaları ve cevap anahtarını seç.'; return; }
    e.target.disabled = true;
    const anahtarlar = cevapAnahtariniOku(await anahtarDosya.text());
    const raporlar = [];
    sonucKutu.innerHTML = '';
    const ekle = (r) => { raporlar.push(r); sonucKutu.insertAdjacentHTML('beforeend', testRaporuHtml(r)); };

    for (const dosya of dosyalar) {
      const beklenen = anahtarBelgesi(anahtarlar, dosya.name);
      if (!beklenen?.satirlar.length) { ekle({ dosya: dosya.name, yontem: '-', atlandi: 'Cevap anahtarında bu dosya yok' }); continue; }
      const tur = dosyaTuru(dosya);
      // Okunacak görseller (fotoğraf / taranmış PDF) ya da doğrudan sonuç (XML / metinli PDF)
      let gorseller = null;
      const isler = [];
      const t0 = performance.now();
      if (tur === 'xml') isler.push(['XML (doğrudan)', async () => {
        const t = performance.now(); const s = await xmlDosyaOku(dosya); return { sonuc: s, olcum: { okuma_ms: ms(t, performance.now()) } };
      }]);
      else if (tur === 'pdf') {
        const p = await pdfOku(dosya);
        const pdfMs = ms(t0, performance.now());
        if (p.taranmis) gorseller = p.sayfalar;
        else isler.push(['PDF metni (doğrudan)', async () => ({ sonuc: p, olcum: { okuma_ms: pdfMs } })]);
      } else if (tur === 'foto') gorseller = [dosya];
      if (gorseller) {
        for (const m of modeller) isler.push([`AI · ${m}`, () => aiIleOku(gorseller, m)]);
        if (ocrDe) isler.push(['OCR (telefon)', async () => { const t = performance.now(); const s = await fotolariOku(gorseller); return { sonuc: s, olcum: { ocr_ms: ms(t, performance.now()) } }; }]);
      }
      for (const [yontem, is] of isler) {
        mesaj.className = 'mesaj'; mesaj.textContent = `${dosya.name} · ${yontem} okunuyor…`;
        const t = performance.now();
        try {
          const { sonuc, olcum } = await is();
          const ctx = { malzemeler, defter: dr.data, tedarikciAnahtar: sonuc.tedarikci_vkn || anahtar(sonuc.tedarikci) || '' };
          const sinifla = sonuc.kaynak === 'ai' ? aiIleSiniflandir : siniflandir;
          sonuc.satirlar.forEach((s) => { s.karar = sinifla(s, ctx); });
          ekle({ dosya: dosya.name, yontem, sure_ms: Math.max(ms(t, performance.now()), olcum.okuma_ms ?? 0), olcum, maliyet: sonuc.maliyet_usd ?? null,
                 toplamTutuyor: toplamKontrol(sonuc).tutuyor, sonuc, k: karsilastir(beklenen, sonuc, malzemeAdi) });
        } catch (err) {
          ekle({ dosya: dosya.name, yontem, hata: `${err.kod ?? ''} ${err.message ?? err}`.trim() });
        }
      }
    }
    mesaj.textContent = 'Bitti.';
    sonucKutu.insertAdjacentHTML('afterbegin', `<div class="kart"><h2>Özet</h2>${testOzetiHtml(raporlar)}
      <button class="ikincil kucuk" id="t-kopyala">📋 Sonucu kopyala (sohbete yapıştırmak için)</button></div>`);
    sonucKutu.querySelector('#t-kopyala').onclick = async () => {
      await navigator.clipboard.writeText(testRaporuMetni(raporlar));
      mesaj.textContent = 'Kopyalandı.';
    };
    e.target.disabled = false;
  };
}

const SONUC_SIMGE = { dogru: '✓', yanlis: '✗', kuyruk: '⏳', okunamadi: '—', bilinmiyor: '?' };
const sn = (x) => (x == null ? '-' : `${(x / 1000).toFixed(1)} sn`);
function olcumYazisi(o = {}) {
  return [o.okuma_ms != null && `okuma ${sn(o.okuma_ms)}`, o.kucultme_ms != null && `küçültme ${sn(o.kucultme_ms)}`, o.gonderme_ms != null && `gönderme ${sn(o.gonderme_ms)}`,
    o.ai_ms != null && `AI ${sn(o.ai_ms)}`, o.ocr_ms != null && `OCR ${sn(o.ocr_ms)}`,
    o.boyut_kb != null && `${o.boyut_kb} KB`].filter(Boolean).join(' · ');
}
function testRaporuHtml(r) {
  if (r.atlandi || r.hata) return `<div class="kart"><b>${esc(r.dosya)}</b> · ${esc(r.yontem)} ·
    <span class="uyari">${esc(r.atlandi ?? `Hata: ${r.hata}`)}</span></div>`;
  const o = r.k.ozet;
  return `<div class="kart"><b>${esc(r.dosya)}</b> · ${esc(r.yontem)}
    <p class="bilgi">Süre ${sn(r.sure_ms)} (${olcumYazisi(r.olcum)})${r.maliyet != null ? ` · $${r.maliyet.toFixed(5)}` : ''}
      · Toplam: okunan ${r.k.genel.okunan ?? '?'} / beklenen ${r.k.genel.beklenen ?? '?'} ${r.k.genel.dogru ? '✓' : '✗'}
      · kontrol ${r.toplamTutuyor ? 'tutuyor ✓' : 'tutmuyor ✗'}</p>
    <p><b>✓ ${o.dogru}</b> doğru · <b>✗ ${o.yanlis}</b> yanlış · <b>⏳ ${o.kuyruk}</b> kuyruk · — ${o.okunamadi} okunamadı
      (rakam okuması ${o.okuma_dogru}/${o.satir})</p>
    <table class="tablo"><tr><th>Satır</th><th>Okuma</th><th>Sonuç</th></tr>
    ${r.k.satirlar.map((x) => `<tr><td>${esc(x.beklenen.metin)}<br><small>beklenen: ${esc(x.beklenen.beklenen_yazi)}</small></td>
      <td>${x.okuma === 'dogru' ? '✓' : x.okuma === 'yanlis' ? `✗ <small>${esc(x.okumaNotu)}</small>` : '—'}</td>
      <td>${SONUC_SIMGE[x.sonuc] ?? ''} <small>${esc(x.aciklama)}</small></td></tr>`).join('')}</table>
    ${r.k.fazla.length ? `<p class="bilgi">Anahtarda olmayan okunan satırlar: ${r.k.fazla.map(esc).join(', ')}</p>` : ''}</div>`;
}
function testOzetiHtml(raporlar) {
  return `<table class="tablo"><tr><th>Dosya</th><th>Yöntem</th><th>✓</th><th>✗</th><th>⏳</th><th>Süre</th><th>Maliyet</th></tr>
    ${raporlar.map((r) => `<tr><td>${esc(r.dosya)}</td><td>${esc(r.yontem)}</td>${r.k
      ? `<td>${r.k.ozet.dogru}</td><td>${r.k.ozet.yanlis}</td><td>${r.k.ozet.kuyruk + r.k.ozet.okunamadi}</td>
         <td>${sn(r.sure_ms)}</td><td>${r.maliyet != null ? '$' + r.maliyet.toFixed(5) : '-'}</td>`
      : `<td colspan="5" class="uyari">${esc(r.atlandi ?? r.hata)}</td>`}</tr>`).join('')}</table>`;
}
function testRaporuMetni(raporlar) {
  const satirlar = ['OKUMA TESTİ SONUCU', ''];
  for (const r of raporlar) {
    if (!r.k) { satirlar.push(`${r.dosya} | ${r.yontem} | ${r.atlandi ?? `HATA: ${r.hata}`}`); continue; }
    const o = r.k.ozet;
    satirlar.push(`## ${r.dosya} | ${r.yontem} | doğru ${o.dogru}, yanlış ${o.yanlis}, kuyruk ${o.kuyruk}, okunamadı ${o.okunamadi}`
      + ` | süre ${sn(r.sure_ms)} (${olcumYazisi(r.olcum)}) | maliyet ${r.maliyet != null ? '$' + r.maliyet.toFixed(5) : '-'}`
      + ` | toplam okunan ${r.k.genel.okunan} / beklenen ${r.k.genel.beklenen} | kontrol ${r.toplamTutuyor ? 'tutuyor' : 'TUTMUYOR'}`);
    for (const x of r.k.satirlar) {
      satirlar.push(`- ${x.beklenen.metin} → okuma ${x.okuma}${x.okumaNotu ? ` (${x.okumaNotu})` : ''} → ${x.sonuc}: ${x.aciklama}`);
    }
    if (r.k.fazla.length) satirlar.push(`- fazladan okunan: ${r.k.fazla.join(', ')}`);
    satirlar.push(`- okunan ham: ${JSON.stringify(r.sonuc.satirlar.map((s) => [s.metin, s.miktar, s.birim, s.tutar_belge ?? s.tutar_haric, s.kdv_orani, s.ai?.karar, s.ai?.guven]))}`);
  }
  return satirlar.join('\n');
}

function belgeKarti(k, b) {
  const dosyaDugmesi = b.dosyalar.length
    ? `<button class="ikincil kucuk" data-belge-ac='${esc(JSON.stringify(b.dosyalar.map((d) => d.yol)))}'>📄 Belgeyi aç (${b.dosyalar.length})</button>` : '';
  if (b.tur === 'satis_raporu') {
    return `<div class="kart"><b>💰 Satış raporu</b> · ${esc(b.giren_ad)} · ${zamanYaz(b.olusturma)}<br>${dosyaDugmesi}
      <p class="bilgi">Satışlar patron ekranından girilir (Girişler → Satış gir). Girildikten sonra işaretle.</p>
      <button class="kucuk" data-rapor-tamam data-id="${esc(b.id)}">İşlendi ✓</button></div>`;
  }
  const satirToplam = b.satirlar.reduce((t, s) => t + Number(s.tutar_haric ?? 0) * (1 + Number(s.kdv_orani ?? 0) / 100), 0);
  const bekleyen = b.satirlar.filter((s) => s.durum === 'bekliyor');
  const eslesmeBekleyen = bekleyen.filter((s) => s.sebep === 'eslesme');
  const malzemelerJson = esc(JSON.stringify(k.malzemeler));
  return `<div class="kart kurulum-belge">
    <b>📦 ${esc(b.tedarikci ?? 'Tedarikçi okunamadı')}</b> · ${b.tarih ? tarihYaz(b.tarih) : 'tarih yok'}
      ${b.fatura_no ? ` · ${esc(b.fatura_no)}` : ''} · ${esc(b.kaynak.toUpperCase())}
    <small class="bilgi">${esc(b.giren_ad)} · ${zamanYaz(b.olusturma)}</small>
    <p class="${b.toplam_tutuyor ? 'tamam' : 'hata'}">Genel toplam ${b.genel_toplam != null ? tl.format(b.genel_toplam) : '?'} ·
      satırlar ${tl.format(satirToplam)}${Number(b.indirim) ? ` · indirim ${tl.format(b.indirim)}` : ''}
      ${b.toplam_tutuyor ? '✓' : '✗ tutmuyor'}</p>
    ${dosyaDugmesi}
    ${b.satirlar.map((s) => s.durum !== 'bekliyor'
      ? `<div class="kurulum-satir cozuldu">${s.durum === 'stokta' ? '✓' : '—'} ${esc(s.metin)}
          <small>${s.miktar ?? '?'} ${BELGE_BIRIM[s.birim] ?? ''} · ${s.tutar_haric != null ? tl.format(s.tutar_haric) : '?'}
          ${s.durum === 'takip_disi' ? ' · takip dışı' : ''}</small></div>`
      : `<form class="kurulum-satir" data-satir="${s.id}" data-birim="${esc(s.birim ?? 'diger')}" data-metin="${esc(s.metin)}"
            data-malzemeler="${malzemelerJson}" onsubmit="return false">
          <b>${esc(s.metin)}</b> <span class="rozet">${esc(BEKLEME_SEBEPLERI[s.sebep] ?? s.sebep)}</span>
          <div class="kurulum-alanlar">
            <label>Malzeme<select name="malzeme"><option value="">Seç</option>${k.malzemeler.map((m) =>
              `<option value="${esc(m.id)}" ${(s.malzeme_id ?? s.aday_malzeme_id) === m.id ? 'selected' : ''}>${esc(m.ad)}</option>`).join('')}</select></label>
            <label>1 ${BELGE_BIRIM[s.birim] ?? 'birim'} = <span class="yan"><input name="carpan" inputmode="decimal" value="${s.carpan ?? ''}"><span class="carpan-birim"></span></span></label>
            <label>Miktar (${BELGE_BIRIM[s.birim] ?? '?'})<input name="miktar" inputmode="decimal" value="${s.miktar ?? ''}"></label>
            <label>Tutar (KDV hariç)<input name="tutar" inputmode="decimal" value="${s.tutar_haric ?? ''}"></label>
            <label>KDV %<input name="oran" inputmode="decimal" value="${s.kdv_orani ?? ''}"></label>
          </div>
          <label class="onay-kutu"><input type="checkbox" name="defter" ${['eslesme', 'donusum'].includes(s.sebep) ? 'checked' : ''}>
            Deftere yaz (sonraki faturalarda otomatik)</label>
          <div class="dugmeler"><button class="kucuk" type="button" data-bagla>Bağla ✓</button>
            <button class="ikincil kucuk" type="button" data-disi>Takip dışı</button></div>
        </form>`).join('')}
    <div class="dugmeler belge-dugmeleri">
      ${eslesmeBekleyen.length ? `<button class="ikincil kucuk" data-kalanlar data-id="${esc(b.id)}">Kalanların hepsi takip dışı (${eslesmeBekleyen.length})</button>` : ''}
      ${!b.toplam_tutuyor ? `<button class="kucuk" data-onayla data-id="${esc(b.id)}">Rakamlar doğru, onayla</button>` : ''}
      <button class="ikincil kucuk" data-reddet data-id="${esc(b.id)}">Belgeyi reddet</button>
    </div></div>`;
}

// Giriş durumuna göre doğru ekranı açar.
async function goster() {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return girisEkrani();
    ustSag.innerHTML = '<button class="kucuk">Çıkış</button>';
    ustSag.querySelector('button').onclick = cikis;
    const [ur, kr] = await Promise.all([
      sb.from('uyeler').select('rol, ad, mekan_id, mekanlar(ad, davet_kodu, kdv_gosterim)')
        .eq('user_id', session.user.id).maybeSingle(),
      sb.rpc('kurulumcu_muyum'),
    ]);
    if (ur.error) throw ur.error;
    kurulumcu = kr.data === true;
    document.body.classList.toggle('sade', ur.data?.rol === 'barista');
    if (!ur.data) return kurulumcu ? kurulumEkrani(app) : mekanSecEkrani(session.user);
    await anaEkran(session.user, ur.data);
  } catch (err) {
    app.innerHTML = `<div class="kart"><p class="hata">${esc(hataMetni(err))}</p>
      <button class="tam" id="tekrar">Tekrar dene</button></div>`;
    app.querySelector('#tekrar').onclick = goster;
  }
}

goster();
