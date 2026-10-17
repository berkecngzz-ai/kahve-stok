# Kahve Stok

Kahve dükkanları için stok açığı takibi. Barista gelen malı, satışları, sayımı ve fireyi girer; patron haftalık açığı miktar ve TL olarak görür.

- Arayüz: sade HTML + JavaScript (derleme yok), GitHub Pages'ta yayınlanır.
- Veri: Supabase (Postgres + Auth + Storage). Her mekanın verisi Row Level Security ile ayrılır.

## Kurulum
1. Supabase SQL Editor'da `sql/` altındaki dosyaları sırayla çalıştır.
2. `config.js` içine Project URL ve publishable (anon) anahtarı yaz.

## Yerel izolasyon testi
Postgres 16 ile: `test/supabase_taklit.sql`, `sql/*.sql`, `test/izolasyon_test.sql` dosyalarını boş bir veritabanında sırayla çalıştır.
