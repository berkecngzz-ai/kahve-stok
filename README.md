# Kahve Stok

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

## Yerel izolasyon testi
Postgres 16 ile, boş bir veritabanında tek oturumda sırayla:
`test/supabase_taklit.sql`, `sql/01_giris_mekan.sql`, `sql/02_malzeme_tarif.sql`, `test/izolasyon_test.sql`,
`test/malzeme_tarif_test.sql`, `sql/03_girisler.sql`, `test/girisler_test.sql`,
`sql/04_fatura_belge_kdv.sql`, `test/fatura_kdv_test.sql`.
