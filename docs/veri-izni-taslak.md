# Verilerin kullanımı — taslak

Bu metin yayımlanmadan önce köşeli parantezli alanlar doldurulmalı. Henüz uygulamada gösterilmez ve tek başına izin alındığı anlamına gelmez.

## Kullanıcıya gösterilecek metin

CoffeeStock, işletmenizin malzemelerini, tariflerini, faturalarını, satış adetlerini, fire ve sayım kayıtlarını stok takibi yapmak için işler. Hesap bilgileriniz de giriş ve yetkilendirme için kullanılır.

**Veriler nerede durur?**
Kayıtlar Supabase veritabanında, yüklediğiniz belgeler Supabase'in özel dosya alanında saklanır. Başka işletmelerin bu kayıtlara erişimini engelleyen yetki kontrolleri vardır. Sunucu ülkesi ve bölgesi: [SUNUCU BÖLGESİ].

**Fatura fotoğrafları nasıl okunur?**
Fotoğraflar ve taranmış belgelerin görüntüleri, içindeki yazıların okunması için OpenAI'a gönderilebilir. Görüntüde bulunan ad, adres ve vergi bilgileri de bu görüntünün parçasıdır. Eşleştirme için işletmenin takip ettiği malzemelerin adları, kimlikleri ve birimleri de gönderilir. Metinli PDF ve e-fatura XML dosyaları cihazda okunabilir. Bu belgelerin uygulamada saklanması ayrıdır.

**Kurulum ekibi ne görür?**
Ürünleri kurmak ve eşleşmeyen satırları düzeltmek için ürün ve malzeme adlarını, ilgili belgeyi ve satırlarını görebiliriz. Erişim, kurulum ve destek amacıyla kullanılır.

**Veriler nasıl silinir?**
Silme talebi için [SİLME TALEBİ İLETİŞİMİ] üzerinden bize ulaşabilirsiniz. İşletme yetkiniz doğrulandıktan sonra hangi hesapların, kayıtların ve belgelerin silineceği bildirilir. Talebin nasıl ve ne sürede tamamlanacağı: [SİLME SÜRESİ VE İŞLEYİŞİ]. Yedeklerin silinme takvimi: [YEDEK SAKLAMA SÜRESİ]. Uygulamada bir kaydı iptal etmek veya ürünü pasife almak, veriyi kalıcı olarak silmez.

Veri sorumlusu ve iletişim: [SORUMLU UNVANI VE İLETİŞİMİ]. Genel saklama süresi: [KAYIT SAKLAMA SÜRESİ]. OpenAI tarafındaki işleme bölgesi ve saklama koşulları: [OPENAI HESAP AYARLARIYLA DOĞRULANACAK BİLGİ].

## Fotoğrafla okuma için kısa ekran taslağı

Faturanı okumak için görüntüyü ve malzeme adlarını OpenAI'a göndereceğiz. Görüntüdeki kişisel bilgiler de gönderilebilir.

Düğmeler: **Devam et** · **Vazgeç**
Bağlantı: **Verilerim nasıl kullanılır?**

## Yayımlamadan önce tamamlanacaklar

- Supabase bölgesini ve mevcut yedek/saklama ayarlarını doğrula.
- Veri sorumlusu unvanı, iletişim, silme talebi adresi ve gerçek silme sürecini belirle. Kodda kullanıcıya açık kalıcı silme akışı görülmedi; mevcut olmayan otomatik silme özelliği vaat etme.
- OpenAI hesap koşullarını, saklama ve bölge ayarlarını doğrula; eğitimde kullanım veya sıfır saklama hakkında doğrulanmamış söz verme.
- Aydınlatma, gerekiyorsa açık rıza ve aktarım gerekliliklerini ayrıca değerlendir. Bu metin bir taslaktır; uygunluk incelemesi yerine geçmez.
- Kısa ekrandaki seçim henüz kodlanmadı. Önceden işaretli kutu veya otomatik onay kullanma; vazgeçince görseli gönderme. İzin kaydı ve geri çekme sürecini uygulamadan önce tasarla.

Kaynak kontrolü: README.md (Supabase kayıt/dosya alanı), sql/05_belge_okuma_kurulum.sql ve sql/12_stok_duzeltmeleri.sql (kurulum erişimi), supabase/functions/fatura-oku/index.ts (görüntüler + id/ad/birim gönderimi). Canlı ayarlar incelenmedi, hiçbir veri gönderilmedi.
