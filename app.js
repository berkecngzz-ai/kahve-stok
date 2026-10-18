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

async function anaEkran(user, uye) {
  const patron = uye.rol === 'patron';
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
      <h2>Mekandaki kişiler</h2>
      ${uyeler.map((u) => `
        <div class="satir">
          <div>${esc(u.ad)} <span class="rozet">${u.rol === 'patron' ? 'Patron' : 'Barista'}</span>
            <small>${esc(u.eposta)}</small></div>
          ${patron && u.user_id !== user.id
            ? `<button class="ikincil kucuk" data-cikar="${esc(u.user_id)}" data-ad="${esc(u.ad)}">Çıkar</button>` : ''}
        </div>`).join('')}
    </div>`;

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
  const { data, error } = await sb.from('malzemeler').select('id, ad, birim, fiyat, aktif');
  if (error) throw error;
  return data.sort(adaGore);
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
          ? `1 ${BIRIMLER[m.birim].fiyatBirimi}: ${tl.format(m.fiyat)}`
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
        value="${d ? esc(String(d.fiyat).replace('.', ',')) : ''}" placeholder="Örn. 42,50">
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
  formBagla(form, async ({ ad, birim, fiyat }) => {
    const f = sayiOku(fiyat);
    if (!Number.isFinite(f) || f >= 10000000) throw new Error('Fiyatı sayı olarak yaz. Örn. 42,50');
    const kayit = { ad: ad.trim(), fiyat: Math.round(f * 100) / 100 };
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
  let toplam = 0, fiyatsiz = false, pasif = false;
  for (const k of kalemler) {
    const m = malzemeBul.get(k.malzeme_id);
    const miktar = sayiOku(k.miktar);
    if (!m || !(miktar > 0)) continue;
    toplam += (miktar * Number(m.fiyat)) / BIRIMLER[m.birim].bolen;
    if (!(Number(m.fiyat) > 0)) fiyatsiz = true;
    if (!m.aktif) pasif = true;
  }
  return `Maliyet: ${tl.format(toplam)}`
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
      .select('fiyat, tarih, kaynak, degistiren_ad, giris_id')
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
      return `<div class="gecmis-satir${iptal ? ' iptal' : ''}">${tarihYaz(f.tarih)} · <b>${tl.format(f.fiyat)}</b>
        · ${KAYNAKLAR[f.kaynak]}${f.degistiren_ad ? ` (${esc(f.degistiren_ad)})` : ''}${iptal ? ' · fatura iptal edildi' : ''}</div>`;
    }).join('') : '<p class="bilgi">Henüz kayıt yok.</p>';
  } catch (err) {
    delete det.dataset.yuklendi;
    kutu.innerHTML = `<p class="hata">${esc(hataMetni(err))}</p>`;
  }
}

// ---------- Girişler: fatura, satış, fire, sayım ----------

const TURLER = {
  fatura: { ad: 'Fatura', dugme: 'Fatura gir', not: 'Gelen malı faturadaki gibi gir. Tutar, satırın toplam TL tutarıdır.' },
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
  for (let i = 0; i < girisler.length; i += 100) {
    const { data, error } = await sb.from('giris_kalemleri')
      .select('giris_id, malzeme_id, urun_id, miktar, tutar')
      .in('giris_id', girisler.slice(i, i + 100).map((g) => g.id)).order('id');
    if (error) throw error;
    kalemler.push(...data);
  }
  const malzemeBul = new Map(malzemeler.map((m) => [m.id, m]));
  const urunBul = new Map(ur.data.map((u) => [u.id, u]));
  const ctx = { user, patron, malzemeler, malzemeBul, urunler: ur.data.sort(adaGore), urunBul };

  const kalemYaz = (k) => {
    if (k.urun_id) return `${esc(urunBul.get(k.urun_id)?.ad ?? '?')} × ${sayiYaz(Number(k.miktar))}`;
    const m = malzemeBul.get(k.malzeme_id);
    if (!m) return '?';
    return `${esc(m.ad)}: ${buyukMiktar(k.miktar, m.birim)}${k.tutar != null ? ` · ${tl.format(k.tutar)}` : ''}`;
  };
  const bugun = bugunStr();
  const girisYaz = (g) => {
    const satirlar = kalemler.filter((k) => k.giris_id === g.id);
    const toplam = g.tur === 'fatura' ? satirlar.reduce((t, k) => t + Number(k.tutar ?? 0), 0) : null;
    const iptalEdebilir = !g.iptal_zamani
      && (patron || (g.giren === user.id && gunu(g.olusturma) === bugun));
    return `
      <details class="giris${g.iptal_zamani ? ' iptal' : ''}">
        <summary>
          <b>${TURLER[g.tur].ad}</b> · ${tarihYaz(g.tarih)}${g.aciklama ? ` · ${esc(g.aciklama)}` : ''}
          <small>${esc(g.giren_ad)} · ${satirlar.length} satır${toplam != null ? ` · ${tl.format(toplam)}` : ''}
            ${g.iptal_zamani ? ' · <span class="uyari">İPTAL</span>' : ''}</small>
        </summary>
        <ul>${satirlar.map((k) => `<li>${kalemYaz(k)}</li>`).join('')}</ul>
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
  icerik.querySelectorAll('[data-yeni]').forEach((b) => b.addEventListener('click', () => {
    girisFormu(icerik, b.dataset.yeni, ctx, yenile);
    window.scrollTo(0, 0);
  }));
  icerik.querySelectorAll('[data-iptal]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Bu giriş iptal edilsin mi? Silinmez; iptal edildi olarak kalır ve hesaplara katılmaz.')) return;
    b.disabled = true;
    const { error } = await sb.rpc('giris_iptal', { p_id: b.dataset.iptal });
    if (error) { hataGoster(error); b.disabled = false; return; }
    yenile();
  }));
}

// Yeni giriş formu. Fatura ve fire satır satır; satış ve sayım tam liste halinde girilir.
function girisFormu(icerik, tur, ctx, bitti) {
  const { malzemeler, malzemeBul, urunler, urunBul } = ctx;
  const aktifMalzemeler = malzemeler.filter((m) => m.aktif);
  const aktifUrunler = urunler.filter((u) => u.aktif);
  const liste = tur === 'satis' ? aktifUrunler : tur === 'sayim' ? aktifMalzemeler : null;
  const bugun = bugunStr();
  const enEski = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  // Satır satır girişlerde her satır: { secim: 'm:<id>' | 'u:<id>' | '', miktar, tutar }
  const satirlar = [{ secim: '', miktar: '', tutar: '' }];

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
      ${tur === 'fatura' ? `<label for="g-aciklama">Tedarikçi (isteğe bağlı)</label>
        <input id="g-aciklama" name="aciklama" maxlength="200" placeholder="Örn. Metro">` : ''}
      ${tur === 'fire' ? `<label for="g-aciklama">Sebep</label>
        <select id="g-aciklama" name="aciklama" required><option value="">Seç</option>
          ${FIRE_SEBEPLERI.map((s) => `<option>${s}</option>`).join('')}</select>` : ''}
      <div id="satirlar"></div>
      ${liste ? '' : '<button class="ikincil kucuk" type="button" id="satir-ekle">+ Satır ekle</button>'}
      <p class="bilgi" id="ozet"></p>
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
  const ozetYaz = () => {
    if (tur !== 'fatura') return;
    const toplam = satirlar.reduce((t, s) => t + (sayiOku(s.tutar) || 0), 0);
    form.querySelector('#ozet').textContent = `Fatura toplamı: ${tl.format(toplam)}`;
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
      <option value="">${tur === 'fire' ? 'Malzeme ya da ürün seç' : 'Malzeme seç'}</option>
      <optgroup label="Malzemeler">${aktifMalzemeler.map((m) =>
        `<option value="m:${esc(m.id)}" ${secili === `m:${m.id}` ? 'selected' : ''}>${esc(m.ad)}</option>`).join('')}</optgroup>
      ${tur === 'fire' && aktifUrunler.length ? `<optgroup label="Ürünler (tarifiyle düşülür)">${aktifUrunler.map((u) =>
        `<option value="u:${esc(u.id)}" ${secili === `u:${u.id}` ? 'selected' : ''}>${esc(u.ad)}</option>`).join('')}</optgroup>` : ''}`;
    const ciz = () => {
      kutu.innerHTML = satirlar.map((s, i) => `
        <div class="giris-satir">
          <select data-i="${i}" aria-label="Malzeme">${secenekler(s.secim)}</select>
          <div class="giris-alt">
            <input data-i="${i}" data-alan="miktar" inputmode="decimal" autocomplete="off"
              placeholder="Miktar" aria-label="Miktar" value="${esc(s.miktar)}">
            <span class="birim">${birimEtiketi(s.secim)}</span>
            ${tur === 'fatura' ? `<input data-i="${i}" data-alan="tutar" inputmode="decimal" autocomplete="off"
              placeholder="Tutar (TL)" aria-label="Tutar" value="${esc(s.tutar)}">` : ''}
            <button class="ikincil kucuk" type="button" data-sil="${i}" aria-label="Satırı sil">✕</button>
          </div>
        </div>`).join('');
      kutu.querySelectorAll('select').forEach((sel) => sel.addEventListener('change', () => {
        satirlar[sel.dataset.i].secim = sel.value;
        ciz();
      }));
      kutu.querySelectorAll('input').forEach((inp) => inp.addEventListener('input', () => {
        satirlar[inp.dataset.i][inp.dataset.alan] = inp.value;
        ozetYaz();
      }));
      kutu.querySelectorAll('[data-sil]').forEach((b) => b.addEventListener('click', () => {
        satirlar.splice(Number(b.dataset.sil), 1);
        if (!satirlar.length) satirlar.push({ secim: '', miktar: '', tutar: '' });
        ciz();
      }));
      ozetYaz();
    };
    ciz();
    form.querySelector('#satir-ekle').addEventListener('click', () => {
      satirlar.push({ secim: '', miktar: '', tutar: '' });
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
      const dolu = satirlar.filter((s) => s.secim || String(s.miktar).trim() || String(s.tutar).trim());
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
        const kalem = { malzeme_id: id, miktar: kucukMiktar(n, m.birim) };
        if (tur === 'fatura') {
          const t = sayiOku(s.tutar);
          if (!Number.isFinite(t)) throw new Error(`${m.ad} için tutarı yaz. Ücretsiz geldiyse 0 yaz.`);
          kalem.tutar = Math.round(t * 100) / 100;
        }
        return kalem;
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

// Giriş durumuna göre doğru ekranı açar.
async function goster() {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return girisEkrani();
    ustSag.innerHTML = '<button class="kucuk">Çıkış</button>';
    ustSag.querySelector('button').onclick = cikis;
    const { data: uye, error } = await sb.from('uyeler')
      .select('rol, ad, mekanlar(ad, davet_kodu)')
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
