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

## Yerel izolasyon testi
Postgres 16 ile, boş bir veritabanında tek oturumda sırayla:
`test/supabase_taklit.sql`, `sql/*.sql`, `test/izolasyon_test.sql`, `test/malzeme_tarif_test.sql`.
