# CoffeeStock

Kahve dükkanları için stok açığı takibi. Barista gelen malı, satışları, sayımı ve fireyi girer; patron haftalık açığı miktar ve TL olarak görür.

- Arayüz: sade HTML + JavaScript (derleme yok), GitHub Pages'ta yayınlanır.
- Veri: Supabase (Postgres + Auth + Storage). Her mekanın verisi Row Level Security ile ayrılır.

## Kurulum
1. Supabase SQL Editor'da `sql/` altındaki dosyaları sırayla çalıştır.
2. `config.js` içine Project URL ve publishable (anon) anahtarı yaz.

## Adımlar
- **Adım 1** (`sql/01_giris_mekan.sql`): giriş, mekan oluşturma, davet kodu, mekan izolasyonu.
- **Adım 2** (`sql/02_malzeme_tarif.sql`): malzemeler (birim + kg/litre/adet fiyatı) ve ürün tarifleri.
  Yalnızca patron ekler/değiştirir; barista görür. Silme yok, pasife alma var. Malzeme birimi sonradan değişmez.
- **Adım 3** (`sql/03_girisler.sql`): fatura, gün sonu satış, fire ve sayım girişleri + fiyat geçmişi.
  Patron ve barista girer. Kayıt silinmez, iptal edilir (kim/ne zaman saklanır); barista yalnızca kendi
  girdiğini aynı gün iptal edebilir. Satış/fire malzemeye giriş anındaki tarifle çevrilip sabitlenir.
  Faturadaki fiyat malzemenin güncel fiyatını günceller (eski tarihli fatura güncel fiyatı ezmez);
  her fiyat değişikliği `fiyat_gecmisi`nde kalır. Geçmiş girişler ay seçilerek görülür.

- **Adım 4 / Parça 1** (`sql/04_fatura_belge_kdv.sql`): KDV'li fatura, fatura belgeleri ve kontroller.
  Her fatura satırında KDV hariç tutar + KDV oranı ayrı saklanır (KDV dahil tutar hesaplanır); malzeme fiyatı ve
  fiyat geçmişi de öyle. Eski kayıtlar "KDV dahil, oran bilinmiyor" kalır. Mekan ayarı `kdv_gosterim`
  (varsayılan dahil) yalnız gösterimi değiştirir. Fotoğraf/PDF Supabase Storage'daki gizli `fatura-belgeleri`
  kovasında `<mekan_id>/…` klasöründe; her mekan yalnız kendi klasörüne yükler/görür, silme yok.
  `fatura_kaydet` toplamlar tutmazsa (satırlar − indirim ≠ genel toplam vb., pay 1 TL) kaydetmez.
  Stoğa eklenmeyen satırlar (deterjan vb.) toplamda sayılır, stoğa girmez. Fiyat (%30) ve miktar (3 kat)
  uyarıları barista onaylamadan geçilmez.

- **Adım 4 / Parça 2** (`sql/05_belge_okuma_kurulum.sql`, `okuma.js`, `eslestirme.js`, `vendor/`): sade barista
  ekranı (📦 Mal geldi · 🗑️ Fire var · 📋 Haftalık sayım + satış raporu), belge okuma ve kurulum kuyruğu.
  - Okuma tamamen tarayıcıda: e-fatura XML (UBL-TR), metinli PDF (pdf.js), taranmış PDF/fotoğraf (Tesseract, Türkçe).
    Kütüphaneler `vendor/` içinde kendi sitemizde; hiçbir belge dışarı gönderilmez.
  - Eşleştirme: defterdeki doğrulanmış kayıt → otomatik; bir malzemeye benzeyen yeni satır → baristaya
    "Bu ürün süt mü?"; **ilk kez görülen her satır kurulum kuyruğuna**. "Takip dışı" kararı yalnızca defterden gelir
    (veritabanı da kontrol eder). Toplam tutmazsa / fiyat ya da miktar olağandışıysa satır stoğa girmez, bekler.
  - Çift kayıt: aynı dosya (SHA-256), aynı ETTN ya da aynı tedarikçi + fatura no reddedilir; aynı tedarikçi + tarih +
    toplam için "aynı fatura mı?" sorulur. Her kayıt tek seferlik istek kimliğiyle gider (bağlantı kopup tekrar
    denenince ikinci stok girişi olmaz).
  - Fiyat gizliliği: fiyat sütunları, fiyat geçmişi, girişler/tutarlar, belgeler yalnız patrona açık
    (`malzeme_fiyatlari()`). Barista malzeme adlarını ve eşleştirme defterini görür.
  - Patron, eşleştirme bekleyen fatura/satış raporu varsa "sonuç eksik olabilir" uyarısını görür.
  - **Kurulum hesabı** (servis sahibi): uygulamada normal bir hesap aç (mekana katılma), sonra Supabase SQL
    Editor'da `insert into public.kurulum_hesaplari (user_id) select id from auth.users where email = '…';`
    Bu hesap tüm mekanların kuyruğunu görür; "Kalanların hepsi takip dışı" ile toplu işaretler.

- **Adım 5** (`sql/12_stok_duzeltmeleri.sql`): kurulumda bağlanan fatura satırı da fiyat (%30) / miktar (3 kat)
  kontrolünden geçer ("Fiyat/miktar doğru" onayıyla geçilir); giriş iptal edilince bağlı belge de iptal olur (aynı
  fatura yeniden yüklenebilir); satış raporu kurulumda ürün adetleriyle satış girişine çevrilir (aynı güne ikinci satış
  reddedilir); **stok farkı raporu** (`stok_farki`, yalnız patron): her malzeme için önceki sayım + fatura − satış
  (tarifle) − fire = olması gereken; sayılanla fark, güncel fiyatla TL. Sayım gün sonu kabul edilir.

- **Adım 6** (`sql/20_patron_ekranlari.sql`, `patron-hesap.js`): patron ekranları — Özet (son haftanın açığı, en çok açık
  veren 3 malzeme, bekleyen belge, haftalık grafik), Stok (şu an elde ne var: `stok_durumu()`), Rapor (malzeme başına gelen/
  kullanılan/fire/sayılan/açık, miktar ve TL; kırmızı = kayıp kullanılanın %3'ünden fazla ve 50 TL'den büyük; Excel indirme),
  Girişler (sade liste + süzgeç). Haftalık trend: `acik_trendi()`. Yalnız patron.

## Yerel demo (canlıya bağlanmaz)
`node scripts/demo/sunucu.mjs` → http://localhost:8787. Veritabanı PGlite; `sql/` + `scripts/demo/demo-veri.sql`
("Demo Kafe", 4 hafta, 3. haftada süt açığı) her açılışta sıfırdan kurulur. Hesaplar dosyanın başında (yalnız yerel).

## Okuma ve eşleştirme testleri
`npm install` sonra `npm test` (Node 20+).

## Yerel SQL testleri
Postgres kurmadan: `npm run test:sql` (PGlite — Node içinde gerçek Postgres; psql'in `gset` / `:'değişken'`
özellikleri `test/sql-calistir.mjs` ile taklit edilir). Sıra `test/sql-calistir.mjs` içindeki `ZINCIR`'de:
01 → 12 SQL dosyaları ve her adımın `test/*_test.sql` dosyası, tek veritabanında.
PGlite'ta pgcrypto yok: `gen_random_bytes` test için taklit edilir. 07/08 (okuma testi, pg_net) zincirde yok.
