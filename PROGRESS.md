# İlerleme notları

## Fatura okuma (AI) — durum 2026-10-20

- **Model:** `gpt-4.1-mini` (uygulamanın varsayılanı). `gpt-4.1-nano` yalnızca testlerde karşılaştırma için seçilebilir.
- **Okuma yolu:** e-fatura XML ve metinli PDF → AI'sız, telefonda. Fotoğraf ve taranmış PDF → `fatura-oku` işlevi (OpenAI);
  olmazsa telefondaki OCR; o da olmazsa belge kurulum kuyruğuna.
- **Ölçülen (2026-10-20, 4 görüntü):** AI okuması 4,0–5,1 sn (mini), fatura başı ≈ 0,0015–0,0024 $.
  Fotoğraf çekildikten sonra tahmini toplam 5,5–7 sn (telefonda uçtan uca henüz ölçülmedi).

### ⚠️ Doğruluk sonucu hakkında önemli not

**mini'nin 15/15 sonucu sentetik görüntüler ve aynı test setinde yapılan düzeltmelerle alındı; gerçek doğruluk,
gerçek ve daha önce görülmemiş fatura fotoğraflarıyla ölçülecek.**

Ayrıntı:
- Test setindeki 4 görüntünün ikisi (01, 02) PDF sayfalarından üretilmiş temiz görüntüler; ikisi (03 toptancı, 04 market fişi)
  cevap anahtarından üretilmiş **sentetik** "telefon fotoğrafı" (eğiklik, gölge, gürültü eklendi). Gerçek fotoğraflardan temizdir.
- İlk ölçüm mini için 14/15 idi. Aynı setin sonuçlarına bakılarak üç düzeltme yapıldı (fiş önekindeki "x 41,00"in paket sanılması,
  AI'nın "KDV dahil" etiketinin hesapla çelişmesi, "emin değilim" + kuralla doğrulanan miktarın soruya çevrilmesi) ve
  aynı sonuçlar yeniden puanlandı → 15/15. Yani düzeltmeler bu sete göre yapıldı; set artık bağımsız bir ölçüt değildir.
- nano: 3/15 doğru, 0 yanlış, 12 kuyruk (yanlış eşleştirmeleri kontroller yakaladı).

### Okuma testi nasıl çalıştırılır

Gerçek ve **daha önce görülmemiş** fatura fotoğrafları (+ cevap anahtarı) `Desktop\test-faturalar`'a konup tek komutla:

```bash
bash scripts/okuma-testi.sh "$HOME/OneDrive/Desktop/test-faturalar" gpt-4.1-mini
```

Betik test yolunu açar, fotoğrafları yükler, okutur, `00_CEVAP_ANAHTARI.md` ile karşılaştırıp rapor basar,
test görüntülerini siler ve test yolunu yine kapatır. Test yolu normalde **kapalı**dır
(`select public.okuma_testi_ac(true|false);`, bkz. `sql/08_okuma_testi_anahtari.sql`).

## Açık işler
- Telefonda uçtan uca okuma süresi ölçülmedi.
- Satış raporu okuma (şimdilik saklanıyor, kurulum kuyruğuna gidiyor; ikram/0 TL satırlar da tüketim sayılmalı).
- Açık raporu (Adım 4 ana raporu) ve rapordaki "eksik veri" uyarısı.

## Fatura okuma V2 testi (test-faturalar-v2) — 2026-10-21

- **Temel (2026-10-20, Codex, kod değişmeden):** tümü 18/42; Set A 5/18; Set B 13/24 (foto %55,6); PDF/XML 4/10; **kritik 4** (hepsi B).
- **Düzeltmeler (yalnız Set A'ya bakılarak, genel kural):** AI talimatı (fiş çarpan satırı alttaki ürüne ait; toplam yalnız
  yazıyorsa; ürün türü birebir aynı olmalı; belge türü / eksik görünürlük); paket-koli birimi addaki "N'li" ile çevrilir;
  türev ürün koruması (krema, bitkisel/aromalı süt, kapak… — Türkçe tamlama ve -lı yapısı); AI eşleşmesinde baş isim/kısaltma
  şartı ("KRML SOS" ≠ şurup); AI "takip dışı" dese de malzeme adını taşıyan satır kuyruğa; KDV yazmayan fişte %0; KDV hariç
  iskonto dahil karşılığına çevrilir; eksik görünen belgede AI toplamı kullanılmaz; fatura değil / karışık fiş satırı → hepsi
  kuruluma; kural yolunda yarım eşleşme soru olmaz; ünsüz yumuşaması (şurup/şurubu). SQL 09: miktar "3 kat" kuralı yalnız
  fiyatla doğrulanamayan satırda. Edge function ve SQL 09 Supabase'e yüklendi; ön yüz değişiklikleri commit edildi, **push edilmedi**.
- **1. son ölçüm (v2 B dahil, bir kez):** tümü 17/42; Set A 11/18; Set B 6/24 (B'de kritik 0); PDF/XML 5/10; **kritik 1 (T03):**
  AI fişte "2 X 129,00" çarpanını atladı (1×258 tutarlı) → 50 bardak girdi, 100 olmalıydı. v2 Set B artık kullanılmış sayılır.
- **2. tur (kullanıcı kararı "b"):** (a) **İlk kez görülen malzeme** (bu mekânda defterde hiç doğrulanmamış) fotoğraftan
  gelirse barista evet/hayır yerine **"Kaç paket geldi? (1 paket = 50 adet)"** sayar; sistem çarpar; okunandan farklıysa
  sayılan esas alınır (birim fiyat tutardan yeniden çıkar). "Sonra" / "bu ürün X değil" → kurulum. XML/PDF'te sorulmaz (miktar kesin).
  (b) **SQL 10 — kök neden bulundu:** malzeme oluşturulurken bugün tarihli "elle 0 TL" fiyat kaydı açılıyor; güncel fiyat en yeni
  tarihli kayıt olduğundan eski tarihli faturalar fiyatı hiç güncelleyemiyordu → fiyat kontrolü çalışmıyor, doğru süt satırları
  "3 kat" kuralıyla kuyruğa düşüyordu. Artık 0 TL kayıt gerçek fiyatın önüne geçmiyor. (c) gpt-4.1 izinli modellere eklendi
  (varsayılan mini). Edge function + SQL 10 Supabase'e yüklendi.
- **Model karşılaştırması (Set A, aynı kod):** mini foto 9/14, ~0,0029 $/fatura; gpt-4.1 foto 6/14, ~0,0096 $/fatura; ikisinde
  kritik 0. gpt-4.1 belirgin önde olmadığından **varsayılan mini kaldı** (1 TL sınırının altında olsa da şart "belirgin önde").
- **Yeni B seti (B2):** `Desktop\test-faturalar-v2-B2` — 10 belge (8 foto, 1 iki sayfalı PDF, 1 XML) + cevap_anahtari.json.
  Kod dondurulduktan sonra ve bu oturumda üretildi (bağımsızlığı sınırlı); fotoğraflar canvas'ta üretilen sentetik çekimler,
  v2'den daha temiz.
- **Son ölçüm (A + B2, bir kez, mini):** tümü 28/35; Set A 16/18; Set B2 12/17; **B2 foto 7/12 (%58)**; PDF/XML 9/9;
  **kritik 0**. Geçme: kritik 0 ✓, PDF/XML %100 ✓, B foto ≥%85 ✗.
  Beklenen 40 stok satırı: 23 onayla, 8 barista sayımıyla girdi; 7 kuyruğa (%17,5); 2 belge uyarıda (B08 toplam görünmüyor).
  Ortalama 6,0 sn, en uzun 9,2 sn; foto başı 0,0029 $.
- **Özellik yok:** iade satırını stoktan düşme (T10 kuruluma gidiyor; güvenli).
- Sonuçlar: C:/Users/berke/Documents/Codex/2026-10-18/cl/work/fatura-v2-son2/ (B2 ayrıntısı içerir).
- Tüm test mekânları, kullanıcılar ve yüklenen dosyalar silindi; test yolu kapalı doğrulandı. Ön yüz commit'li, **push yok**.

## Sıradaki adım
B2 fotoğraf doğruluğu %58 (hedef %85). B2 artık kullanılmış sayılır; yeni ayar için A ile çalışılıp yeni bir B seti gerekir.
Push için kullanıcı onayı bekleniyor (kritik hata 0 şartı sağlandı).
