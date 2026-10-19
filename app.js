import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

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

async function anaEkran(user, uye) {
  const patron = uye.rol === 'patron';
  mekan = { id: uye.mekan_id, kdv_gosterim: uye.mekanlar.kdv_gosterim ?? 'dahil' };
  const sekmeler = [['giris', 'Girişler'], ['malzeme', 'Malzeme'], ['urun', 'Ürünler'], ['mekan', 'Mekan']];
  app.innerHTML = `
    <h1>${esc(uye.mekanlar.ad)}</h1>
    <p><span class="rozet">${patron ? 'Patron' : 'Barista'}</span> ${esc(uye.ad)}</p>
    <div class="sekmeler dort">
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
  return girisSekmesi(icerik, user, patron);
}

async function mekanSekmesi(icerik, user, uye, patron) {
  const { data: uyeler, error } = await sb.from('uyeler')
    .select('user_id, ad, rol, eposta').order('olusturma');
  if (error) throw error;

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

async function malzemeleriGetir() {
  const { data, error } = await sb.from('malzemeler').select('id, ad, birim, fiyat, fiyat_haric, kdv_orani, aktif');
  if (error) throw error;
  return data.sort(adaGore);
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
  }
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

  icerik.innerHTML = `
    <div class="izgara">
      ${Object.entries(TURLER).map(([k, t]) => `<button data-yeni="${k}">${t.dugme}</button>`).join('')}
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
async function fotoKucult(dosya) {
  const url = URL.createObjectURL(dosya);
  try {
    const img = new Image();
    img.src = url;
    try { await img.decode(); } catch { throw new Error('Fotoğraf açılamadı. Başka bir fotoğraf dene.'); }
    const olcek = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * olcek);
    c.height = Math.round(img.naturalHeight * olcek);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8));
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

// Giriş durumuna göre doğru ekranı açar.
async function goster() {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return girisEkrani();
    ustSag.innerHTML = '<button class="kucuk">Çıkış</button>';
    ustSag.querySelector('button').onclick = cikis;
    const { data: uye, error } = await sb.from('uyeler')
      .select('rol, ad, mekan_id, mekanlar(ad, davet_kodu, kdv_gosterim)')
      .eq('user_id', session.user.id).maybeSingle();
    if (error) throw error;
    if (!uye) return mekanSecEkrani(session.user);
    await anaEkran(session.user, uye);
  } catch (err) {
    app.innerHTML = `<div class="kart"><p class="hata">${esc(hataMetni(err))}</p>
      <button class="tam" id="tekrar">Tekrar dene</button></div>`;
    app.querySelector('#tekrar').onclick = goster;
  }
}

goster();
