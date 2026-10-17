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

async function anaEkran(user, uye) {
  const patron = uye.rol === 'patron';
  const { data: uyeler, error } = await sb.from('uyeler')
    .select('user_id, ad, rol, eposta').order('olusturma');
  if (error) throw error;

  app.innerHTML = `
    <h1>${esc(uye.mekanlar.ad)}</h1>
    <p><span class="rozet">${patron ? 'Patron' : 'Barista'}</span> ${esc(uye.ad)}</p>
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
    </div>
    <div class="kart"><p class="bilgi">Malzemeler, fatura, satış ve sayım ekranları sonraki adımlarda gelecek.</p></div>`;

  app.querySelector('#yenile')?.addEventListener('click', async (e) => {
    if (!confirm('Davet kodu yenilensin mi? Eski kod artık çalışmayacak.')) return;
    e.target.disabled = true;
    const { error } = await sb.rpc('davet_kodu_yenile');
    if (error) { alert(hataMetni(error)); e.target.disabled = false; return; }
    goster();
  });
  app.querySelectorAll('[data-cikar]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(`${b.dataset.ad} mekandan çıkarılsın mı?`)) return;
    const { error } = await sb.rpc('uye_cikar', { p_user_id: b.dataset.cikar });
    if (error) { alert(hataMetni(error)); return; }
    goster();
  }));
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
