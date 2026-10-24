import { readSalesFile, salesFileKind } from './satis-okuma.js';
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { dosyaTuru, dosyaOzeti, xmlDosyaOku, pdfOku, pdfIlkSayfa, fotolariOku, toplamKontrol, aiSonucunuCevir } from './okuma.js';
import { anahtar, aiIleSiniflandir, carpanBul } from './eslestirme.js';
import { karekodOnce, karekodBul, karekodlaKarsilastir, karekoduUygula } from './karekod.js';
import { ayniMiktar, teslimatKarari, satirEsle, kesinKaynak } from './mal-kabul.js';
import { okunurMiktar, tlYaz, miktarTl, acikDurumu, acikOrani, donemYaz, yeterDurumu, trendSvg, raporCsv,
  ACIK_ORAN_ESIGI, ACIK_TL_ESIGI } from './patron-hesap.js';

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
    ['Could not find the function', 'Uygulama güncelleniyor. Birkaç dakika sonra tekrar dene.'],
    ['JWT expired', 'Oturumun süresi doldu. Çıkış yapıp tekrar giriş yap.'],
    ['NetworkError', 'İnternet bağlantısı yok. Bağlantını kontrol edip tekrar dene.'],
    ['Load failed', 'İnternet bağlantısı yok. Bağlantını kontrol edip tekrar dene.'],
    ['timeout', 'Sunucu geç cevap verdi. Tekrar dene.'],
    ['aborted', 'Sunucu geç cevap verdi. Tekrar dene.'],
    ['duplicate key', 'Bu kayıt zaten var.'],
  ];
  const bulunan = tablo.find(([en]) => m.toLowerCase().includes(en.toLowerCase()));
  if (bulunan) return bulunan[1];
  // Kendi mesajlarımız Türkçedir; teknik (İngilizce) bir hata ekrana olduğu gibi yazılmaz.
  if (/violates|constraint|syntax|column|relation|null value|invalid input|TypeError|Cannot read|undefined|status code/i.test(m)) {
    console.error(err);
    return 'Bir şey ters gitti, kayıt yapılmadı. Tekrar dene; sürerse patrona haber ver.';
  }
  return m;
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
  uyeOnbellek = null;
  aktifSekme = 'ozet';
  // Seçimler mekana özel: aynı telefonda başka mekanın hesabı açılınca eski hafta/ay seçili kalmasın.
  secilenSayim = null; secilenAy = null; girisTuru = 'hepsi'; ayarSekme = 'malzeme';
  document.body.classList.remove('patron');
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
let aktifSekme = 'ozet';
// Ayarlar içindeki alt sekme (malzeme, urun, mekan, kurulum).
let ayarSekme = 'malzeme';
// Raporlarda (indirilen dosyada) görünen mekan adı.
let mekanAdi = '';
// Giriş yapan kişinin mekanı.
let mekan = { id: null };
// Giriş yapan kişi kurulum (servis) hesabı mı?
let kurulumcu = false;

async function anaEkran(user, uye) {
  const patron = uye.rol === 'patron';
  mekan = { id: uye.mekan_id };
  if (!patron) return baristaEkrani(user, uye);
  mekanAdi = uye.mekanlar.ad;
  if (!PATRON_SEKMELER.some(([k]) => k === aktifSekme)) aktifSekme = 'ozet';
  if (ayarSekme === 'kurulum' && !kurulumcu) ayarSekme = 'malzeme';
  app.innerHTML = `
    <div class="baslik-satir"><h1>${esc(uye.mekanlar.ad)}</h1><span class="rozet">Patron · ${esc(uye.ad)}</span></div>
    <div id="icerik"><div class="iskelet"></div><div class="iskelet kisa"></div></div>
    <nav class="alt-menu" aria-label="Bölümler">
      ${PATRON_SEKMELER.map(([k, ad, ikon]) => `<button data-sekme="${k}" class="${aktifSekme === k ? 'secili' : ''}"
        ${aktifSekme === k ? 'aria-current="page"' : ''}>${ikon}<span>${ad}</span></button>`).join('')}
    </nav>`;
  app.querySelectorAll('[data-sekme]').forEach((b) => b.addEventListener('click', () => {
    aktifSekme = b.dataset.sekme;
    window.scrollTo(0, 0);
    goster();
  }));
  const icerik = app.querySelector('#icerik');
  if (aktifSekme === 'stok') return stokSekmesi(icerik);
  if (aktifSekme === 'rapor') return stokFarkiSekmesi(icerik);
  if (aktifSekme === 'giris') return girisSekmesi(icerik, user, patron);
  if (aktifSekme === 'ayar') return ayarlarSekmesi(icerik, user, uye, patron);
  return ozetSekmesi(icerik);
}

// Alt menü simgeleri (ince çizgi, yazı rengini alır).
const ikon = (yol) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9"
  stroke-linecap="round" stroke-linejoin="round">${yol}</svg>`;
const PATRON_SEKMELER = [
  ['ozet', 'Özet', ikon('<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10"/>')],
  ['stok', 'Stok', ikon('<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="m3 7.5 9 4.5 9-4.5M12 12v9"/>')],
  ['rapor', 'Rapor', ikon('<path d="M5 20V11M11 20V5M17 20v-6M3 20h18"/>')],
  ['giris', 'Girişler', ikon('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>')],
  ['ayar', 'Ayarlar', ikon('<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>')],
];

// Ayarlar: malzemeler, ürünler (tarifler), mekan ve (servis hesabıysa) kurulum.
function ayarlarSekmesi(icerik, user, uye, patron) {
  const alt = [['malzeme', 'Malzemeler'], ['urun', 'Ürünler'], ['mekan', 'Mekan']];
  if (kurulumcu) alt.push(['kurulum', 'Kurulum']);
  icerik.innerHTML = `
    <div class="sekmeler ${alt.length > 3 ? 'dort' : ''}">
      ${alt.map(([k, ad]) => `<button data-ayar="${k}" class="${ayarSekme === k ? 'secili' : ''}">${ad}</button>`).join('')}
    </div>
    <div id="ayar-icerik"><div class="iskelet"></div></div>`;
  icerik.querySelectorAll('[data-ayar]').forEach((b) => b.addEventListener('click', () => {
    ayarSekme = b.dataset.ayar;
    ayarlarSekmesi(icerik, user, uye, patron).catch(hataGoster);
  }));
  const kutu = icerik.querySelector('#ayar-icerik');
  if (ayarSekme === 'urun') return urunSekmesi(kutu, patron);
  if (ayarSekme === 'mekan') return mekanSekmesi(kutu, user, uye, patron);
  if (ayarSekme === 'kurulum') return kurulumEkrani(kutu);
  return malzemeSekmesi(kutu, patron);
}

// ---------- Özet: patron telefonu açınca 10 saniyede durumu görür ----------

// Bir dönemde açık "büyük" mü: en çok açık veren malzemelerden biri eşiği geçiyorsa (Rapor'la aynı kural).
const donemBuyukMu = (d) => (d.en_cok_acik || []).some((x) => acikDurumu(x) === 'buyuk');
const kisaTarih = (t) => new Date(`${t}T12:00:00`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });

// Kurulumda bekleyen (okunamamış) fatura / satış raporu uyarısı.
function bekleyenUyarisi(eksik) {
  const parca = [];
  if (eksik?.bekleyen_fatura) parca.push(`${eksik.bekleyen_fatura} fatura`);
  if (eksik?.bekleyen_satis_raporu) parca.push(`${eksik.bekleyen_satis_raporu} satış raporu`);
  if (!parca.length) return '';
  return `<div class="durum-kart sari" role="status"><b>${parca.join(' ve ')} kontrol bekliyor</b>
    <span>Fotoğraftan okunamadı, ekibimiz işliyor. İşlenince rakamlar değişebilir${eksik.en_eski
      ? ` (en eskisi ${esc(kisaTarih(eksik.en_eski))})` : ''}.</span></div>`;
}

// ---------- Teslimat kontrolü: faturadaki ile sayılan farklıysa patronun görevi (kararı patron verir) ----------
const COZUMLER = [['iade', 'İade alındı'], ['sonra_geldi', 'Sonraki teslimatta geldi'], ['indirim', 'İndirim yapıldı'],
  ['fark_yok', 'Fark yok (sayım hatası)'], ['diger', 'Diğer…']];

function teslimatKarti(gorevler) {
  if (!gorevler.length) return '';
  return `<section class="kart gorev-kart" id="teslimat-gorevleri">
    <h2>Teslimat kontrolü <span class="rozet">${gorevler.length}</span></h2>
    ${gorevler.map((g) => {
      const fark = Number(g.faturadaki) - Number(g.gelen);
      const oran = Number(g.faturadaki) > 0 ? Math.max(0, Math.min(100, (Number(g.gelen) / Number(g.faturadaki)) * 100)) : 0;
      return `<div class="gorev" data-gorev="${esc(g.id)}">
        <div class="gorev-ust">
          <span class="gorev-ikon" aria-hidden="true">${malzemeIkonu({ ad: g.malzeme, birim: g.birim })}</span>
          <div class="gorev-baslik"><b>${esc(g.malzeme)}: ${okunurMiktar(Math.abs(fark), g.birim)} ${fark > 0 ? 'eksik' : 'fazla'} teslimat</b>
            <small>${esc(g.tedarikci ?? 'Fatura')} · ${g.belge_tarihi ? esc(kisaTarih(g.belge_tarihi)) : ''}${g.fark_tl != null
              ? ` · ${tlYaz(Math.abs(g.fark_tl))}` : ''}</small></div>
        </div>
        <div class="teslim-cubuk" aria-hidden="true"><span style="width:${oran.toFixed(1)}%"></span></div>
        <div class="teslim-rakam"><span>Faturada <b>${okunurMiktar(g.faturadaki, g.birim)}</b></span>
          <span>Gelen <b>${okunurMiktar(g.gelen, g.birim)}</b></span></div>
        ${g.okuma_supheli ? '<p class="uyari-yazi">Okuma şüpheli: karar vermeden önce faturaya bak.</p>' : ''}
        ${g.barista_notu ? `<p class="barista-notu">“${esc(g.barista_notu)}” · ${esc(g.giren_ad ?? '')}</p>` : ''}
        ${g.dosyalar?.length ? `<details class="fatura-gor"><summary>Faturayı gör</summary>
          <div class="belgeler" data-dosyalar="${esc(JSON.stringify(g.dosyalar))}"></div></details>` : ''}
        <div class="cozum-dugmeleri">${COZUMLER.map(([k, ad]) => `<button class="ikincil kucuk" data-cozum="${k}">${ad}</button>`).join('')}</div>
        <div class="cozum-not" hidden><input maxlength="300" placeholder="Ne oldu? (kısa açıklama)" aria-label="Açıklama">
          <button class="kucuk" data-cozum-kaydet>Kapat</button></div>
        <p class="mesaj"></p>
      </div>`;
    }).join('')}
  </section>`;
}

function teslimatKartiBagla(icerik, yenile) {
  icerik.querySelectorAll('#teslimat-gorevleri details.fatura-gor').forEach((d) => d.addEventListener('toggle', () => {
    const kutu = d.querySelector('[data-dosyalar]');
    if (d.open && kutu) belgeleriGoster(kutu, JSON.parse(kutu.dataset.dosyalar));
  }));
  icerik.querySelectorAll('#teslimat-gorevleri .gorev').forEach((g) => {
    const mesaj = g.querySelector('.mesaj');
    const kapat = async (cozum, not = null) => {
      g.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      try {
        await rpcVeri('teslimat_farki_coz', { p_id: g.dataset.gorev, p_cozum: cozum, p_not: not });
        yenile();
      } catch (err) {
        g.querySelectorAll('button').forEach((b) => { b.disabled = false; });
        mesaj.className = 'mesaj hata';
        mesaj.textContent = hataMetni(err);
      }
    };
    g.querySelectorAll('[data-cozum]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.cozum === 'diger') { g.querySelector('.cozum-not').hidden = false; g.querySelector('.cozum-not input').focus(); return; }
      kapat(b.dataset.cozum);
    }));
    g.querySelector('[data-cozum-kaydet]').addEventListener('click', () => {
      const not = g.querySelector('.cozum-not input').value.trim();
      if (!not) { mesaj.className = 'mesaj hata'; mesaj.textContent = 'Kısa bir açıklama yaz.'; return; }
      kapat('diger', not);
    });
  });
}

// ---------- Fiyatı doğrulanmayan kalemler (patron) ----------
// Mal stoğa girdi ama fiyatı doğrulanamadı (KDV belirsiz ya da fatura toplamı tutmadı). Patron faturadaki tutarı
// (KDV dahil) yazar ya da kayıtlı fiyatı onaylar. Vergi sorusu yok.
function fiyatKontrolKarti(liste) {
  if (!liste?.length) return '';
  return `<section class="kart gorev-kart" id="fiyat-kontrol">
    <h2>Fiyatı doğrulanmayanlar <span class="rozet">${liste.length}</span></h2>
    <p class="bilgi kucuk-yazi">Mal stoğa girdi. Faturaya bakıp bu satırın tutarını yaz; o zamana kadar TL hesapları
      son onaylı fiyatla tahminidir.</p>
    ${liste.map((x) => `<div class="gorev" data-fk="${esc(x.id)}">
        <div class="gorev-ust">
          <span class="gorev-ikon" aria-hidden="true">${malzemeIkonu({ ad: x.malzeme, birim: x.birim })}</span>
          <div class="gorev-baslik"><b>${esc(x.malzeme)}: ${okunurMiktar(x.faturadaki ?? x.miktar, x.birim)}</b>
            <small>${esc(x.tedarikci ?? 'Fatura')} · ${esc(kisaTarih(x.tarih))}${x.satir_metni ? ` · ${esc(x.satir_metni)}` : ''}</small></div>
        </div>
        ${x.toplam_tutuyor === false ? '<p class="uyari-yazi">Fatura toplamı tutmuyor: fotoğrafı kontrol et.</p>' : ''}
        ${x.dosyalar?.length ? `<details class="fatura-gor"><summary>Faturayı gör</summary>
          <div class="belgeler" data-dosyalar="${esc(JSON.stringify(x.dosyalar))}"></div></details>` : ''}
        <label class="not-alani">Faturada bu satırın tutarı (TL, KDV dahil)
          <input inputmode="decimal" autocomplete="off" data-fk-tutar placeholder="Örn. 2.520"></label>
        <div class="cozum-dugmeleri"><button class="kucuk" data-fk-onay>Onayla ✓</button>
          ${Number(x.onayli_fiyat) > 0
            ? `<button class="ikincil kucuk" data-fk-kayitli>Kayıtlı fiyat doğru (${tlYaz(x.onayli_fiyat)}/${birimFiyatAdi(x.birim)})</button>`
            : '<small class="bilgi">Onaylı fiyatı yok: TL toplamlarına girmiyor.</small>'}</div>
        <p class="mesaj"></p>
      </div>`).join('')}
  </section>`;
}

function fiyatKontrolKartiBagla(icerik, yenile) {
  icerik.querySelectorAll('#fiyat-kontrol details.fatura-gor').forEach((d) => d.addEventListener('toggle', () => {
    const kutu = d.querySelector('[data-dosyalar]');
    if (d.open && kutu) belgeleriGoster(kutu, JSON.parse(kutu.dataset.dosyalar));
  }));
  icerik.querySelectorAll('#fiyat-kontrol .gorev').forEach((g) => {
    const mesaj = g.querySelector('.mesaj');
    const kapat = async (tutar) => {
      g.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      try {
        await rpcVeri('fiyat_kontrol_coz', { p_kalem: Number(g.dataset.fk), p_tutar: tutar });
        yenile();
      } catch (err) {
        g.querySelectorAll('button').forEach((b) => { b.disabled = false; });
        mesaj.className = 'mesaj hata';
        mesaj.textContent = hataMetni(err);
      }
    };
    g.querySelector('[data-fk-onay]').addEventListener('click', () => {
      const n = sayiOku(g.querySelector('[data-fk-tutar]').value);
      if (!(n > 0)) { mesaj.className = 'mesaj hata'; mesaj.textContent = 'Faturadaki tutarı yaz.'; return; }
      kapat(n);
    });
    g.querySelector('[data-fk-kayitli]')?.addEventListener('click', () => kapat(null));
  });
}

// ---------- Bugünkü kontrol: patron yalnız dikkat etmesi gerekeni görür; sorun yoksa yeşil ----------
const gunFarki = (a, b) => Math.round((new Date(`${a}T12:00:00`) - new Date(`${b}T12:00:00`)) / 864e5);
const birimFiyatAdi = (birim) => ({ g: 'kg', ml: 'litre', adet: 'adet' }[birim] ?? birim);

function gunlukKontrolKarti({ kontrol, fiyatlar, eksik, son }) {
  if (!kontrol) return '';
  const maddeler = [];     // [renk, ikon, başlık, açıklama, git]
  if (Number(kontrol.acik_teslimat)) {
    maddeler.push(['kirmizi', '🚚', `${kontrol.acik_teslimat} teslimatta fark var`,
      `${Number(kontrol.acik_teslimat_tl) ? `≈ ${tlYaz(kontrol.acik_teslimat_tl)} eksik mal · ` : ''}aşağıda karar ver`, '#teslimat-gorevleri']);
  }
  if (son?.buyuk) {
    maddeler.push(['kirmizi', '📉', `Geçen haftanın açığı yüksek: ${tlYaz(son.acik_tl)}`, 'Hangi malzemede olduğunu raporda gör', 'rapor']);
  }
  for (const f of (fiyatlar ?? []).filter((x) => x.uyari)) {
    maddeler.push(['sari', '📈', `${f.ad} %${String(f.degisim_yuzde).replace('.', ',')} pahalandı`,
      `${tlYaz(f.onceki)} → ${tlYaz(f.son)} / ${birimFiyatAdi(f.birim)} · ayda ≈ ${tlYaz(f.aylik_etki)} ek maliyet`, '#fiyatlar']);
  }
  if (kontrol.fiyat_kontrol != null) {
    if (Number(kontrol.fiyat_kontrol)) {
      maddeler.push(['sari', '🏷️', `${kontrol.fiyat_kontrol} kalemin fiyatı doğrulanmadı`,
        'Mal stoğa girdi; TL hesapları tahmini. Aşağıda tutarı yazıp onayla', '#fiyat-kontrol']);
    }
  } else {
    // Sunucu henüz eski sürümse (sql/23 yok): elle girişin kontrolü eskisi gibi
    for (const e of kontrol.elle_fiyat_kontrol ?? []) {
      maddeler.push(['sari', '✍️', `Elle girilen fiyat kontrol bekliyor: ${e.malzeme}`,
        `${buyukMiktar(e.miktar, e.birim)} · ${tlYaz(e.tutar)} · ${e.giren_ad}. Fiyat güncellenmedi; doğruysa malzemeden düzelt.`, 'ayar']);
    }
  }
  const sayimGun = kontrol.son_sayim ? gunFarki(kontrol.bugun, kontrol.son_sayim) : null;
  if (sayimGun == null) maddeler.push(['sari', '📋', 'Henüz sayım yok', 'Takip ilk haftalık sayımla başlar', null]);
  else if (sayimGun > 8) maddeler.push(['sari', '📋', `Haftalık sayım gecikti`, `Son sayım ${sayimGun} gün önce`, null]);
  const satisBekliyor = Number(eksik?.bekleyen_satis_raporu) > 0;
  if (kontrol.son_sayim && !satisBekliyor && (!kontrol.son_satis || gunFarki(kontrol.son_sayim, kontrol.son_satis) > 3)) {
    maddeler.push(['sari', '💰', 'Son haftanın satış raporu girilmedi', 'Stok ve açık rakamları tahmini kalır', 'giris']);
  }
  if (Number(eksik?.bekleyen_fatura) || satisBekliyor) {
    maddeler.push(['bilgi', '⏳', `${[eksik.bekleyen_fatura ? `${eksik.bekleyen_fatura} fatura` : '', satisBekliyor
      ? `${eksik.bekleyen_satis_raporu} satış raporu` : ''].filter(Boolean).join(' ve ')} işleniyor`,
      'Fotoğraftan okunamadı, ekibimiz işliyor; rakamlar sonra değişebilir', null]);
  }
  if (!maddeler.length) {
    return `<section class="kart kontrol-kart yesil"><h2>Bugünkü kontrol</h2>
      <p class="hepsi-tamam">✓ Her şey yolunda</p>
      <p class="bilgi kucuk-yazi">Teslimatlar tam, faturalar işlendi, sayım güncel.</p></section>`;
  }
  const kirmizi = maddeler.some(([r]) => r === 'kirmizi');
  return `<section class="kart kontrol-kart ${kirmizi ? 'kirmizi' : 'sari'}">
    <h2>Bugünkü kontrol <span class="rozet">${maddeler.length}</span></h2>
    ${maddeler.map(([renk, ikon, baslik, alt, git]) => `<${git ? 'button' : 'div'} class="kontrol-madde ${renk}"
        ${git ? `data-kontrol-git="${esc(git)}"` : ''}>
      <span class="kontrol-ikon" aria-hidden="true">${ikon}</span>
      <span class="kontrol-metin"><b>${esc(baslik)}</b><small>${esc(alt)}</small></span>
      ${git ? '<span class="kontrol-ok" aria-hidden="true">›</span>' : ''}</${git ? 'button' : 'div'}>`).join('')}
  </section>`;
}

// Son fiyat değişimleri: önceki → son fatura fiyatı ve 90 günlük ağırlıklı ortalama. Kullanım verisi yoksa TL etkisi yazılmaz.
function fiyatKarti(fiyatlar) {
  const liste = (fiyatlar ?? []).filter((f) => Math.abs(Number(f.degisim_yuzde)) >= 1).slice(0, 6);
  if (!liste.length) return '';
  const enBuyuk = Math.max(...liste.map((f) => Math.abs(Number(f.degisim_yuzde))), 1);
  return `<section class="kart" id="fiyatlar"><h2>Fiyat değişimleri</h2>
    ${liste.map((f) => {
      const art = Number(f.degisim_yuzde) > 0;
      return `<div class="fiyat-satir ${f.uyari ? 'uyari-satir' : ''}">
        <div class="fiyat-ust"><b>${esc(f.ad)}</b>
          <span class="fiyat-oran ${art ? 'artti' : 'azaldi'}">${art ? '▲' : '▼'} %${String(Math.abs(f.degisim_yuzde)).replace('.', ',')}</span></div>
        <div class="fiyat-cubuk ${art ? 'artti' : 'azaldi'}"><span style="width:${(Math.abs(f.degisim_yuzde) / enBuyuk * 100).toFixed(0)}%"></span></div>
        <small>${tlYaz(f.onceki)} → ${tlYaz(f.son)} / ${birimFiyatAdi(f.birim)}${f.ortalama != null ? ` · 90 gün ortalaması ${tlYaz(f.ortalama)}` : ''}
          ${f.aylik_etki != null ? ` · ayda ${tlYaz(f.aylik_etki, { isaret: true })}` : ' · kullanım verisi yok, aylık etki hesaplanmadı'}</small>
      </div>`;
    }).join('')}
    <p class="bilgi kucuk-yazi">Fiyatlar KDV dahil. Uyarı: %5'ten fazla artış ve ayda 250 TL'den fazla ek maliyet.
      Ortalama, alınan miktara göre (yalnız doğrulanmış fiyatlar).</p>
  </section>`;
}

async function ozetSekmesi(icerik) {
  // Yeni işlevler (sql/21, 22) sunucuda yoksa ilgili kart görünmez; Özet yine açılır.
  const yoksa = (deger) => (e) => { console.warn('Özet verisi alınamadı:', e); return deger; };
  const [trend, eksikler, stok, gorevler, kontrol, fiyatlar, fiyatKontrol] = await Promise.all([
    rpcVeri('acik_trendi', { p_adet: 8 }), rpcVeri('eksik_belge_ozeti'), rpcVeri('stok_durumu'),
    rpcVeri('teslimat_gorevleri').catch(yoksa([])), rpcVeri('gunluk_kontrol').catch(yoksa(null)),
    rpcVeri('fiyat_degisimleri').catch(yoksa([])), rpcVeri('fiyat_kontrolleri').catch(yoksa([]))]);
  trend.forEach((d) => { d.buyuk = donemBuyukMu(d); });
  const [son, onceki] = trend;
  const azalan = stok.malzemeler.filter((m) => ['az', 'dikkat'].includes(yeterDurumu(m.yeter_gun)));
  const sayilmis = stok.malzemeler.some((m) => m.sayim_tarih);
  const sonSayimGun = son ? Math.round((new Date(`${stok.tarih}T12:00:00`) - new Date(`${son.bitis}T12:00:00`)) / 864e5) : 0;

  let kahraman;
  if (son) {
    const fark = onceki ? Number(son.acik_tl) - Number(onceki.acik_tl) : 0;   // açık eksi sayı: artı fark = azaldı
    kahraman = `
      <section class="kart kahraman ${son.buyuk ? 'kirmizi' : 'yesil'}">
        <div class="etiket">Son haftanın açığı · ${esc(donemYaz(son.baslangic, son.bitis))}</div>
        <div class="dev-rakam">${tlYaz(son.acik_tl)}</div>
        <div class="durum-yazi">${son.buyuk ? 'Normalden yüksek açık var' : 'Açık normal sınırda'}</div>
        ${onceki ? `<div class="alt-yazi">Önceki hafta ${tlYaz(onceki.acik_tl)}${Math.abs(fark) >= 1
          ? ` · ${fark > 0 ? `${tlYaz(fark)} daha az` : `${tlYaz(-fark)} daha fazla`}` : ''}</div>` : ''}
        ${sonSayimGun > 8 ? `<div class="alt-yazi">Son sayım ${sonSayimGun} gün önce. Bu haftanın sayımı bekleniyor.</div>` : ''}
      </section>`;
  } else {
    // Yeni mekan: açık ikinci sayımdan sonra çıkar; o zamana kadar kurulum adımları gösterilir.
    const [mr, ur, uyr] = await Promise.all([
      sb.from('malzemeler').select('id', { count: 'exact', head: true }).eq('aktif', true),
      sb.from('tarif_kalemleri').select('urun_id', { count: 'exact', head: true }),
      sb.from('uyeler').select('user_id', { count: 'exact', head: true }).eq('rol', 'barista')]);
    const adimlar = [
      [mr.count > 0, 'Malzemeleri gir', 'Kahve, süt, bardak… ve kg / litre / adet fiyatı', 'malzeme'],
      [ur.count > 0, 'Ürün tariflerini gir', 'Latte = 18 g kahve + 220 ml süt + 1 bardak', 'urun'],
      [uyr.count > 0, 'Baristayı davet et', 'Mekan ayarlarındaki davet kodunu ver', 'mekan'],
      [sayilmis, 'İlk haftalık sayım', 'Barista "Haftalık sayım" ile yapar; ikinci sayımda ilk açık raporu çıkar', null],
    ];
    kahraman = `<section class="kart kahraman">
      <div class="etiket">Haftalık açık</div>
      <p class="buyuk-yazi">${sayilmis ? 'İlk sayım yapıldı. Açık, bir sonraki haftalık sayımdan sonra burada görünür.'
        : 'Henüz sayım yok. Aşağıdaki adımlar bitince takip başlar.'}</p></section>
      ${adimlar.every(([tamam]) => tamam) ? '' : `<section class="kart"><h2>İlk adımlar</h2>
        ${adimlar.map(([tamam, ad, alt, git]) => `<div class="adim ${tamam ? 'bitti' : ''}">
          <span class="adim-isaret" aria-hidden="true">${tamam ? '✓' : ''}</span>
          <span class="adim-metin"><b>${ad}</b><small>${alt}</small></span>
          ${!tamam && git ? `<button class="ikincil kucuk" data-ayar-git="${git}">Aç</button>` : ''}
          <span class="gizli">${tamam ? 'tamamlandı' : 'bekliyor'}</span></div>`).join('')}
      </section>`}`;
  }

  icerik.innerHTML = `
    ${gunlukKontrolKarti({ kontrol, fiyatlar, eksik: eksikler?.[0], son })}
    ${kahraman}
    ${teslimatKarti(gorevler ?? [])}
    ${fiyatKontrolKarti(fiyatKontrol)}
    ${kontrol ? '' : bekleyenUyarisi(eksikler?.[0])}
    ${son ? `<section class="kart">
      <h2>En çok açık veren malzemeler</h2>
      ${son.en_cok_acik.length ? `<ol class="sirali">${son.en_cok_acik.map((x) => `
        <li class="${acikDurumu(x) === 'buyuk' ? 'kirmizi' : ''}"><span class="ad">${esc(x.ad)}</span>
          <span class="miktar">${okunurMiktar(x.fark, x.birim)}</span><b class="tutar">${tlYaz(x.fark_tl)}</b></li>`).join('')}</ol>`
        : '<p class="bilgi">Bu hafta açık veren malzeme yok.</p>'}
      <button class="ikincil tam" data-git="rapor" data-sayim="${esc(son.sayim_id)}">Haftanın raporunu aç</button>
    </section>` : ''}
    ${trend.length > 1 ? `<section class="kart">
      <h2>Haftalara göre açık (TL)</h2>
      ${trendSvg(trend)}
      <p class="bilgi kucuk-yazi">Kırmızı çubuk: o hafta normalden yüksek açık var.</p>
    </section>` : ''}
    ${azalan.length ? `<section class="kart">
      <h2>Azalan malzemeler</h2>
      ${azalan.slice(0, 5).map((m) => `<div class="cizgili-satir"><span>${esc(m.ad)}</span>
        <span class="etiket-kutu ${yeterDurumu(m.yeter_gun)}">${m.yeter_gun < 1 ? 'Bugün bitebilir' : `≈ ${m.yeter_gun} gün yeter`}</span></div>`).join('')}
      <button class="ikincil tam" data-git="stok">Tüm stok</button>
    </section>` : ''}
    ${fiyatKarti(fiyatlar)}`;
  teslimatKartiBagla(icerik, () => ozetSekmesi(icerik));
  fiyatKontrolKartiBagla(icerik, () => ozetSekmesi(icerik));
  icerik.querySelectorAll('[data-kontrol-git]').forEach((b) => b.addEventListener('click', () => {
    const git = b.dataset.kontrolGit;
    if (git.startsWith('#')) { icerik.querySelector(git)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    aktifSekme = git;
    if (git === 'ayar') ayarSekme = 'malzeme';
    window.scrollTo(0, 0);
    goster();
  }));
  icerik.querySelectorAll('[data-ayar-git]').forEach((b) => b.addEventListener('click', () => {
    aktifSekme = 'ayar';
    ayarSekme = b.dataset.ayarGit;
    window.scrollTo(0, 0);
    goster();
  }));
  icerik.querySelectorAll('[data-git]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.sayim) secilenSayim = b.dataset.sayim;
    aktifSekme = b.dataset.git;
    window.scrollTo(0, 0);
    goster();
  }));
}

// ---------- Stok: şu an elde ne var (son sayım + sonraki hareketler) ----------

// Rakamın güvenilirliği: bugün sayıldıysa doğrulanmış; sayımdan sonra satış girilmediyse tahmini (satış raporu haftalık);
// eksi çıktıysa ya da okunmayı bekleyen fatura varsa kontrol gerekli.
function stokGuveni(m, bugun, faturaBekliyor) {
  if (Number(m.simdi) < 0) return ['kontrol', 'Kontrol gerekli', 'Hesap eksiye düştü: bir giriş eksik olabilir'];
  if (faturaBekliyor && Number(m.gelen) === 0 && m.sayim_tarih !== bugun) return ['kontrol', 'Kontrol gerekli', 'Okunmayı bekleyen fatura var'];
  if (m.sayim_tarih === bugun) return ['dogru', 'Bugün sayıldı', ''];
  if (Number(m.satis) === 0) return ['tahmin', 'Tahmini', 'Sayımdan sonraki satışlar henüz girilmedi'];
  return ['dogru', 'Güncel', ''];
}

async function stokSekmesi(icerik) {
  const [r, eksikler, fk] = await Promise.all([rpcVeri('stok_durumu'), rpcVeri('eksik_belge_ozeti'),
    rpcVeri('fiyat_kontrolleri').catch(() => [])]);
  const faturaBekliyor = Number(eksikler?.[0]?.bekleyen_fatura) > 0;
  const sayilan = r.malzemeler.filter((m) => m.simdi != null);
  const sayilmayan = r.malzemeler.filter((m) => m.simdi == null);
  const deger = sayilan.reduce((t, m) => t + Number(m.deger_tl || 0), 0);
  // Fiyatı doğrulanmayan malzemenin değeri son onaylı fiyatla (tahmini); onaylı fiyatı hiç olmayan değere girmez.
  const kontrolde = new Set((fk ?? []).map((x) => x.malzeme_id));
  const tahminiDeger = sayilan.filter((m) => kontrolde.has(m.malzeme_id) && Number(m.fiyat) > 0).length;
  const fiyatsiz = sayilan.filter((m) => !(Number(m.fiyat) > 0) && Number(m.simdi) > 0);
  const azSayi = sayilan.filter((m) => yeterDurumu(m.yeter_gun) === 'az').length;
  const tahminSayi = sayilan.filter((m) => stokGuveni(m, r.tarih, faturaBekliyor)[0] !== 'dogru').length;
  const satir = (m) => {
    const durum = yeterDurumu(m.yeter_gun);
    const [guven, guvenAd, guvenNeden] = stokGuveni(m, r.tarih, faturaBekliyor);
    const doluluk = m.yeter_gun == null ? null : Math.max(4, Math.min(100, (Number(m.yeter_gun) / 14) * 100));
    const kullanilan = Number(m.satis) + Number(m.fire);
    const hareket = [Number(m.gelen) ? `${okunurMiktar(m.gelen, m.birim)} geldi` : '',
      kullanilan ? `${okunurMiktar(kullanilan, m.birim)} kullanıldı` : ''].filter(Boolean).join(', ');
    return `<div class="stok-satir ${durum || ''}">
      <div class="sol"><b>${esc(m.ad)}</b>${guven !== 'dogru' ? ` <span class="guven ${guven}">${guvenAd}</span>` : ''}
        <small>${hareket ? `${esc(kisaTarih(m.sayim_tarih))} sayımı ${okunurMiktar(m.sayilan, m.birim)}; sonra ${hareket}`
          : `${m.sayim_tarih === r.tarih ? 'Bugün' : esc(kisaTarih(m.sayim_tarih))} sayıldı`}</small></div>
      <div class="sag"><span class="orta-rakam">${okunurMiktar(Math.max(0, m.simdi), m.birim)}</span>
        ${m.yeter_gun != null ? `<span class="etiket-kutu ${durum}">${m.yeter_gun < 1 ? 'Bugün bitebilir' : `≈ ${m.yeter_gun} gün`}</span>` : ''}
        ${guvenNeden ? `<small class="guven-neden">${esc(guvenNeden)}</small>` : ''}</div>
      ${doluluk != null ? `<div class="yeter-cubuk ${durum || ''}" aria-hidden="true"><span style="width:${doluluk.toFixed(0)}%"></span></div>` : ''}
    </div>`;
  };
  icerik.innerHTML = `
    <section class="kart">
      <div class="etiket">Elde olan malın değeri ${KDV_DAHIL}</div>
      <div class="buyuk-rakam">${sayilan.length ? `${tahminiDeger ? '≈ ' : ''}${tlYaz(deger)}` : '—'}</div>
      ${tahminiDeger ? `<p class="bilgi kucuk-yazi">${tahminiDeger} malzemenin fiyatı doğrulanmadı; değer son onaylı fiyatla tahmini.</p>` : ''}
      ${fiyatsiz.length ? `<p class="bilgi kucuk-yazi">Fiyatı olmadığı için değere girmeyenler: ${fiyatsiz.map((m) => esc(m.ad)).join(', ')}.</p>` : ''}
      <p class="bilgi kucuk-yazi">${sayilan.length ? `${sayilan.length} malzeme${azSayi
        ? ` · <span class="uyari">${azSayi} tanesi 2 günden az yeter</span>` : ''}. ` : ''}Son sayımdan sonra gelen eklendi,
        satılan ve fire düşüldü.${tahminSayi ? ` <b>${tahminSayi} malzemenin rakamı tahmini</b>, bir sonraki sayımda kesinleşir.` : ''}
        "Gün": son ${(r.kullanim_gun || 28) >= 14 ? `${Math.round((r.kullanim_gun || 28) / 7)} haftanın` : `${r.kullanim_gun} günün`} ortalama kullanımına göre.</p>
    </section>
    ${sayilan.length ? `<section class="kart liste-kart">${sayilan.map(satir).join('')}</section>` : ''}
    ${sayilmayan.length ? `<section class="kart"><h2>Henüz sayılmayanlar (${sayilmayan.length})</h2>
      <p class="bilgi">Elde ne kadar olduğu ilk sayımdan sonra görünür: ${sayilmayan.map((m) => esc(m.ad)).join(', ')}.</p></section>` : ''}`;
}

// ---------- Stok farkı: iki sayım arasında beklenen ve sayılan stok (yalnız patron) ----------
let secilenSayim = null;   // Raporda seçili sayım (yoksa en son)

async function stokFarkiSekmesi(icerik) {
  const [r, trend, fk] = await Promise.all([rpcVeri('stok_farki', { p_sayim: secilenSayim }), rpcVeri('acik_trendi', { p_adet: 8 }),
    rpcVeri('fiyat_kontrolleri').catch(() => [])]);
  // Fiyatı doğrulanmayan malzeme: miktar farkı normal, TL son onaylı fiyatla "tahmini".
  const kontrolde = new Set((fk ?? []).map((x) => x.malzeme_id));
  if (r.durum === 'sayim_yok') {
    icerik.innerHTML = `<div class="kart"><h2>Haftalık rapor</h2>
      <p class="bilgi">Henüz sayım yok. Rapor iki haftalık sayım arasında hesaplanır: ilk sayım başlangıç olur,
        ikinci sayımda her malzemenin açığı görünür.</p></div>`;
    return;
  }
  trend.forEach((d) => { d.buyuk = donemBuyukMu(d); });
  const tamam = r.satirlar.filter((x) => x.durum === 'tamam');
  const ilk = r.satirlar.filter((x) => x.durum === 'ilk_sayim');
  const sayilmadi = r.satirlar.filter((x) => x.durum === 'sayilmadi');
  tamam.forEach((x) => { x.renk = acikDurumu(x); x.tahmini = x.fark_tl != null && kontrolde.has(x.malzeme_id); });
  // Onaylı fiyatı hiç olmayan: TL toplamına girmez, ayrı listelenir (miktar farkı yine hesaplanır).
  const fiyatsiz = tamam.filter((x) => x.fark_tl == null && Number(x.fark) !== 0);
  const tahminiSayi = tamam.filter((x) => x.tahmini).length;
  const buyukSayi = tamam.filter((x) => x.renk === 'buyuk').length;
  const tlHucre = (miktar, x) => {
    const t = miktarTl(miktar, x.birim, x.fiyat);
    return t == null ? '—' : tlYaz(t);
  };
  const DURUM_YAZI = { buyuk: 'Yüksek açık', normal: 'Normal', fazla: 'Fazla çıktı' };
  const satir = (x) => {
    const kullanilan = Number(x.satis) + Number(x.fire);
    return `
    <details class="rapor-satir ${x.renk}" ${x.renk === 'buyuk' ? 'open' : ''}>
      <summary>
        <span class="ad"><b>${esc(x.ad)}</b><small><span class="nokta"></span>${DURUM_YAZI[x.renk]}${x.renk !== 'normal' && acikOrani(x)
          ? ` · kullanılanın ${acikOrani(x)} kadarı` : ''}</small></span>
        <span class="deger"><b>${x.fark_tl != null ? `${x.tahmini ? '≈ ' : ''}${tlYaz(x.fark_tl, { isaret: true })}` : 'fiyat yok'}</b>
          ${x.tahmini ? '<small class="guven tahmin">Tahmini</small>' : ''}
          <small>${okunurMiktar(x.fark, x.birim, { isaret: true })}</small></span>
      </summary>
      <table class="tablo rapor-tablo">
        <thead><tr><th></th><th>Miktar</th><th>TL</th></tr></thead>
        <tbody>
        <tr><td>Önceki sayım <small>${esc(kisaTarih(x.baslangic_tarih))}</small></td><td>${okunurMiktar(x.baslangic, x.birim)}</td><td>${tlHucre(x.baslangic, x)}</td></tr>
        <tr><td>+ Gelen <small>faturalar</small></td><td>${okunurMiktar(x.gelen, x.birim)}</td><td>${tlHucre(x.gelen, x)}</td></tr>
        <tr><td>− Kullanılan <small>satışlar, tarifle</small></td><td>${okunurMiktar(x.satis, x.birim)}</td><td>${tlHucre(x.satis, x)}</td></tr>
        <tr><td>− Fire</td><td>${okunurMiktar(x.fire, x.birim)}</td><td>${tlHucre(x.fire, x)}</td></tr>
        <tr class="ara"><td>= Olması gereken</td><td>${okunurMiktar(x.beklenen, x.birim)}</td><td>${tlHucre(x.beklenen, x)}</td></tr>
        <tr><td>Sayılan</td><td>${okunurMiktar(x.sayilan, x.birim)}</td><td>${tlHucre(x.sayilan, x)}</td></tr>
        <tr class="sonuc"><td>${Number(x.fark) < 0 ? 'Açık' : 'Fark'}</td><td>${okunurMiktar(x.fark, x.birim, { isaret: true })}</td>
          <td>${x.fark_tl != null ? tlYaz(x.fark_tl, { isaret: true }) : '—'}</td></tr>
        </tbody>
      </table>
      ${!kullanilan && Number(x.fark) < 0 ? '<p class="bilgi kucuk-yazi">Bu dönemde satış ya da fire girilmemiş; açığın tamamı kayıp görünüyor.</p>' : ''}
    </details>`;
  };
  icerik.innerHTML = `
    <section class="kart">
      <div class="donem-sec">
        <label for="sayim-sec">Hafta</label>
        <select id="sayim-sec">${r.sayimlar.map((s, i) => {
          // Dönem adı trendden (son 8 hafta); daha eskisi ya da aynı güne ikinci sayım tarihiyle yazılır.
          const d = trend.find((t) => t.sayim_id === s.id);
          const ilkSayim = i === r.sayimlar.length - 1 && r.sayimlar.length < 26;
          return `<option value="${esc(s.id)}" ${s.id === r.sayim_id ? 'selected' : ''}>${d ? esc(donemYaz(d.baslangic, d.bitis))
            : `${esc(kisaTarih(s.tarih))} sayımı${ilkSayim ? ' (ilk sayım)' : ''}`}</option>`;
        }).join('')}</select>
      </div>
      ${tamam.length ? `
      <div class="iki-rakam">
        <div><div class="etiket">Açık</div><div class="buyuk-rakam ${buyukSayi ? 'uyari' : 'iyi'}">${tlYaz(r.toplam_acik_tl)}</div></div>
        <div><div class="etiket">Fazla</div><div class="buyuk-rakam soluk">${tlYaz(r.toplam_fazla_tl, { isaret: true })}</div></div>
      </div>
      <p class="durum-yazi ${buyukSayi ? 'uyari' : 'iyi'}">${buyukSayi ? `${buyukSayi} malzemede normalden yüksek açık var.` : 'Tüm malzemeler normal sınırda.'}</p>`
      : '<p class="bilgi">Bu, ilk sayım. Açık bir sonraki haftalık sayımda görünür.</p>'}
      ${r.uyarilar.length ? `<div class="durum-kart sari">${r.uyarilar.map((u) => `<span>${esc(u)}</span>`).join('')}</div>` : ''}
      ${tahminiSayi ? `<p class="bilgi kucuk-yazi">${tahminiSayi} malzemenin fiyatı doğrulanmadı: TL'si son onaylı fiyatla tahmini (≈).</p>` : ''}
    </section>
    ${fiyatsiz.length ? `<section class="kart"><h2>TL toplamına girmeyenler (${fiyatsiz.length})</h2>
      <p class="bilgi">Onaylı fiyatı olmadığı için açık/fazla TL'ye çevrilmedi. Miktar farkı:</p>
      ${fiyatsiz.map((x) => `<div class="cizgili-satir"><span>${esc(x.ad)}</span>
        <span>${okunurMiktar(x.fark, x.birim, { isaret: true })}</span></div>`).join('')}</section>` : ''}
    ${trend.length > 1 ? `<section class="kart"><h2>Haftalara göre açık (TL)</h2>${trendSvg(trend)}</section>` : ''}
    ${tamam.length ? `<section class="kart liste-kart">
      <h2>Malzemeler</h2>
      <p class="bilgi kucuk-yazi"><span class="nokta buyuk"></span>Kırmızı: normalden fazla kayıp.
        <span class="nokta fazla"></span>Sarı: sayılan, olması gerekenden fazla (satış ya da fire eksik girilmiş olabilir).
        Ayrıntı için malzemeye dokun.</p>
      ${tamam.filter((x) => Number(x.fark) !== 0).map(satir).join('')}
      ${tamam.some((x) => Number(x.fark) === 0) ? `<p class="bilgi kucuk-yazi">Farkı olmayanlar: ${tamam.filter((x) => Number(x.fark) === 0)
        .map((x) => esc(x.ad)).join(', ')}.</p>` : ''}
      <button class="ikincil tam" id="indir">Raporu indir (Excel)</button></section>` : ''}
    ${ilk.length ? `<section class="kart"><h2>İlk kez sayılanlar (${ilk.length})</h2>
      <p class="bilgi">Daha önce sayılmadıkları için açık bir sonraki sayımda çıkar.</p>
      <p>${ilk.map((x) => `${esc(x.ad)}: ${okunurMiktar(x.sayilan, x.birim)}`).join(' · ')}</p></section>` : ''}
    ${sayilmadi.length ? `<section class="kart"><h2>Bu sayımda sayılmayanlar (${sayilmadi.length})</h2>
      <p class="bilgi">${sayilmadi.map((x) => esc(x.ad)).join(', ')}</p></section>` : ''}
    <p class="bilgi kucuk-yazi">${r.baslangic ? `${esc(kisaTarih(r.baslangic))} sayımından ${esc(kisaTarih(r.bitis))} sayımına. ` : ''}Sayım
      günündeki satış, fire ve mal girişleri o haftaya dahil. TL, bugünkü fiyatla (KDV dahil).</p>`;
  // Muhasebeci / ortak için: haftanın tablosu Excel'de açılan dosya olarak (cihazda üretilir, hiçbir yere gönderilmez).
  icerik.querySelector('#indir')?.addEventListener('click', () => {
    const blob = new Blob([raporCsv(r, mekanAdi)], { type: 'text/csv;charset=utf-8' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `stok-raporu-${r.bitis}.csv` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  });
  icerik.querySelector('#sayim-sec').addEventListener('change', (e) => {
    secilenSayim = e.target.value;
    stokFarkiSekmesi(icerik).catch(hataGoster);
  });
}

async function mekanSekmesi(icerik, user, uye, patron) {
  const { data: uyeler, error } = await sb.from('uyeler').select('user_id, ad, rol, eposta').order('olusturma');
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
    uyeOnbellek = null;
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
    sb.from('malzemeler').select('id, ad, birim, aktif, olusturma'),
    fiyatli ? sb.rpc('malzeme_fiyatlari') : Promise.resolve({ data: [] }),
  ]);
  if (mr.error) throw mr.error;
  if (fr.error) throw fr.error;
  const fiyat = new Map(fr.data.map((f) => [f.id, f]));
  return mr.data.map((m) => ({ fiyat: 0, fiyat_haric: null, kdv_orani: null, ...m, ...fiyat.get(m.id) })).sort(adaGore);
}

// ---------- KDV ----------
// Kimse KDV oranı / matrah görmez ya da girmez. Veritabanında fiyat KDV dahildir; faturadan okunan oran arka planda
// saklanır (toplam kontrolü için). Ekranlarda her fiyat KDV dahildir ve yanında küçük "KDV dahil" yazar
// (toptancılar çoğunlukla "+KDV" fiyat söyler; yanlış karşılaştırma olmasın).
const KDV_DAHIL = '<small class="kdv-dahil">KDV dahil</small>';

// "45,00 ₺ · KDV dahil" gibi tek satırlık fiyat yazısı.
function fiyatYazisi(dahil) {
  return `${tl.format(Number(dahil))} · KDV dahil`;
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
          ? `1 ${BIRIMLER[m.birim].fiyatBirimi}: ${tl.format(Number(m.fiyat))} · KDV dahil`
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
    ${d || !aktifler.length ? '' : '<button class="tam" type="button" id="yeni-malzeme">+ Yeni malzeme ekle</button><p></p>'}
    <form class="kart" id="malzeme-form" ${d || !aktifler.length ? '' : 'hidden'}>
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
        value="${d ? esc(String(d.fiyat).replace('.', ',')) : ''}"
        placeholder="Örn. 42,50">
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
    form.querySelector('#m-fiyat-etiket').textContent = `1 ${BIRIMLER[birimSec.value].fiyatBirimi} fiyatı (TL, KDV dahil)`;
  };
  birimSec.addEventListener('change', etiketYaz);
  etiketYaz();
  form.querySelector('#vazgec')?.addEventListener('click', () => malzemeSekmesi(icerik, patron).catch(hataGoster));
  icerik.querySelector('#yeni-malzeme')?.addEventListener('click', (e) => {
    e.currentTarget.remove();
    form.hidden = false;
    form.querySelector('#m-ad').focus();
  });
  formBagla(form, async ({ ad, birim, fiyat }) => {
    const f = sayiOku(fiyat);
    if (!Number.isFinite(f) || f >= 10000000) throw new Error('Fiyatı sayı olarak yaz. Örn. 42,50');
    // Fiyat KDV dahil girilir; KDV oranı sorulmaz. Oran biliniyorsa (faturadan gelmiş) veritabanı hariç fiyatı
    // bu dahil fiyattan yeniden hesaplar; bilinmiyorsa yalnız KDV dahil fiyat saklanır.
    const kayit = { ad: ad.trim(), fiyat: f };
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
  return `Maliyet: ${tl.format(toplam)} (KDV dahil)`
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
      return `<div class="gecmis-satir${iptal ? ' iptal' : ''}">${tarihYaz(f.tarih)} ·
        <b>${fiyatYazisi(f.fiyat)}</b> · ${KAYNAKLAR[f.kaynak]}${f.degistiren_ad ? ` (${esc(f.degistiren_ad)})` : ''}${iptal ? ' · fatura iptal edildi' : ''}</div>`;
    }).join('') : '<p class="bilgi">Henüz kayıt yok.</p>';
  } catch (err) {
    delete det.dataset.yuklendi;
    kutu.innerHTML = `<p class="hata">${esc(hataMetni(err))}</p>`;
  }
}

// ---------- Girişler: fatura, satış, fire, sayım ----------

// Geçmiş listesinde giriş türlerinin adı; satış formunun başlığı ve notu.
const TURLER = {
  fatura: { ad: 'Fatura' },
  satis: { ad: 'Satış', dugme: 'Satış gir', not: 'Gün sonu kasa raporundaki adetleri yaz. Satılmayanı boş bırak.' },
  fire: { ad: 'Fire' },
  sayim: { ad: 'Sayım' },
};

// Gösterim: g/ml veritabanında, ekranda kg/litre.
const buyukMiktar = (miktar, birim) =>
  `${sayiYaz(Number(miktar) / BIRIMLER[birim].bolen)} ${BIRIMLER[birim].fiyatBirimi}`;

// Sayılan / elle girilen birim: adında paket boyu yazan g/ml malzeme ("Vanilya şurubu 700 ml") şişe/paket olarak
// sayılır (3 şişe = 2,1 litre). Diğerleri kg / litre / adet; yarım şişe 0,5 yazılır. kat: 1 birim = kaç g/ml/adet.
function sayimBirimiBul(m) {
  const paket = m.birim !== 'adet' ? carpanBul('adet', m.birim, m.ad) : null;
  if (paket > 1) return { ad: 'şişe / paket', ipucu: `1 şişe/paket = ${sayiYaz(paket)} ${m.birim}. Açık olanı yarım (0,5) say.`, kat: paket };
  const b = BIRIMLER[m.birim];
  return { ad: b.fiyatBirimi, kat: b.bolen,
    ipucu: { g: 'Kilogram yaz: 500 g = 0,5 · 250 g = 0,25', ml: 'Litre yaz: 750 ml = 0,75 · 200 ml = 0,2', adet: 'Tane say.' }[m.birim] };
}

// + / − düğmeli büyük sayı kutusu (sayım, elle giriş). Bağlamak için sayacBagla(kutu).
const sayacKutusu = (birim, deger = '') => `<div class="sayac">
    <button type="button" class="sayac-dugme" data-adim="-1" aria-label="Bir azalt">−</button>
    <input id="rakam" inputmode="decimal" autocomplete="off" value="${esc(deger)}" aria-label="Miktar">
    <button type="button" class="sayac-dugme" data-adim="1" aria-label="Bir artır">+</button>
  </div><p class="sayim-birim">${esc(birim)}</p>`;
function sayacBagla(kutu, degisti = () => {}) {
  const inp = kutu.querySelector('#rakam');
  kutu.querySelectorAll('.sayac-dugme').forEach((d) => d.addEventListener('click', () => {
    const n = sayiOku(inp.value);
    inp.value = String(Math.max(0, (Number.isFinite(n) ? n : 0) + Number(d.dataset.adim))).replace('.', ',');
    degisti();
  }));
  inp.addEventListener('input', degisti);
  return inp;
}

let secilenAy = null;   // Geçmişte gösterilen ay (YYYY-AA)
let girisTuru = 'hepsi';   // Geçmiş girişlerde gösterilen tür

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
        .select('giris_id, malzeme_id, urun_id, miktar, tutar, stok_disi, satir_metni, uyarilar')
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

  // Fatura satırında tutar (KDV dahil). Fiyatı doğrulanmadıysa küçük not.
  const tutarYaz = (k) => (k.uyarilar?.includes('fiyat_kontrol') ? ' · <i>fiyat kontrol bekliyor</i>'
    : k.tutar == null ? '' : ` · ${tl.format(Number(k.tutar))}`);
  const kalemYaz = (k) => {
    if (k.stok_disi) return `${esc(k.satir_metni)} <i>(stoğa eklenmedi)</i>${tutarYaz(k)}`;
    if (k.urun_id) return `${esc(urunBul.get(k.urun_id)?.ad ?? '?')} × ${sayiYaz(Number(k.miktar))}`;
    const m = malzemeBul.get(k.malzeme_id);
    if (!m) return '?';
    return `${esc(m.ad)}: ${buyukMiktar(k.miktar, m.birim)}${tutarYaz(k)}`;
  };
  const bugun = bugunStr();
  // Listede sağdaki tutar: fatura KDV dahil toplam; fire güncel fiyatla TL; satış ürün adedi; sayım malzeme sayısı.
  const girisTutari = (g, satirlar) => {
    if (g.tur === 'fatura') return tlYaz(g.belge_genel_toplam ?? satirlar.reduce((t, k) => t + Number(k.tutar ?? 0), 0));
    if (g.tur === 'satis') return `${sayiYaz(satirlar.reduce((t, k) => t + Number(k.miktar), 0))} ürün`;
    if (g.tur === 'fire') {
      let toplam = 0;
      for (const k of satirlar) {
        const m = malzemeBul.get(k.malzeme_id);
        if (!m) return `${satirlar.length} kalem`;   // ürün firesi: TL karşılığı burada hesaplanmaz
        toplam += miktarTl(k.miktar, m.birim, m.fiyat) ?? 0;
      }
      return tlYaz(toplam);
    }
    return `${satirlar.length} malzeme`;
  };
  const girisYaz = (g) => {
    const satirlar = kalemler.filter((k) => k.giris_id === g.id);
    const gBelgeler = belgeler.filter((b) => b.giris_id === g.id);
    const fatura = g.tur === 'fatura';
    const iptalEdebilir = !g.iptal_zamani
      && (patron || (g.giren === user.id && gunu(g.olusturma) === bugun));
    const t = new Date(`${g.tarih}T12:00:00`);
    return `
      <details class="giris giris-satiri${g.iptal_zamani ? ' iptal' : ''}" data-tur="${g.tur}" ${gBelgeler.length ? `data-belgeli="${esc(g.id)}"` : ''}>
        <summary>
          <span class="giris-tarih"><b>${t.getDate()}</b><small>${t.toLocaleDateString('tr-TR', { month: 'short' })}</small></span>
          <span class="giris-orta"><b>${TURLER[g.tur].ad}</b>${g.iptal_zamani ? ' <span class="etiket-kutu az">İptal</span>' : ''}
            <small>${esc(g.aciklama || g.giren_ad)}${fatura && gBelgeler.length ? ' · 📄' : ''}</small></span>
          <span class="giris-tutar">${girisTutari(g, satirlar)}</span>
        </summary>
        <ul>${satirlar.map((k) => `<li>${kalemYaz(k)}</li>`).join('')}</ul>
        ${gBelgeler.length ? '<div class="belgeler"><p class="bilgi">Belgeler yükleniyor…</p></div>' : ''}
        <small>Giren: ${esc(g.giren_ad)}, ${zamanYaz(g.olusturma)}</small>
        ${g.iptal_zamani ? `<small class="uyari">İptal eden: ${esc(g.iptal_eden_ad)}, ${zamanYaz(g.iptal_zamani)}</small>` : ''}
        ${iptalEdebilir ? `<button class="ikincil kucuk" data-iptal="${esc(g.id)}">Bu girişi iptal et</button>` : ''}
      </details>`;
  };

  const eksikMetni = [
    eksik?.bekleyen_fatura ? `${eksik.bekleyen_fatura} fatura` : '',
    eksik?.bekleyen_satis_raporu ? `${eksik.bekleyen_satis_raporu} satış raporu` : '',
  ].filter(Boolean).join(', ');
  icerik.innerHTML = `
    ${eksikMetni ? `<div class="sade-uyari">⏳ ${eksikMetni} henüz işlenmedi. İşlenince rakamlar biraz değişebilir.</div>` : ''}
    <div class="buyuk-dugmeler yatay">
      <button data-is="mal"><span class="simge">📦</span>Mal geldi</button>
      <button data-is="fire"><span class="simge">🗑️</span>Fire var</button>
      <button data-is="sayim"><span class="simge">📋</span>Haftalık sayım</button>
    </div>
    <div class="izgara">
      <button class="ikincil" data-is="elle">✍️ Elle mal girişi</button>
      <button class="ikincil" data-yeni="satis">💰 Satış gir</button>
    </div>
    <div class="kart liste-kart">
      <div class="baslik-satir"><h2>Geçmiş girişler</h2>
        <input id="ay" type="month" value="${secilenAy}" max="${bugun.slice(0, 7)}" aria-label="Ay"></div>
      <div class="suzgec" role="group" aria-label="Tür">
        ${[['hepsi', 'Hepsi'], ['fatura', 'Fatura'], ['satis', 'Satış'], ['fire', 'Fire'], ['sayim', 'Sayım']].map(([k, ad]) =>
          `<button class="${girisTuru === k ? 'secili' : ''}" data-suz="${k}">${ad}</button>`).join('')}
      </div>
      ${girisler.length ? girisler.map(girisYaz).join('')
        : '<p class="bilgi">Bu ayda giriş yok.</p>'}
      <p class="bilgi bos-suzgec" hidden>Bu ayda bu türde giriş yok.</p>
      ${girisler.length === 1000 ? '<p class="uyari">Bu ayda çok fazla giriş var; yalnızca son 1000 tanesi gösteriliyor.</p>' : ''}
    </div>
    ${patron ? `<details class="kart" id="islem-gecmisi"><summary><b>İşlem geçmişi</b>
      <small class="bilgi"> · kim, ne zaman, ne yaptı (silinemez)</small></summary><div class="gecmis-liste"><p class="bilgi">Yükleniyor…</p></div></details>` : ''}`;

  const yenile = () => girisSekmesi(icerik, user, patron).catch(hataGoster);
  icerik.querySelector('#islem-gecmisi')?.addEventListener('toggle', (e) => {
    if (e.target.open) islemGecmisiGoster(e.target.querySelector('.gecmis-liste'));
  });
  const suz = () => {
    let gorunen = 0;
    icerik.querySelectorAll('.giris-satiri').forEach((d) => {
      d.hidden = girisTuru !== 'hepsi' && d.dataset.tur !== girisTuru;
      if (!d.hidden) gorunen++;
    });
    icerik.querySelector('.bos-suzgec').hidden = !girisler.length || gorunen > 0;
    icerik.querySelectorAll('[data-suz]').forEach((b) => b.classList.toggle('secili', b.dataset.suz === girisTuru));
  };
  icerik.querySelectorAll('[data-suz]').forEach((b) => b.addEventListener('click', () => { girisTuru = b.dataset.suz; suz(); }));
  suz();
  icerik.querySelector('#ay').addEventListener('change', (e) => {
    if (!/^\d{4}-\d{2}$/.test(e.target.value)) return;
    secilenAy = e.target.value;
    yenile();
  });
  icerik.querySelectorAll('[data-is]').forEach((b) => b.addEventListener('click', () =>
    isBaslat(icerik, b.dataset.is, user, yenile)));
  icerik.querySelectorAll('[data-yeni]').forEach((b) => b.addEventListener('click', async () => {
    satisFormu(icerik, ctx, yenile);
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

// İşlem geçmişi: mal kabul, girişler, iptaller, teslimat farkları ve patronun kararları (son 60).
const ISLEM_ADI = {
  giris: (a) => [{ fatura: '📦', satis: '💰', fire: '🗑️', sayim: '📋' }[a.tur] ?? '•',
    a.tur === 'fatura' ? 'Mal girişi' : `${TURLER[a.tur]?.ad ?? 'Giriş'} girildi`, a.aciklama ?? ''],
  giris_iptal: (a) => ['↩', `${TURLER[a.tur]?.ad ?? 'Giriş'} iptal edildi`, a.tarih ? kisaTarih(a.tarih) : ''],
  belge_iptal: (a) => ['↩', 'Fatura iptal edildi', [a.tedarikci, a.fatura_no].filter(Boolean).join(' · ')],
  mal_kabul: (a) => ['📦', 'Mal kabul (sayımla)', `${a.tedarikci ?? ''}${(a.kalemler ?? []).length ? ` · ${a.kalemler.length} kalem sayıldı` : ''}`],
  teslimat_farki: (a) => ['🚚', `Teslimat farkı: ${a.malzeme ?? ''}`, a.fark_tl != null ? `≈ ${tlYaz(Math.abs(a.fark_tl))} ${a.fark_tl > 0 ? 'eksik' : 'fazla'}` : ''],
  fark_cozuldu: (a) => ['✓', `Fark kapatıldı: ${a.malzeme ?? ''}`, [COZUMLER.find(([k]) => k === a.cozum)?.[1], a.not].filter(Boolean).join(' · ')],
};
async function islemGecmisiGoster(kutu) {
  if (!kutu || kutu.dataset.yuklendi) return;
  kutu.dataset.yuklendi = '1';
  const { data, error } = await sb.from('islem_gecmisi').select('zaman, kullanici_ad, tur, ayrinti')
    .order('zaman', { ascending: false }).limit(60);
  if (error) { delete kutu.dataset.yuklendi; kutu.innerHTML = `<p class="hata">${esc(hataMetni(error))}</p>`; return; }
  kutu.innerHTML = data.length ? data.map((x) => {
    const [ikon, baslik, alt] = (ISLEM_ADI[x.tur] ?? (() => ['•', x.tur, '']))(x.ayrinti ?? {});
    return `<div class="gecmis-satir"><span class="gecmis-ikon" aria-hidden="true">${ikon}</span>
      <span class="gecmis-metin"><b>${esc(baslik)}</b><small>${esc([alt, x.kullanici_ad, zamanYaz(x.zaman)].filter(Boolean).join(' · '))}</small></span></div>`;
  }).join('') : '<p class="bilgi">Henüz kayıt yok.</p>';
}

// Satış formu: gün sonu kasa raporundaki ürün adetleri. (Mal girişi, fire ve sayım barista akışlarından)
function satisFormu(icerik, ctx, bitti) {
  const { urunler, urunBul } = ctx;
  const liste = urunler.filter((u) => u.aktif);
  const bugun = bugunStr();
  const enEski = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);

  if (!liste.length) {
    icerik.innerHTML = `<div class="kart"><h2>${TURLER.satis.dugme}</h2>
      <p class="bilgi">Önce Ürünler sekmesinden ürün eklenmeli.</p>
      <button class="tam ikincil" id="vazgec">Geri</button></div>`;
    icerik.querySelector('#vazgec').onclick = bitti;
    return;
  }

  icerik.innerHTML = `
    <form class="kart" id="giris-form">
      <h2>${TURLER.satis.dugme}</h2>
      <p class="bilgi">${TURLER.satis.not}</p>
      <label for="g-tarih">Tarih</label>
      <input id="g-tarih" name="tarih" type="date" value="${bugun}" max="${bugun}" min="${enEski}" required>
      <div id="satirlar">${liste.map((x) => `
        <div class="liste-satir">
          <label for="l-${esc(x.id)}">${esc(x.ad)}</label>
          <input id="l-${esc(x.id)}" data-id="${esc(x.id)}" inputmode="numeric" autocomplete="off" placeholder="—">
          <span class="birim">adet</span>
        </div>`).join('')}</div>
      <button class="tam" type="submit">Kaydet</button>
      <button class="tam ikincil" type="button" id="vazgec">Vazgeç</button>
      <p class="mesaj"></p>
    </form>`;
  const form = icerik.querySelector('form');
  form.querySelector('#vazgec').onclick = () => bitti();

  formBagla(form, async ({ tarih }) => {
    const gonder = [];
    for (const inp of form.querySelectorAll('#satirlar input')) {
      if (!inp.value.trim()) continue;
      const x = urunBul.get(inp.dataset.id);
      const n = sayiOku(inp.value);
      if (!Number.isInteger(n) || n < 0 || n > 100000) throw new Error(`${x.ad} için adedi tam sayı olarak yaz.`);
      if (n > 0) gonder.push({ urun_id: x.id, miktar: n });
    }
    if (!gonder.length) throw new Error('En az bir ürünün adedini yaz.');
    const { error } = await sb.rpc('giris_kaydet', { p_tur: 'satis', p_tarih: tarih, p_aciklama: null, p_kalemler: gonder });
    if (error) throw error;
    secilenAy = tarih.slice(0, 7);
    await bitti();
  });
}

// ---------- Belgeler (fatura fotoğrafı / PDF) ----------

const BELGE_KOVASI = 'fatura-belgeleri';

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
    <p class="gorev-ipucu" id="ipucu" hidden></p>
    <p class="bilgi ortada">${esc(uye.ad)}</p>`;
  const ana = () => baristaEkrani(user, uye);
  app.querySelectorAll('[data-is]').forEach((b) => b.addEventListener('click', () => isBaslat(app, b.dataset.is, user, ana)));
  // Sistem ne yapılacağını söyler: haftalık sayımın günü geldiyse sayım düğmesi öne çıkar. (Bilgi alınamazsa sessiz.)
  rpcVeri('barista_durumu').then((d) => {
    const ipucu = app.querySelector('#ipucu');
    if (!d || !ipucu) return;
    const gun = d.son_sayim ? Math.round((new Date(`${d.bugun}T12:00:00`) - new Date(`${d.son_sayim}T12:00:00`)) / 864e5) : null;
    const metin = gun == null ? 'İlk sayımı yap: stok takibi sayımla başlar.'
      : gun >= 7 ? `Bugün sayım günü · son sayım ${gun} gün önce` : null;
    if (!metin) return;
    ipucu.textContent = `📋 ${metin}`;
    ipucu.hidden = false;
    app.querySelector('[data-is="sayim"]')?.classList.add('one-cikan');
  }).catch(() => {});
}

function isBaslat(kutu, is, user, bitti) {
  const f = { mal: malGeldi, fire: fireVar, sayim: haftalikSayim, elle: elleGiris }[is];
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
        <div class="kartlar">${liste.map((s) => `<button class="kart-dugme ikonlu" data-i="${secenekler.indexOf(s)}">
          <span aria-hidden="true">${s.tur === 'u' ? '☕' : malzemeIkonu(s.m)}</span>${esc(s.ad)}</button>`).join('') || '<p class="bilgi">Bulunamadı.</p>'}</div>
        <button class="dev ikincil" id="geri">◀ Ana ekran</button></div>`;
    kutu.querySelector('#geri').onclick = () => bitti();
    const ar = kutu.querySelector('#ara');
    if (ar) {
      ar.oninput = () => { neEkrani(ar.value); };
      if (ara) { ar.focus(); ar.setSelectionRange(ar.value.length, ar.value.length); }   // yazarken odak kalsın
    }
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

// ---------- ✍️ Elle mal girişi: market fişi / faturasız mal (barista ve patron) ----------
// Ne aldın? → kaç? (+ fişteki tutar, isteğe bağlı) → liste → kaydet. Fiş okunmaz. Tutar kayıtlı fiyattan çok
// saparsa sunucu fiyatı değiştirmez, patronun kontrolüne düşürür (sql/22 elle_mal_kabul).
async function elleGiris(kutu, user, bitti) {
  const malzemeler = (await malzemeleriGetir(false)).filter((m) => m.aktif).sort(adaGore);
  if (!malzemeler.length) return sadeHata(kutu, 'Henüz malzeme eklenmemiş. Patrona haber ver.', bitti);
  const sepet = [];            // { m, adet (sayım biriminde), tutar | null }
  const istek = istekKimligi();
  let nereden = '';

  const neEkrani = (ara = '') => {
    const k = anahtar(ara);
    const liste = malzemeler.filter((m) => !k || anahtar(m.ad).includes(k));
    kutu.innerHTML = `<div class="sade-ekran">
        <h2>✍️ Ne aldın?</h2>
        ${malzemeler.length > 10 ? `<input id="ara" class="buyuk-giris" placeholder="🔍 Ara" value="${esc(ara)}">` : ''}
        <div class="kartlar">${liste.map((m) => `<button class="kart-dugme ikonlu" data-m="${esc(m.id)}">
          <span aria-hidden="true">${malzemeIkonu(m)}</span>${esc(m.ad)}</button>`).join('') || '<p class="bilgi">Bulunamadı.</p>'}</div>
        <button class="dev ikincil" id="geri">◀ ${sepet.length ? 'Listeye dön' : 'Vazgeç'}</button></div>`;
    kutu.querySelector('#geri').onclick = () => (sepet.length ? listeEkrani() : bitti());
    const ar = kutu.querySelector('#ara');
    if (ar) {
      ar.oninput = () => neEkrani(ar.value);
      if (ara) { ar.focus(); ar.setSelectionRange(ar.value.length, ar.value.length); }   // ilk açılışta klavye açılmaz
    }
    kutu.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => miktarEkrani(malzemeler.find((m) => m.id === b.dataset.m)));
  };

  const miktarEkrani = (m, hata = '') => {
    const b = sayimBirimiBul(m);
    kutu.innerHTML = `<div class="sade-ekran ortada">
        <div class="sayim-ikon" aria-hidden="true">${malzemeIkonu(m)}</div>
        <h2 class="soru">Kaç ${esc(b.ad)} <u>${esc(m.ad)}</u>?</h2>
        ${sayacKutusu(b.ad)}
        <p class="bilgi">${esc(b.ipucu)}</p>
        <label class="not-alani">Fişteki tutar (TL, KDV dahil) — biliyorsan
          <input id="tutar" inputmode="decimal" autocomplete="off" placeholder="Örn. 84,90"></label>
        <p class="mesaj ${hata ? 'hata' : ''}">${esc(hata)}</p>
        <button class="dev evet" id="ekle">Ekle ✓</button>
        <button class="dev ikincil" id="geri">◀ Başka malzeme</button></div>`;
    const inp = sayacBagla(kutu);
    inp.focus();
    kutu.querySelector('#geri').onclick = () => neEkrani();
    kutu.querySelector('#ekle').onclick = () => {
      const n = sayiOku(inp.value);
      const tYazi = kutu.querySelector('#tutar').value.trim();
      const tutar = tYazi ? sayiOku(tYazi) : null;
      if (!(n > 0) || n >= 100000) return miktarEkrani(m, `Kaç ${b.ad} aldığını yaz.`);
      if (tYazi && !(tutar >= 0)) return miktarEkrani(m, 'Tutarı rakamla yaz (örn. 84,90) ya da boş bırak.');
      sepet.push({ m, adet: n, tutar });
      listeEkrani();
    };
  };

  const listeEkrani = (hata = '') => {
    const toplam = sepet.reduce((t, s) => t + (s.tutar ?? 0), 0);
    kutu.innerHTML = `<div class="sade-ekran">
        <h2>✍️ Elle mal girişi</h2>
        <ul class="kabul-liste">${sepet.map((s, i) => `<li class="kabul-kalem">
            <span class="kalem-ikon" aria-hidden="true">${malzemeIkonu(s.m)}</span>
            <span class="kalem-metin"><b>${sayiYaz(s.adet)} ${esc(sayimBirimiBul(s.m).ad)}</b> ${esc(s.m.ad)}
              <small>${s.tutar != null ? tl.format(s.tutar) : 'Tutar yok'}</small></span>
            <button class="metin-dugme" data-sil="${i}" aria-label="${esc(s.m.ad)} sil">Sil</button></li>`).join('')}</ul>
        ${toplam ? `<p class="buyuk-yazi">Toplam ${tl.format(toplam)}</p>` : ''}
        <button class="dev ikincil" id="daha">＋ Bir malzeme daha</button>
        <label class="not-alani">Nereden aldın? (isteğe bağlı)
          <input id="nereden" maxlength="60" placeholder="Örn. Market" value="${esc(nereden)}"></label>
        <p class="mesaj ${hata ? 'hata' : ''}">${esc(hata)}</p>
        <button class="dev" id="kaydet" ${sepet.length ? '' : 'disabled'}>Kaydet ✓</button>
        <button class="metin-dugme" id="vazgec">Vazgeç</button></div>`;
    const ner = kutu.querySelector('#nereden');
    ner.oninput = () => { nereden = ner.value; };
    kutu.querySelectorAll('[data-sil]').forEach((b) => b.onclick = () => { sepet.splice(Number(b.dataset.sil), 1); listeEkrani(); });
    kutu.querySelector('#daha').onclick = () => neEkrani();
    kutu.querySelector('#vazgec').onclick = () => { if (!sepet.length || confirm('Kaydedilmeden çıkılsın mı?')) bitti(); };
    kutu.querySelector('#kaydet').onclick = async (e) => {
      e.target.disabled = true;
      try {
        const id = await rpcVeri('elle_mal_kabul', { p_istek: istek, p_aciklama: nereden.trim() || null,
          p_kalemler: sepet.map((s) => ({ malzeme_id: s.m.id, miktar: Math.round(s.adet * sayimBirimiBul(s.m).kat * 1000) / 1000,
            tutar: s.tutar })) });
        kaydedildi(kutu, { baslik: 'Stoğa eklendi', alt: `${sepet.length} kalem elle girildi.`, geriAl: geriAlIstegi('giris', id), bitti });
      } catch (err) {
        listeEkrani(/could not find the function/i.test(err.message ?? '')
          ? 'Uygulama güncelleniyor. Birkaç dakika sonra tekrar dene.' : hataMetni(err));
      }
    };
  };

  neEkrani();
}

// ---------- 📋 Haftalık sayım: her ekranda tek malzeme (alfabetik) → özet → kaydet → satış raporu ----------

async function haftalikSayim(kutu, user, bitti) {
  const malzemeler = (await malzemeleriGetir(false)).filter((m) => m.aktif);
  if (!malzemeler.length) return sadeHata(kutu, 'Henüz malzeme eklenmemiş. Patrona haber ver.', bitti);
  const sayimBirimi = sayimBirimiBul;
  // Yarım kalan sayım telefonda saklanır (kilitlenme, müşteri…); kaldığı yerden devam edilir.
  // (Anahtar 2: birim kuralı değişti; eski yarım sayımdaki "litre" değerleri şişe sanılmasın.)
  const anahtarAd = `kahve-sayim2:${mekan.id}:${user.id}`;
  let t = null;
  try { t = JSON.parse(localStorage.getItem(anahtarAd) || 'null'); } catch { t = null; }
  if (!t || t.gun !== bugunStr()) t = { gun: bugunStr(), i: 0, degerler: {}, istek: istekKimligi() };
  const sakla = () => { try { localStorage.setItem(anahtarAd, JSON.stringify(t)); } catch { /* özel pencere */ } };
  const sil = () => { try { localStorage.removeItem(anahtarAd); } catch { /* yok say */ } };

  const ekran = () => {
    if (t.i >= malzemeler.length) return ozet();
    const m = malzemeler[t.i];
    const d = t.degerler[m.id];
    const sayimB = sayimBirimi(m);
    kutu.innerHTML = `<div class="sade-ekran">
        <p class="ilerleme">${t.i + 1} / ${malzemeler.length}</p>
        <div class="cubuk"><div style="width:${Math.round((t.i / malzemeler.length) * 100)}%"></div></div>
        <div class="sayim-ikon" aria-hidden="true">${malzemeIkonu(m)}</div>
        <h2 class="malzeme-adi">${esc(m.ad)}</h2>
        ${sayacKutusu(sayimB.ad, d === 'atla' || d == null ? '' : d)}
        <p class="bilgi ortada">${esc(sayimB.ipucu)}</p>
        <p class="mesaj"></p>
        <div class="iki-dugme"><button class="dev ikincil" id="geri">◀</button><button class="dev" id="ileri">Sonraki ▶</button></div>
        <button class="dev ikincil kucuk-dev" id="atla">Bilmiyorum, geç</button>
        <button class="metin-dugme" id="cik">Sonra devam et</button></div>`;
    const inp = sayacBagla(kutu);
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
    // Kaydetmeden önce her değer birimiyle görünür ("Maden suyu: 100 şişe = 20 litre"); yanlış birim göze batar.
    const ozetSatir = (m) => {
      const sayimB = sayimBirimi(m);
      const n = sayiOku(t.degerler[m.id]);
      const kucuk = Math.round(n * sayimB.kat * 1000) / 1000;
      return `<tr><td>${esc(m.ad)}</td><td>${sayiYaz(n)} ${esc(sayimB.ad)}${sayimB.ad === 'şişe / paket' ? ` = ${buyukMiktar(kucuk, m.birim)}` : ''}</td></tr>`;
    };
    kutu.innerHTML = `<div class="sade-ekran">
        <h2>📋 Sayım bitti</h2>
        <p class="buyuk-yazi">✓ ${sayilan.length} malzeme sayıldı${atlanan.length ? `<br>— ${atlanan.length} atlandı` : ''}</p>
        ${sayilan.length ? `<p class="bilgi">Rakamlara son bir kez bak:</p><table class="tablo">${sayilan.map(ozetSatir).join('')}</table>` : ''}
        ${atlanan.length ? `<p class="bilgi">Atlanan: ${atlanan.map((m) => esc(m.ad)).join(', ')}</p>` : ''}
        <p class="mesaj"></p>
        <button class="dev" id="kaydet" ${sayilan.length ? '' : 'disabled'}>Kaydet ✓</button>
        <button class="dev ikincil" id="geri">◀ Geri dön</button></div>`;
    kutu.querySelector('#geri').onclick = () => { t.i = malzemeler.length - 1; sakla(); ekran(); };
    kutu.querySelector('#kaydet').onclick = async (e) => {
      e.target.disabled = true;
      try {
        const id = await rpcVeri('giris_kaydet_tek', { p_istek: t.istek, p_tur: 'sayim', p_tarih: bugunStr(), p_aciklama: null,
          p_kalemler: sayilan.map((m) => ({ malzeme_id: m.id,
            miktar: Math.round(sayiOku(t.degerler[m.id]) * sayimBirimi(m).kat * 1000) / 1000 })) });
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
        <label class="dev ikincil">📎 Dosya seç<input type="file" accept="image/*,application/pdf,.csv,.txt,.xml,.xlsx,.tsv" id="r-dosya" hidden></label>
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
          const tur = salesFileKind(dosya, dosyaTuru);
          const blob = tur === 'foto' ? await fotoKucult(dosya) : dosya;
          if (blob.size > 5 * 1024 * 1024) throw new Error('Dosya çok büyük (en fazla 5 MB).');
          const uzanti = tur === 'foto' ? 'jpg' : tur === 'pdf' ? 'pdf' : tur === 'xml' ? 'xml' : (dosya.name.split('.').pop() || 'txt').toLowerCase();
          const yol = `${mekan.id}/${istek}/rapor.${uzanti}`;
          const tip = tur === 'foto' ? 'image/jpeg' : tur === 'pdf' ? 'application/pdf' : tur === 'xml' ? 'application/xml'
            : uzanti === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : uzanti === 'csv' ? 'text/csv' : 'text/plain';
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

// ---------- 📦 Mal geldi: belge → karekod → okuma → (tutmazsa ikinci okuma) → kör sayım → özet → kaydet ----------
//
// Kör sayım: barista faturadaki miktarı GÖRMEDEN gelen malı sayar. Sayılan farklıysa bir kez daha saydırılır;
// hâlâ farklıysa fark okumadan mı teslimattan mı, mal-kabul.js karar verir (fotoğrafta ikinci okumaya bakılır).
// Stok sayılan kadar artar; gerçek eksik/fazla teslimatı sunucu patrona görev olarak açar.

const OKUNAMADI = {
  bulanik: 'Fotoğraf bulanık, bir daha çek.',
  satir_yok: 'Fatura okunamadı. Daha yakından ve düz çek.',
  fatura_degil: 'Bu bir fatura ya da fiş değil gibi görünüyor (sipariş formu, teklif…). Stoğa eklenmedi.',
  satir_karisik: 'Fişteki adetler satırlara karışık okundu. Fişi düz tutup tekrar çek.',
};

// Okuma tutarsızsa (toplam / karekod tutmuyor, sayılan farklı) fatura bu modelle bir kez daha okunur.
const IKINCI_MODEL = 'gpt-4.1';

const blobDataUrl = (blob) => new Promise((ok, hata) => {
  const r = new FileReader();
  r.onload = () => ok(r.result);
  r.onerror = () => hata(r.error);
  r.readAsDataURL(blob);
});
const ms = (a, b) => Math.round(b - a);
const sureBekle = (n) => new Promise((r) => setTimeout(r, n));

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

// XML / metinli PDF / telefondaki OCR satırlarını AI'ya yalnız METİN olarak eşleştirtir (fotoğraf gitmez, fiyat
// gitmez; ucuz). Marka, boyut, ambalaj farkını AI anlar ("Coca Cola 330ml 24'lü koli" → Kola). Hata olursa fırlatır.
async function aiIleEslestir(satirlar) {
  const { data, error } = await sb.functions.invoke('fatura-oku', {
    body: { satirlar: satirlar.map((s) => ({ metin: s.metin, miktar: s.miktar, birim: s.birim })) } });
  if (error) throw error;
  const sonuc = new Map((data?.sonuc?.satirlar ?? []).map((x) => [x.sira, x.eslesme]));
  return satirlar.map((_, i) => sonuc.get(i + 1) ?? null);
}

// Bu fatura (karekod / e-fatura kimliği) mekanda zaten kayıtlı mı? Kontrol yapılamazsa null: akış durmaz,
// sunucu kayıt sırasında ayrıca kontrol eder.
async function mukerrerMi({ ettn = null, no = null, vkn = null } = {}) {
  if (!ettn && !(no && vkn)) return null;
  try {
    const r = await rpcVeri('belge_kayitli_mi', { p_ettn: ettn, p_no: no, p_vkn: vkn });
    return r?.var ? r : null;
  } catch (e) {
    console.warn('Mükerrer kontrolü yapılamadı:', e);
    return null;
  }
}

// Fotoğraf: önce karekod (en fazla 1,5 sn); fatura zaten kayıtlıysa AI'ya hiç gidilmez. Karekod o sürede
// bulunamazsa arama arka planda sürer, AI okuması başlar; karekod sonradan bulunursa yine kullanılır.
function fotoOkumasiBaslat(bloblar) {
  return (async () => {
    const kk = await karekodOnce(bloblar[0]);
    if (kk.hazir) {
      const m = await mukerrerMi({ ettn: kk.hazir.karekod.ettn, no: kk.hazir.karekod.no, vkn: kk.hazir.karekod.vkn });
      if (m) return { kk, mukerrer: m };
    }
    try { return { kk, ai: await aiIleOku(bloblar) }; } catch (hata) { return { kk, hata }; }
  })();
}

// Malzemenin kartlardaki simgesi (adından; bulunamazsa birimden).
function malzemeIkonu(m) {
  const a = anahtar(m?.ad);
  if (/\b(sut|krema|ayran)/.test(a)) return '🥛';
  if (/\b(kahve|espresso|cekirdek|filtre)/.test(a)) return '☕';
  if (/\b(cay|bitki)/.test(a)) return '🍵';
  if (/\b(surup|sos|bal)/.test(a)) return '🍯';
  if (/\b(bardak|kapak|pipet)/.test(a)) return '🥤';
  if (/\b(seker)/.test(a)) return '🧂';
  return { ml: '🧴', g: '⚖️', adet: '📦' }[m?.birim] ?? '📦';
}

async function malGeldi(kutu, user, bitti) {
  const [malzemeler, dr, surum] = await Promise.all([
    malzemeleriGetir(false),
    sb.from('eslestirme_defteri').select('tedarikci_anahtar, metin_anahtar, birim, sonuc, malzeme_id, carpan, guncelleme'),
    // Sunucu kör sayımı biliyor mu (sql/21)? Bilmiyorsa sayılan miktar sessizce yok sayılır, stok faturadaki kadar
    // girerdi: mal kabul açılmaz.
    rpcVeri('belge_kayitli_mi', { p_ettn: null, p_no: null, p_vkn: null }).then(() => true,
      (e) => !/could not find the function|belge_kayitli_mi/i.test(e?.message ?? '')),
  ]);
  if (dr.error) throw dr.error;
  if (!surum) {
    return sadeHata(kutu, 'Uygulama güncelleniyor. Birkaç dakika sonra tekrar dene; faturayı sakla.', bitti);
  }
  const malzemeBul = new Map(malzemeler.map((m) => [m.id, m]));
  let dosyalar = [];          // { dosya (asıl), tur: 'foto'|'pdf'|'xml', onizleme, yuklenen: {blob, yol} }
  let sonuc = null;           // kullanılan okuma + satırların sınıfı ve sayımı
  let istek = null;           // kaydetme kimliği (tekrar denemelerde aynı)
  let ayniOnay = false;
  let onOkuma = null;         // ilk fotoğraf eklenir eklenmez arka planda başlayan karekod + AI okuması { dosya, is }
  let olcum = {};             // süreler (ms): küçültme, gönderme, AI, kayıt
  let okunanGorseller = [];   // AI'ya gönderilen görseller (ikinci okuma için)
  let kk = null;              // bulunan karekod { metin, karekod } ya da null
  let ilkOkuma = null;        // ilk AI okuması (ikinci okuma kullanılırsa iz için)
  let ikinci = null;          // ikinci okuma sonucu (belge başına en fazla bir kez)
  let ikinciDenendi = false;
  let kullanilan = 'ilk';     // 'ilk' | 'ikinci'
  const onOkumaBaslat = () => {
    const fotolar = dosyalar.filter((d) => d.tur === 'foto');
    if (fotolar.length !== 1 || onOkuma?.dosya === fotolar[0]) return;
    onOkuma = { dosya: fotolar[0], is: fotoOkumasiBaslat([fotolar[0].dosya]) };
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
        <p class="bilgi">Faturanın tamamı, karekodu da görünecek şekilde çek.</p>
        ${fotolar.length ? '' : '<button class="dev ikincil" id="elle">✍️ Market fişi / faturasız: elle gir</button>'}
        <p class="mesaj"></p>
        <button class="dev ikincil" id="geri">◀ Ana ekran</button></div>`;
    kutu.querySelector('#geri').onclick = () => { temizle(); bitti(); };
    kutu.querySelector('#elle')?.addEventListener('click', () => { temizle(); isBaslat(kutu, 'elle', user, bitti); });
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
      onOkumaBaslat();         // barista "Oku"ya basmadan karekod ve okuma başlasın
      belgeEkrani();
    });
    ekle(kutu.querySelector('#kamera'));
    ekle(kutu.querySelector('#dosya'));
  };
  const temizle = () => { dosyalar.forEach((d) => d.onizleme && URL.revokeObjectURL(d.onizleme)); };
  const bastanCek = () => {
    temizle(); dosyalar = []; sonuc = null; istek = null; onOkuma = null; kk = null;
    ilkOkuma = null; ikinci = null; ikinciDenendi = false; kullanilan = 'ilk'; okunanGorseller = [];
    belgeEkrani();
  };

  const bekleEkrani = (baslik, alt = 'Birkaç saniye sürer.') => {
    kutu.innerHTML = `<div class="sade-ekran ortada">
        <div class="buyuk-simge donen">⏳</div><h2>${esc(baslik)}</h2>
        <div class="cubuk akan"><div id="okuma-cubuk"></div></div>
        <p class="bilgi" id="okuma-not">${esc(alt)}</p></div>`;
  };

  const oku = async () => {
    bekleEkrani('Okunuyor…');
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
    let kkArama = null;        // { hazir, sonra } — karekod araması
    // Fotoğraf (ya da taranmış PDF sayfası): önce karekod + AI, AI olmazsa telefondaki OCR
    const fotoOku = async (bloblar, onceden) => {
      okunanGorseller = bloblar;
      const a = await (onceden ?? fotoOkumasiBaslat(bloblar));
      kkArama = a.kk;
      if (a.mukerrer) return { mukerrer: a.mukerrer };
      try {
        if (a.hata) throw a.hata;
        olcum = { ...olcum, ...a.ai.olcum };
        return a.ai.sonuc;
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
    let r;
    try {
      const d0 = dosyalar[0];
      if (d0.tur === 'xml') r = await xmlDosyaOku(d0.dosya);                // ETTN dosyanın içinde
      else if (d0.tur === 'pdf') {
        r = await pdfOku(d0.dosya);
        if (r.taranmis) r = await fotoOku(r.sayfalar);
        else {
          const sayfa = await pdfIlkSayfa(d0.dosya).catch(() => null);
          kkArama = sayfa ? { hazir: null, sonra: karekodBul(sayfa) } : null;
        }
      } else {
        const fotolar = dosyalar.map((d) => d.dosya);
        const hazir = dosyalar.length === 1 && onOkuma?.dosya === dosyalar[0] ? onOkuma.is : null;
        r = await fotoOku(fotolar, hazir);
      }
      if (r.mukerrer) { clearTimeout(uzunSurdu); return mukerrerEkrani(r.mukerrer); }
      sonuc = r;
      ilkOkuma = r;
      // Karekod araması okumadan sonra en fazla 1,5 sn daha beklenir
      kk = kkArama ? await Promise.race([kkArama.sonra, sureBekle(1500).then(() => null)]) : null;
      if (kk?.karekod) karekoduUygula(kk.karekod, sonuc);
      const m = await mukerrerMi({ ettn: sonuc.ettn, no: sonuc.fatura_no, vkn: sonuc.tedarikci_vkn });
      if (m) { clearTimeout(uzunSurdu); return mukerrerEkrani(m); }
      olcum.okuma_toplam_ms = ms(t0, performance.now());
    } catch (err) {
      console.error(err);
      clearTimeout(uzunSurdu);
      return sorunEkrani('Fatura okunamadı. Tekrar dene ya da daha net çek.', false);
    }
    clearTimeout(uzunSurdu);
    if (sonuc.notlar?.includes('bulanik')) return sorunEkrani(OKUNAMADI.bulanik, true);
    if (!sonuc.satirlar.length) return sorunEkrani(OKUNAMADI.satir_yok, true);
    // Fatura değil / satırlar karışık: hiçbir satır kendiliğinden stoğa girmez; gönderilirse tamamı kuruluma
    if (sonuc.notlar?.includes('fatura_degil')) return sorunEkrani(OKUNAMADI.fatura_degil, true, true);
    if (sonuc.notlar?.includes('satir_karisik')) return sorunEkrani(OKUNAMADI.satir_karisik, true, true);
    await okumayiDogrula();
    await metinleEslestir();
    siniflandirHepsi();
    soruSirasi();
  };

  // Fotoğraf okunmadıysa (XML, PDF, yedek OCR) defterde olmayan satırlar AI'ya metin olarak eşleştirtilir.
  // Olmazsa (internet, sınır) kurallar çalışır; akış durmaz.
  const metinleEslestir = async () => {
    if (sonuc.kaynak === 'ai') return;
    const defterde = (s) => (dr.data ?? []).some((d) => d.metin_anahtar === (anahtar(s.metin) || '-') && d.birim === (s.birim || 'diger'));
    const sorulacak = sonuc.satirlar.filter((s) => !s.ai && !defterde(s));
    if (!sorulacak.length) return;
    bekleEkrani('Ürünler eşleştiriliyor…');
    try {
      const t = performance.now();
      const sonuclar = await Promise.race([aiIleEslestir(sorulacak),
        sureBekle(15000).then(() => { throw new Error('zaman aşımı'); })]);
      sorulacak.forEach((s, i) => { s.ai = sonuclar[i]; });
      olcum.metin_eslesme_ms = ms(t, performance.now());
    } catch (e) {
      console.warn('Metinle eşleştirme olmadı, kurallar kullanılıyor:', e);
      olcum.metin_eslesme_hata = String(e?.message ?? e).slice(0, 100);
    }
  };

  // ---------- Okuma doğrulama ----------
  // Okuma kendi içinde (satırlar = toplam) ve karekodla (makine verisi) tutarlı mı? Toplam okunamadıysa ve
  // karekod yoksa bilinemez → tutarlı sayılır (barista toplamı yazar, sunucu kontrol eder).
  const tutarliMi = (s) => {
    if (kk?.karekod?.tur === 'fatura' && karekodlaKarsilastir(kk.karekod, s).tutuyor === false) return false;
    return s.toplamlar.genel == null || toplamKontrol(s).tutuyor;
  };
  // İkinci okuma: aynı görseller farklı bir modelle. Yalnız fotoğraf okumasında, belge başına bir kez.
  const ikinciOku = async () => {
    if (ikinciDenendi || ilkOkuma?.kaynak !== 'ai' || !okunanGorseller.length) return ikinci;
    ikinciDenendi = true;
    try {
      const a = await aiIleOku(okunanGorseller, IKINCI_MODEL);
      if (kk?.karekod) karekoduUygula(kk.karekod, a.sonuc);
      ikinci = a.sonuc;
      olcum.ikinci_ai_ms = a.olcum.ai_ms;
    } catch (e) {
      console.warn('İkinci okuma olmadı:', e);
    }
    return ikinci;
  };
  // Kullanılmayan okuma (sayım farkında karşılaştırma için): ikinci kullanılıyorsa ilki, değilse ikinci.
  const digerOkuma = async () => (kullanilan === 'ikinci' ? ilkOkuma : ikinciOku());
  // Tutarsız okumada ikinci okuma; tutan kullanılır. İkisi de tutmazsa toplam karekoddan (makine verisi) alınır →
  // satırlar sunucunun toplam kontrolünü geçemez, stoğa girmeden kontrole düşer: yanlış rakam sessizce girmez.
  const okumayiDogrula = async () => {
    if (sonuc.kaynak !== 'ai' || tutarliMi(sonuc)) return;
    bekleEkrani('Fatura bir kez daha kontrol ediliyor…');
    const s2 = await ikinciOku();
    if (s2 && tutarliMi(s2)) { sonuc = s2; kullanilan = 'ikinci'; return; }
    const kg = kk?.karekod;
    if (kg?.tur === 'fatura' && (kg.vergidahil ?? kg.odenecek) != null) sonuc.toplamlar.genel = kg.vergidahil ?? kg.odenecek;
    sonuc.notlar.push('okuma_tutarsiz');
  };

  // Okuma sorunu: tekrar çek ya da yine de devam (belge kuruluma gider)
  const sorunEkrani = (metin, devamEdilebilir, hepsiKuruluma = false) => {
    kutu.innerHTML = `<div class="sade-ekran ortada">
        <div class="buyuk-simge">📷</div><h2>${esc(metin)}</h2>
        <button class="dev" id="tekrar">📷 Tekrar çek</button>
        ${devamEdilebilir ? '<button class="dev ikincil" id="devam">Yine de gönder</button>' : ''}
        <button class="metin-dugme" id="geri">Ana ekran</button></div>`;
    kutu.querySelector('#tekrar').onclick = bastanCek;
    kutu.querySelector('#geri').onclick = () => { temizle(); bitti(); };
    kutu.querySelector('#devam')?.addEventListener('click', () => {
      if (!sonuc.satirlar.length) sonuc.satirlar = [{ metin: '(fatura okunamadı)', miktar: null, birim: 'diger', tutar_haric: null, kdv_orani: null }];
      siniflandirHepsi();
      if (hepsiKuruluma) {
        sonuc.satirlar.forEach((s) => {
          s.karar = { sinif: 'kurulum', aday_malzeme_id: s.karar.aday_malzeme_id ?? s.karar.malzeme_id ?? null };
        });
      }
      soruSirasi();
    });
  };

  const mukerrerEkrani = (m) => {
    kutu.innerHTML = `<div class="sade-ekran ortada">
        <div class="buyuk-simge">🔁</div><h2>Bu fatura daha önce yüklenmiş</h2>
        <p class="buyuk-yazi">${esc(m.tarih ?? '')} · ${esc(m.giren_ad ?? '')}</p>
        <p class="bilgi">Stoğa tekrar eklenmedi.</p>
        <button class="dev" id="ana">Ana ekran</button>
        <button class="dev ikincil" id="baska">📷 Başka bir fatura çek</button></div>`;
    kutu.querySelector('#ana').onclick = () => { temizle(); bitti(); };
    kutu.querySelector('#baska').onclick = bastanCek;
  };

  const tedarikciAnahtari = () => sonuc.tedarikci_vkn || anahtar(sonuc.tedarikci) || '';
  const siniflandirHepsi = () => {
    const ctx = { malzemeler, defter: dr.data, tedarikciAnahtar: tedarikciAnahtari(), tedarikciAdi: sonuc.tedarikci };
    // Defter önce; AI kararı varsa (fotoğraf ya da metin eşleştirmesi) o, yoksa kurallar.
    sonuc.satirlar.forEach((s) => { s.karar = aiIleSiniflandir(s, ctx); s.cevap = null; });
  };

  // ---------- Kör sayım ----------
  // Stoğa girecek her satır (defterden bilinen ya da baristaya sorulan) sayılır; faturadaki miktar gösterilmez.
  const stokAdayi = (s) => s.karar.sinif === 'eslesti' || s.karar.sinif === 'soru';
  const OLCU = { kg: 'kg', g: 'g', lt: 'litre', ml: 'ml' };
  // Paket içi bilinmiyorsa (stokBirimi) barista malzemenin kendi biriminde sayar: kg / litre / adet.
  const STOK_SAYIM = { g: ['kg', 1000], ml: ['litre', 1000], adet: ['adet', 1] };
  const sayimBirimi = (s, m) => {
    if (s.karar.stokBirimi) return STOK_SAYIM[m.birim][0];
    if (s.birim === 'diger' || (s.birim === 'adet' && m.birim === 'adet' && s.karar.carpan > 1)) return 'paket';
    return { adet: 'adet', ...OLCU }[s.birim] ?? 'paket';
  };
  // "Bu ürün X değil": stok listesinde karşılığı yok sayılır, stoğa girmeden sessizce geçilir.
  const gec = (s, m) => {
    s.karar = { sinif: 'belirsiz', aday_malzeme_id: m.id };
    s.cevap = 'hayir';
  };
  // Paket içi bilinmeyen satır şu an sayılamıyorsa stoğa tahminle girmez, kurulum bakar.
  const kuruluma = (s, m) => {
    s.karar = { sinif: 'kurulum', aday_malzeme_id: m.id };
    s.cevap = 'hayir';
  };

  const sayimEkrani = (s, m, { tekrar = false, hata = '' } = {}) => {
    const b = sayimBirimi(s, m);
    const paketYazisi = !s.karar.stokBirimi && (b === 'paket' || b === 'adet') && Number(s.karar.carpan) !== 1
      ? `<p class="buyuk-yazi">1 ${b} = ${buyukMiktar(s.karar.carpan, m.birim)}</p>` : '';
    const sira = sonuc.satirlar.filter(stokAdayi);
    const no = sira.indexOf(s) + 1;
    kutu.innerHTML = `<div class="sade-ekran ortada" id="sayim-ekrani"
          data-metin="${esc(s.metin)}" data-malzeme="${esc(m.ad)}" data-carpan="${s.karar.carpan}">
        ${sira.length > 1 ? `<div class="sayim-ilerleme" aria-label="${no}. kalem / ${sira.length}">
          ${sira.map((_, i) => `<span class="${i < no - 1 ? 'bitti' : i === no - 1 ? 'simdi' : ''}"></span>`).join('')}</div>` : ''}
        <div class="sayim-ikon" aria-hidden="true">${malzemeIkonu(m)}</div>
        ${tekrar ? '<p class="sayim-uyari">Sayı faturayla uyuşmadı. Bir daha sayar mısın?</p>'
                 : '<p class="bilgi">Gelen malı say, faturaya bakmadan yaz.</p>'}
        <h2 class="soru">Kaç ${b} <u>${esc(m.ad)}</u> geldi?</h2>
        ${paketYazisi}
        <div class="sayac">
          <button type="button" class="sayac-dugme" data-adim="-1" aria-label="Bir azalt">−</button>
          <input id="sayim" inputmode="decimal" autocomplete="off" aria-label="Kaç ${b}">
          <button type="button" class="sayac-dugme" data-adim="1" aria-label="Bir artır">+</button>
        </div>
        <p class="sayim-birim">${b}</p>
        <p class="buyuk-yazi" id="sayim-toplam" aria-live="polite"></p>
        ${tekrar ? `<label class="not-alani">Not (isteğe bağlı)
          <input id="not" maxlength="300" placeholder="Örn. bir koli hasarlı geldi" value="${esc(s.barista_notu ?? '')}"></label>` : ''}
        <p class="mesaj ${hata ? 'hata' : ''}">${esc(hata)}</p>
        <button class="dev evet" id="sayim-tamam">Tamam ✓</button>
        <button class="dev ikincil" id="sayilamiyor">${s.karar.stokBirimi ? 'Şu an sayamıyorum'
          : `${OLCU[s.birim] ? 'Tartamıyorum' : 'Şu an sayamıyorum'} — faturadaki gibi al`}</button>
        <button class="metin-dugme" id="hayir">Bu ürün ${esc(m.ad)} değil</button></div>`;
    const girdi = kutu.querySelector('#sayim');
    const toplamYaz = () => {
      const n = sayiOku(girdi.value);
      kutu.querySelector('#sayim-toplam').textContent = !s.karar.stokBirimi && Number.isFinite(n) && n > 0 && !OLCU[b === 'litre' ? 'lt' : b]
        ? `= ${buyukMiktar(n * s.karar.carpan, m.birim)} ${m.ad}` : '';
    };
    // Yazarken toplamı göster: paket yerine adet yazılırsa (1000 paket) barista hemen görür.
    girdi.addEventListener('input', toplamYaz);
    kutu.querySelectorAll('.sayac-dugme').forEach((d) => d.addEventListener('click', () => {
      const n = sayiOku(girdi.value);
      girdi.value = String(Math.max(0, (Number.isFinite(n) ? n : 0) + Number(d.dataset.adim))).replace('.', ',');
      toplamYaz();
    }));
    kutu.querySelector('#sayim-tamam').onclick = () => {
      const n = sayiOku(girdi.value);
      if (!Number.isFinite(n) || n < 0) return sayimEkrani(s, m, { tekrar, hata: `Kaç ${b} geldiğini yaz. Hiç gelmediyse 0 yaz.` });
      s.barista_notu = kutu.querySelector('#not')?.value.trim() || s.barista_notu || null;
      // İlk sayım faturayla uyuşmuyorsa bir kez daha saydırılır (faturadaki sayı yine gösterilmez).
      if (!tekrar && !s.karar.stokBirimi && s.miktar != null && !ayniMiktar(n, s.miktar)) return sayimEkrani(s, m, { tekrar: true });
      sayimBitir(s, n);
    };
    kutu.querySelector('#sayilamiyor').onclick = () => {
      if (s.karar.stokBirimi) kuruluma(s, m);
      else Object.assign(s, { sayim: 'sayilmadi', gelen_miktar: null, teslimat: null, cevap: 'evet' });
      soruSirasi();
    };
    kutu.querySelector('#hayir').onclick = () => { gec(s, m); soruSirasi(); };
    girdi.focus();
  };

  // Son sayım: tam mı, okuma hatası mı, teslimat farkı mı? (Fotoğrafta ikinci okumaya bakılır.)
  const sayimBitir = async (s, n) => {
    Object.assign(s, { sayim: 'sayildi', gelen_miktar: n, cevap: 'evet' });
    if (s.karar.stokBirimi) {
      // Paket içi bilinmiyordu: sayılan (kg / litre / adet) esas. Faturadaki satır tutarı bu miktarın tutarıdır;
      // teslimat farkı bu satırda ölçülemez. Çarpan sayımdan çıktığı için deftere yazılmaz (sunucu).
      const m = malzemeBul.get(s.karar.malzeme_id);
      Object.assign(s, { okunan_miktar: s.miktar, miktar: n, birim_fiyat: null, teslimat: 'tam' });
      s.karar = { ...s.karar, carpan: STOK_SAYIM[m.birim][1] };
      return soruSirasi();
    }
    let k;
    if (s.miktar == null) {
      k = { karar: 'okuma_hatasi' };                      // miktar okunamamıştı: sayılan esas
    } else {
      let ikinciMiktar = null;
      if (!ayniMiktar(n, s.miktar) && !kesinKaynak(sonuc.kaynak)) {
        bekleEkrani('Fatura bir kez daha kontrol ediliyor…');
        const diger = await digerOkuma();
        const i = diger ? satirEsle(s, diger.satirlar) : -1;
        if (i >= 0) ikinciMiktar = diger.satirlar[i].miktar;
      }
      k = teslimatKarari({ kaynak: sonuc.kaynak, faturadaki: s.miktar, sayilan: n, ikinci: ikinciMiktar });
    }
    s.teslimat = k.karar;
    if (k.karar === 'okuma_hatasi') {
      // İlk okuma yanlıştı: faturadaki miktar sayılana eşitlenir, birim fiyat satır tutarından yeniden çıkar.
      s.okunan_miktar = s.miktar;
      s.miktar = n;
      s.birim_fiyat = s.tutar_haric != null && n > 0 ? Math.round((s.tutar_haric / n) * 10000) / 10000 : null;
    }
    soruSirasi();
  };

  const soruSirasi = () => {
    const s = sonuc.satirlar.find((x) => stokAdayi(x) && x.cevap == null);
    if (!s) return ozetEkrani();
    sayimEkrani(s, malzemeBul.get(s.karar.malzeme_id));
  };

  const ozetEkrani = (hata = '') => {
    const stokta = sonuc.satirlar.filter((s) => stokAdayi(s) && s.cevap === 'evet');
    // Stok listesinde karşılığı olmayan satırlar (deterjan, peçete…) sessizce geçilir; burada gösterilmez.
    const bekleyen = sonuc.satirlar.filter((s) => s.karar.sinif === 'kurulum');
    const toplamVar = sonuc.toplamlar.genel != null;
    const kontrol = toplamVar ? toplamKontrol(sonuc) : { tutuyor: false, sebep: 'toplam_yok' };
    const tutmuyor = toplamVar && !kontrol.tutuyor;
    const kalem = (s) => {
      const m = malzemeBul.get(s.karar.malzeme_id);
      const c = Number(s.karar.carpan);
      const gelen = s.sayim === 'sayildi' ? Number(s.gelen_miktar) : Number(s.miktar);
      const farkli = s.sayim === 'sayildi' && ['teslimat_farki', 'belirsiz'].includes(s.teslimat);
      const fark = farkli ? (Number(s.miktar) - gelen) * c : 0;
      return `<li class="kabul-kalem ${farkli ? 'farkli' : ''}">
          <span class="kalem-ikon" aria-hidden="true">${malzemeIkonu(m)}</span>
          <span class="kalem-metin"><b>${buyukMiktar(gelen * c, m.birim)}</b> ${esc(m.ad)}
            ${s.sayim === 'sayilmadi' ? '<small>Sayılmadı · faturadaki gibi alındı</small>' : ''}
            ${farkli ? `<small>Faturada ${buyukMiktar(Number(s.miktar) * c, m.birim)} · ${buyukMiktar(Math.abs(fark), m.birim)}
              ${fark > 0 ? 'eksik' : 'fazla'} geldi, patrona iletilecek</small>` : ''}</span>
          <span class="kalem-durum" aria-hidden="true">${tutmuyor && s.sayim !== 'sayildi' ? '⏳' : farkli ? '⚠️' : '✓'}</span></li>`;
    };
    kutu.innerHTML = `<div class="sade-ekran">
        <h2>📦 ${esc(sonuc.tedarikci ?? 'Fatura')}</h2>
        ${tutmuyor ? `<div class="sade-uyari">⚠️ Toplam tutmuyor, faturaya tekrar bak.
            <button class="dev ikincil" id="tekrar-cek">📷 Tekrar çek</button></div>` : ''}
        <ul class="kabul-liste">${stokta.map(kalem).join('')}</ul>
        ${bekleyen.length ? `<p class="buyuk-yazi">⏳ ${bekleyen.length} kalem sonra kontrol edilecek</p>` : ''}
        ${toplamVar ? '' : `<p class="buyuk-yazi">Faturanın en altındaki toplam?</p>${rakamKutusu('TL')}`}
        <p class="mesaj ${hata ? 'hata' : ''}">${esc(hata)}</p>
        <button class="dev" id="kaydet">Kaydet ✓</button>
        <button class="metin-dugme" id="vazgec">Vazgeç</button></div>`;
    kutu.querySelector('#tekrar-cek')?.addEventListener('click', bastanCek);
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

  // Karekod ve ikinci okumanın izi (belgenin okunan bilgisine ve işlem geçmişine yazılır).
  const karekodKontrolu = () => {
    const k = kk?.karekod;
    const kar = k ? karekodlaKarsilastir(k, sonuc) : null;
    return {
      bulundu: Boolean(k), tur: k?.tur ?? null, ettn: k?.ettn ?? null, no: k?.no ?? null,
      tutuyor: kar?.tutuyor ?? null, celiskiler: kar?.celiskiler ?? [], okunan_kimlik: sonuc.okunan_kimlik ?? null,
      ikinci_okuma: ikinciDenendi ? { model: IKINCI_MODEL, basarili: Boolean(ikinci), kullanildi: kullanilan === 'ikinci',
        ilk_model: ilkOkuma?.model ?? null, ilk_genel: ilkOkuma?.toplamlar?.genel ?? null } : null,
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
        const evet = stokAdayi(s) && s.cevap === 'evet';
        return {
          metin: s.metin, miktar: s.miktar, birim: s.birim, birim_fiyat: s.birim_fiyat ?? null,
          tutar_haric: s.tutar_haric ?? null, kdv_orani: s.kdv_orani ?? null, tutar_dahil: s.tutar_dahil ?? null,
          sinif: evet ? 'eslesti' : ['takip_disi', 'kurulum'].includes(s.karar.sinif) ? s.karar.sinif : 'belirsiz',
          carpan_sayimdan: evet && s.karar.stokBirimi === true,
          malzeme_id: evet ? s.karar.malzeme_id : null, carpan: evet ? s.karar.carpan : null,
          barista_onayi: evet && s.karar.sinif === 'soru',
          aday_malzeme_id: s.karar.aday_malzeme_id ?? null,
          gelen_miktar: evet && s.sayim === 'sayildi' ? s.gelen_miktar : null,
          sayim: evet ? s.sayim ?? null : null, teslimat: evet ? s.teslimat ?? null : null,
          okunan_miktar: s.okunan_miktar ?? null, barista_notu: s.barista_notu || null,
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
                  toplamlar: sonuc.toplamlar, satirlar: sonuc.satirlar, karekod_kontrol: karekodKontrolu(),
                  ham_metin: sonuc.ham_metin ?? null },
        satirlar,
      } });
      olcum.kayit_ms = ms(tk, performance.now());
      temizle();
      const farkVar = satirlar.some((x) => ['teslimat_farki', 'belirsiz'].includes(x.teslimat));
      kaydedildi(kutu, {
        baslik: 'Kaydedildi',
        alt: r.durum !== 'tamam' ? 'Bazı kalemler sonra kontrol edilecek.'
          : farkVar ? 'Stoğa sayılan kadar eklendi. Fark patrona iletildi.' : 'Stoğa eklendi.',
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
    // Bağlamadan önce stoğa girecek miktar ve birim fiyat görünür: "24 ml · 14.500 ₺/litre" gibi yanlış çarpan göze batar.
    const onizleme = () => {
      const m = malzemeler.find((x) => x.id === sec.value);
      const f = Object.fromEntries(new FormData(form));
      const [carpan, miktar, tutar] = [f.carpan, f.miktar, f.tutar].map((v) => sayiOku(String(v ?? '')));
      const kutu = form.querySelector('.onizleme');
      if (!m || !(carpan > 0) || !(miktar > 0)) { kutu.textContent = ''; return; }
      const stok = miktar * carpan;
      const b = BIRIMLER[m.birim];
      kutu.textContent = `Stoğa girecek: ${buyukMiktar(stok, m.birim)}`
        + (tutar >= 0 ? ` · birim fiyat ${tl.format((tutar / stok) * b.bolen)}/${b.fiyatBirimi} (KDV dahil)` : ' · fiyat kontrol bekleyecek');
    };
    const birimYaz = () => {
      const m = malzemeler.find((x) => x.id === sec.value);
      etiket.textContent = m ? m.birim : '';
      if (m && !carpanInp.dataset.elle) carpanInp.value = carpanBul(form.dataset.birim, m.birim, form.dataset.metin) ?? '';
      onizleme();
    };
    carpanInp.addEventListener('input', () => { carpanInp.dataset.elle = '1'; });
    form.addEventListener('input', onizleme);
    sec.addEventListener('change', birimYaz);
    if (!carpanInp.value) birimYaz(); else { etiket.textContent = malzemeler.find((x) => x.id === sec.value)?.birim ?? ''; onizleme(); }
    const gonder = async (sonucTur) => {
      const f = Object.fromEntries(new FormData(form));
      const sayi = (v) => (String(v ?? '').trim() ? sayiOku(v) : null);
      try {
        if (sonucTur === 'malzeme' && !f.malzeme) throw new Error('Malzeme seç.');
        if (sonucTur === 'malzeme') {
          await rpcVeri('kurulum_satir_bagla', {
            p_satir: Number(form.dataset.satir), p_malzeme: f.malzeme, p_carpan: sayi(f.carpan), p_miktar: sayi(f.miktar),
            p_tutar_dahil: sayi(f.tutar), p_deftere_yaz: f.defter === 'on', p_onay: f.onay === 'on',
          });
        } else {
          await rpcVeri('kurulum_satir_coz', {
            p_satir: Number(form.dataset.satir), p_sonuc: sonucTur, p_malzeme: null, p_carpan: null, p_miktar: null,
            p_tutar_haric: null, p_kdv_orani: null, p_deftere_yaz: f.defter === 'on', p_onay: false,
          });
        }
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
  belgeIslem('[data-rapor-tamam]', 'kurulum_satis_raporu_tamam',
    'Satışlar patron tarafından Girişler → Satış gir ile girildi mi? Rapor yalnız işlendi olarak işaretlenir, stoğa ayrıca bir şey eklenmez.');

  // Satış raporu → satış girişi
  kutu.querySelectorAll('form[data-rapor]').forEach((form) => {
    // CSV/XLSX cihazda okunur; kurulum sonucu kontrol ederek mevcut güvenli RPC ile kaydeder.
    const sources = JSON.parse(form.dataset.satisDosyalar || '[]');
    const products = JSON.parse(form.dataset.satisUrunler || '[]');
    const source = sources.find(d => /\.(csv|xlsx|tsv|txt)$/i.test(d.yol));
    if (source) {
      const save = form.querySelector('[data-rapor-kaydet]');
      const message = form.querySelector('[data-satis-okuma]');
      save.disabled = true; message.textContent = 'Rapor okunuyor…';
      (async () => {
        try {
          const { data, error } = await sb.storage.from(BELGE_KOVASI).download(source.yol);
          if (error) throw error;
          const result = await readSalesFile(new File([data], source.yol.split('/').pop()), products);
          for (const item of result.matched) {
            const input = [...form.querySelectorAll('[data-urun]')].find(i => i.dataset.urun === item.urun_id);
            if (input) input.value = item.miktar;
          }
          form.querySelector('[data-satis-eslesmeyen]').innerHTML = result.unmatched.map(row =>
            '<label class="uyari">' + esc(row.name) + ' · ' + row.quantity + ' adet<select data-satis-coz="' + row.quantity + '"><option value="">Ürün seç</option><option value="-">Tarifi yok, stoktan düşme</option>' + products.map(p => '<option value="' + esc(p.id) + '">' + esc(p.ad) + '</option>').join('') + '</select></label>').join('');
          message.textContent = result.unmatched.length ? 'Eşleşmeyen ürünleri seç; tarifi olmayanlar (şişe su, kek…) için "Tarifi yok" de. İkramlar adetlere dahil.' : 'Adetler okundu. Kontrol edip kaydet. İkramlar dahil.';
        } catch (err) { message.textContent = 'Otomatik okunamadı: ' + hataMetni(err) + ' Belgeyi açıp adetleri elle yaz.'; }
        finally { save.disabled = false; }
      })();
    }

    form.querySelector('[data-rapor-kaydet]').onclick = async (e) => {
      try {
        const kalemler = [];
        for (const inp of form.querySelectorAll('[data-urun]')) {
          if (!inp.value.trim()) continue;
          const n = sayiOku(inp.value);
          if (!Number.isInteger(n) || n < 0 || n > 100000) throw new Error('Adetleri tam sayı olarak yaz.');
          if (n > 0) kalemler.push({ urun_id: inp.dataset.urun, miktar: n });
        }
        for (const select of form.querySelectorAll('[data-satis-coz]')) {
          if (!select.value) throw new Error('Eşleşmeyen her satır için ürün seç ya da "Tarifi yok" de.');
          if (select.value === '-') continue;   // tarifi olmayan ürün (şişe su, kek…): malzeme tüketmez
          const amount = Number(select.dataset.satisCoz);
          const existing = kalemler.find(k => k.urun_id === select.value);
          if (existing) existing.miktar += amount; else kalemler.push({ urun_id: select.value, miktar: amount });
        }
        if (kalemler.some(k => k.miktar > 100000)) throw new Error('Bir ürünün toplam adedi 100000 sınırını aşıyor.');
        if (!kalemler.length) throw new Error('En az bir ürünün adedini yaz.');
        const tarih = form.querySelector('[name=tarih]').value;
        const toplam = kalemler.reduce((t, k) => t + k.miktar, 0);
        if (!confirm(`${tarihYaz(tarih)} için ${kalemler.length} ürün, toplam ${toplam} adet satış kaydedilsin mi?`)) return;
        e.target.disabled = true;
        await rpcVeri('kurulum_satis_raporu_isle', { p_belge: form.dataset.rapor, p_tarih: tarih, p_kalemler: kalemler });
        yenile();
      } catch (err) { hataGoster(err); e.target.disabled = false; }
    };
  });
}

function belgeKarti(k, b) {
  const dosyaDugmesi = b.dosyalar.length
    ? `<button class="ikincil kucuk" data-belge-ac='${esc(JSON.stringify(b.dosyalar.map((d) => d.yol)))}'>📄 Belgeyi aç (${b.dosyalar.length})</button>` : '';
  if (b.tur === 'satis_raporu') {
    const bugun = bugunStr();
    return `<form class="kart" data-rapor="${esc(b.id)}" data-satis-dosyalar="${esc(JSON.stringify(b.dosyalar))}" data-satis-urunler="${esc(JSON.stringify(k.urunler))}" onsubmit="return false">
      <b>💰 Satış raporu</b> · ${esc(k.mekan)} · ${esc(b.giren_ad)} · ${zamanYaz(b.olusturma)}<br>${dosyaDugmesi}
      <p class="bilgi" data-satis-okuma></p><div data-satis-eslesmeyen></div>
      <p class="bilgi">Rapordaki adetleri yaz (ikram / 0 TL satırlar dahil; malzeme yine harcandı). Satılmayanı boş bırak.
        Tarih: raporun kapsadığı son gün (genelde sayım günü). Kaydedince satışlar tarifle stoktan düşer.</p>
      <label>Tarih<input type="date" name="tarih" value="${gunu(b.olusturma)}" max="${bugun}" required></label>
      ${k.urunler.length ? k.urunler.map((u) => `<div class="liste-satir">
          <label for="r-${esc(b.id)}-${esc(u.id)}">${esc(u.ad)}</label>
          <input id="r-${esc(b.id)}-${esc(u.id)}" data-urun="${esc(u.id)}" inputmode="numeric" autocomplete="off" placeholder="—">
          <span class="birim">adet</span></div>`).join('')
        : '<p class="uyari">Bu mekanda ürün (tarif) yok; satışlar stoğa çevrilemez.</p>'}
      <div class="dugmeler"><button class="kucuk" type="button" data-rapor-kaydet>Satışları kaydet ✓</button>
        <button class="ikincil kucuk" type="button" data-rapor-tamam data-id="${esc(b.id)}">Patron girdi, yalnız işaretle</button></div>
    </form>`;
  }
  const satirToplam = b.satirlar.reduce((t, s) => t + Number(s.tutar_dahil ?? 0), 0);
  const bekleyen = b.satirlar.filter((s) => s.durum === 'bekliyor');
  const eslesmeBekleyen = bekleyen.filter((s) => s.sebep === 'eslesme');
  const malzemelerJson = esc(JSON.stringify(k.malzemeler));
  return `<div class="kart kurulum-belge">
    <b>📦 ${esc(b.tedarikci ?? 'Tedarikçi okunamadı')}</b> · ${b.tarih ? tarihYaz(b.tarih) : 'tarih yok'}
      ${b.fatura_no ? ` · ${esc(b.fatura_no)}` : ''} · ${esc(b.kaynak.toUpperCase())}
    <small class="bilgi">${esc(b.giren_ad)} · ${zamanYaz(b.olusturma)}</small>
    <p class="${b.toplam_tutuyor ? 'tamam' : 'hata'}">Genel toplam ${b.genel_toplam != null ? tl.format(b.genel_toplam) : '?'} ·
      satırlar ${tl.format(satirToplam)}${Number(b.indirim) ? ` · indirim ${tl.format(b.indirim)}` : ''}
      ${b.toplam_tutuyor ? '✓' : '✗ toplam tutmuyor, fotoğrafı kontrol et'}</p>
    ${dosyaDugmesi}
    ${b.satirlar.map((s) => s.durum !== 'bekliyor'
      ? `<div class="kurulum-satir cozuldu">${s.durum === 'stokta' ? '✓' : '—'} ${esc(s.metin)}
          <small>${s.miktar ?? '?'} ${BELGE_BIRIM[s.birim] ?? ''} · ${s.tutar_dahil != null ? tl.format(s.tutar_dahil) : 'tutar yok'}
          ${s.durum === 'takip_disi' ? ' · takip dışı' : ''}</small></div>`
      : `<form class="kurulum-satir" data-satir="${s.id}" data-birim="${esc(s.birim ?? 'diger')}" data-metin="${esc(s.metin)}"
            data-malzemeler="${malzemelerJson}" onsubmit="return false">
          <b>${esc(s.metin)}</b> <span class="rozet">${esc(BEKLEME_SEBEPLERI[s.sebep] ?? s.sebep)}</span>
          <div class="kurulum-alanlar">
            <label>Malzeme<select name="malzeme"><option value="">Seç</option>${k.malzemeler.map((m) =>
              `<option value="${esc(m.id)}" ${(s.malzeme_id ?? s.aday_malzeme_id) === m.id ? 'selected' : ''}>${esc(m.ad)}</option>`).join('')}</select></label>
            <label>1 ${BELGE_BIRIM[s.birim] ?? 'birim'} = <span class="yan"><input name="carpan" inputmode="decimal" value="${s.carpan ?? ''}"><span class="carpan-birim"></span></span></label>
            <label>Miktar (${BELGE_BIRIM[s.birim] ?? '?'})<input name="miktar" inputmode="decimal" value="${s.miktar ?? ''}"></label>
            <label>Tutar (KDV dahil, boşsa fiyat kontrol bekler)<input name="tutar" inputmode="decimal" value="${s.tutar_dahil ?? ''}"></label>
          </div>
          <p class="bilgi onizleme"></p>
          <label class="onay-kutu"><input type="checkbox" name="defter" ${['eslesme', 'donusum'].includes(s.sebep) ? 'checked' : ''}>
            Deftere yaz (sonraki faturalarda otomatik)</label>
          <label class="onay-kutu"><input type="checkbox" name="onay">
            Fiyat/miktar doğru (kayıtlı fiyattan çok farklıysa faturaya bakıp işaretle)</label>
          <div class="dugmeler"><button class="kucuk" type="button" data-bagla>Bağla ✓</button>
            <button class="ikincil kucuk" type="button" data-disi>Takip dışı</button></div>
        </form>`).join('')}
    <div class="dugmeler belge-dugmeleri">
      ${eslesmeBekleyen.length ? `<button class="ikincil kucuk" data-kalanlar data-id="${esc(b.id)}">Kalanların hepsi takip dışı (${eslesmeBekleyen.length})</button>` : ''}
      ${!b.toplam_tutuyor ? `<button class="kucuk" data-onayla data-id="${esc(b.id)}">Rakamlar doğru, onayla</button>` : ''}
      <button class="ikincil kucuk" data-reddet data-id="${esc(b.id)}">Belgeyi reddet</button>
    </div></div>`;
}

// Üyelik bilgisi oturum boyunca bir kez alınır: her sekme geçişinde iki sorgu daha az (sekmeler hızlı açılır).
// Çıkışta ve davet kodu yenilenince sıfırlanır; mekana bağlı değilken (katılma/oluşturma ekranı) tutulmaz.
let uyeOnbellek = null;   // { userId, ur, kurulumcu }

// Giriş durumuna göre doğru ekranı açar.
async function goster() {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { uyeOnbellek = null; return girisEkrani(); }
    ustSag.innerHTML = '<button class="kucuk">Çıkış</button>';
    ustSag.querySelector('button').onclick = cikis;
    let ur;
    if (uyeOnbellek?.userId === session.user.id) {
      ({ ur } = uyeOnbellek);
      kurulumcu = uyeOnbellek.kurulumcu;
    } else {
      const [u, kr] = await Promise.all([
        sb.from('uyeler').select('rol, ad, mekan_id, mekanlar(ad, davet_kodu)')
          .eq('user_id', session.user.id).maybeSingle(),
        sb.rpc('kurulumcu_muyum'),
      ]);
      if (u.error) throw u.error;
      ur = u;
      kurulumcu = kr.data === true;
      uyeOnbellek = ur.data ? { userId: session.user.id, ur, kurulumcu } : null;
    }
    document.body.classList.toggle('sade', ur.data?.rol === 'barista');
    document.body.classList.toggle('patron', ur.data?.rol === 'patron');
    if (!ur.data) return kurulumcu ? kurulumEkrani(app) : mekanSecEkrani(session.user);
    await anaEkran(session.user, ur.data);
  } catch (err) {
    app.innerHTML = `<div class="kart"><p class="hata">${esc(hataMetni(err))}</p>
      <button class="tam" id="tekrar">Tekrar dene</button></div>`;
    app.querySelector('#tekrar').onclick = goster;
  }
}

goster();
