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

## Tasarım kuralları
- Temel ilke: bir bilgi patronun kararını değiştirmiyorsa ana ekranda durmasın, detaya insin.
- Referans: Braun (az ama iyi, süs yok), IBM (veri disiplini), Apple (kolay kullanım).
- Her uyarı kaynağına bağlanır: dokunulunca neden çıktığını gösteren detay açılır.
- Renk sadece müdahale gerektiğinde: amber #B7791F dikkat, kırmızı #B42318 sorun.
  Normal durum renksizdir (nötr kart + ✓ ikonu). Yeşil kullanılmaz. Rakamlar nötr renkte.
  Açık tema: renkli öğede açık tonlu zemin + aynı rengin koyu yazısı.
  Koyu tema: aynı rengin koyu tonlu zemini + açık tonlu yazısı (açık kutu kullanma).
  Normal kartlar her iki temada nötr yüzeyde kalır.
  Zemin krem / koyu temada koyu nötr; marka kahvesi sadece üst barda. Gradyan, gölge, süs yok.
- Font: IBM Plex Sans. Serif yok. Rakamlar tabular (font-variant-numeric: tabular-nums), sağa hizalı.
- Boşluklar 8px ızgarası. Dokunma alanı en az 44px. Ekran başına tek ana eylem.
- Değeri yazmayan grafik yok.
- Dil: "kayıp" değil "stok farkı". Eksi işareti yok ("389 TL fark"). Teknik terim yok.
- Veri dürüstlüğü: eski veri eski olduğunu söyler; tahmin ≈ ile gösterilir; dayanağı olmayan
  tahmin gösterilmez. "Geçen hafta" sadece gerçekten geçen haftaysa kullanılır.
- Her ekran değişikliğinde 390px genişlikte, açık ve koyu temada ekran görüntüsü al,
  önce bana göster, onayımdan sonra canlıya al.

## Güvenlik
- Veri ya da tablo silen, geri alınamayan her işlemden önce sor.
- Anahtar, şifre, token'ı asla sohbete, koda ya da commit'e yazma; sadece secrets/ortam değişkeni.
- Her yeni tablo AYNI SQL dosyasında şunlarla gelir: `enable row level security`, politikaları ve rollere açık
  `grant`'ler (anon / authenticated için gereken en az yetki; gerekmeyen `revoke all`). Edge function gibi
  service_role ile erişilecekse o da açıkça `grant ... to service_role` yazılır. Supabase'in varsayılan yetkilerine
  güvenilmez (30 Ekim 2026'dan sonra yeni tablolara varsayılan yetki verilmiyor).
