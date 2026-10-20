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

## Sıradaki adım
Kullanıcıdan gerçek ve daha önce görülmemiş fatura fotoğrafları (+ cevap anahtarı) `Desktop\test-faturalar`'a gelince
`scripts/okuma-testi.sh` ile doğruluğu ölç ve sonucu raporla. Fotoğraflar gelene kadar: satış raporu okuma ya da açık raporu
(kullanıcıya hangisiyle başlanacağını sor).
