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
- **Son ölçüm (bir kez, B dahil):** tümü 17/42; Set A 11/18; Set B 6/24 (**B'de kritik 0**, ama doğruluk düştü: çoğu kuyruğa);
  PDF/XML 5/10; **kritik 1 (T03, Set A):** AI fişte "2 X 129,00" çarpanını atlayıp bardak paketini 1 okudu (1×258=258 tutarlı,
  toplam tuttu, bardakta fiyat geçmişi yok) → 50 adet girdi, 100 olmalıydı. Üç geçme kriterinin üçü de geçmedi.
- **Kök nedeni belirsiz (Set A):** T04, T17, T19'da süt satırı doğru miktar ve çarpanla gönderildi ama sunucuda kuyrukta kaldı;
  bekleme_sebebi ölçüm düzeneğinde kaydedilmediği için neden bilinmiyor (fiyat/miktar kontrolü şüpheli).
- **Özellik yok:** iade satırını stoktan düşme (T10 kuyruğa gidiyor; güvenli).
- Set B bir kez kullanıldı; bundan sonraki ayar için **yeni bir B seti** gerekir (README kuralı).
- Sonuç dosyaları: C:/Users/berke/Documents/Codex/2026-10-18/cl/work/fatura-v2-son/ (B ayrıntısı içerir, düzeltme yapan açmamalı).
- Test mekânı, geçici kullanıcı ve 17 test dosyası silindi; test yolu kapalı doğrulandı.

## Sıradaki adım
Kullanıcı kararı bekleniyor: (1) ölçüm düzeneğine bekleme_sebebi kaydı ekleyip süt kuyruğunun nedenini Set A ile bul;
(2) fiyat geçmişi olmayan malzemede fişten okunan paket satırı için ek güvence (T03 kritik); (3) yeni bir B seti ile ölç.
