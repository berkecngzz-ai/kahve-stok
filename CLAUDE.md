# Kahve Stok — Claude çalışma notları

## Çalışma kuralları
- Oturum başında PROGRESS.md'yi oku, "Sıradaki adım"dan devam et.
- Görev bitince sormadan PROGRESS.md'yi güncelle. Kısa tut: güncel durum, önemli kararlar ve nedenleri, açık sorunlar, sıradaki adım. Sohbet dökümüne dönüşmesin; eski ve artık geçerli olmayan bilgiyi sil ya da tek satırda özetle.
- Tamamlanan tutarlı değişiklikleri commit et; yalnız kendi değişikliklerini dahil et, secrets ve geçici dosyaları dışarıda bırak.
- PROGRESS.md kaydedilip commit edildikten sonra mesajın sonuna "✅ Clear yapabilirsin" yaz.
- Ön yüz dosyası (js/css/index.html) değişince commit'ten önce `node scripts/surum.mjs` çalıştır (telefon önbelleği; npm test unutulursa hata verir).
- "Bitti" demeden önce test et. Test edilmeyen kısmı açıkça belirt.

## Verimlilik
- Önce ara, sonra yalnızca ilgili kısmı oku. Dosyanın tamamını gerekmedikçe okuma.
- Uzun komut çıktılarını bağlama dökme; sadece sonucu ve hataları özetle.
- Aynı dosyayı tekrar tekrar okuma.
- Sohbete kod yapıştırma; değişikliği dosyada yap, ne değiştiğini bir cümleyle söyle.

## Benim yapacağım işler
- Supabase, GitHub ve kurulum işlerini CLI ile sen yap. Bana sadece senin yapamayacağın şeyleri (giriş, onay, fiziksel dosya) bırak.
- Benden bir şey isteyeceksen sade Türkçeyle, numaralı adımlarla yaz. Teknik terimi açıkla.
- Bir seferde tek bir şey iste.

## Güvenlik
- Veri ya da tablo silen, geri alınamayan her işlemden önce sor.
- Anahtar, şifre, token'ı asla sohbete, koda ya da commit'e yazma; sadece secrets/ortam değişkeni.
- Her yeni tablo AYNI SQL dosyasında şunlarla gelir: `enable row level security`, politikaları ve rollere açık
  `grant`'ler (anon / authenticated için gereken en az yetki; gerekmeyen `revoke all`). Edge function gibi
  service_role ile erişilecekse o da açıkça `grant ... to service_role` yazılır. Supabase'in varsayılan yetkilerine
  güvenilmez (30 Ekim 2026'dan sonra yeni tablolara varsayılan yetki verilmiyor).
