# İlerleme notları

## ÜRÜN YOL HARİTASI — 2026-10-23 (kullanıcıyla kararlaştırıldı; sıradaki işler buradan)

İlkeler: barista için kolaylık · patron için şeffaflık · hesaplarda güvenilirlik. Uygulama günde birkaç dakikada
işletmenin durumunu anlatır; patrona yalnız dikkat etmesi gerekeni gösterir (sorun yoksa yeşil). AI faturayı okur,
eşleştirme önerir, raporu açıklar — stok ve para hesaplarını doğrulanabilir yazılım kuralları yapar.
Ana belge: tedarikçinin getirdiği e-faturanın imzalı kâğıt hâli (teslim formu gibi); e-posta PDF/XML de olur.
Küçük market/toptancı fişi nadir → son çare barista elle girer (bunlar için yeni okuma yaması YAPILMAZ).

| Faz | İçerik |
|---|---|
| 1 | Fatura okuma doğrulaması (miktar×fiyat=tutar, toplam, KDV, indirim satırı; tutmazsa güçlü modelle 2. okuma; yine tutmazsa yalnız şüpheli satır sorulur) + tedarikçi hafızası + **teslimat doğrulaması** + düzeltmeler silinmeden kayıt |
| 2 | Güvenilir stok hesabı + malzeme başına güven etiketi: Doğrulandı / Eksik veri / Kontrol gerekli |
| 3 | Patron günlük denetim ekranı (istisna yönetimi) + barista görev ekranı (Mal kabul · Fire · Sayım; sistem ne yapılacağını söyler) |
| 4 | Fiyat geçmişi + akıllı fiyat uyarısı + stok farkını araştırma (malzemeye dokununca satış/fire/kabul/sayım dökümü) |
| Sonra | Akıllı sipariş, AI asistanı, tahmin |

Görsel ilke: uzun yazı listesi yok — ikonlu kartlar, dolu çubuklar, grafikler; sayımda ilerleme çubuğu, +/− düğmeleri.

Kararlar (2026-10-23):
- Teslimat: **kör sayma** — barista faturadaki miktarı görmez, gelen koliyi/adeti sayar; sistem faturayla karşılaştırır.
  Stok **kabul edilen** miktar kadar artar (fatura 24 L, gelen 22 L → +22 L, 2 L eksik teslimat).
- Eksik teslimat → patronun günlük ekranına **görev** ("Süt 2 L eksik · ~80 TL"); patron "Çözüldü" işaretleyene kadar açık.
- Satış raporu **haftada bir** (sayım günü) yüklenir → hafta içi stok miktarları tahmindir ve öyle etiketlenir.
- Fiyat uyarısı: artış **> %5 VE** mevcut kullanıma göre **aylık ek maliyet > 250 TL** ise; ortalama fiyat **ağırlıklı** (alınan miktara göre).

## FAZ 1 — Mal kabul (2026-10-24) · YEREL, CANLIDA DEĞİL, push yok

Zincir: faturada 24 L → barista faturayı görmeden 22 L sayar → (uyuşmazsa bir kez daha sayar; fotoğrafta ikinci
okuma) → stok 22 L artar, fiyat faturadaki 24 L'den → patronun Özet'inde "Teslimat kontrolü" görevi (faturanın
fotoğrafı + barista notu) → patron kapatır (iade / sonraki teslimatta geldi / indirim / fark yok / diğer+açıklama)
→ her adım `islem_gecmisi`nde (değiştirilemez).

- **Karekod** (`karekod.js`, GİB Karekod Standardı V1.1): fotoğraf seçilince önce karekod aranır (en fazla 1,5 sn;
  Android'de telefonun okuyucusu, her yerde jsQR ayrı iş parçacığında). Fatura mekanda kayıtlıysa (`belge_kayitli_mi`)
  AI'ya hiç gidilmez. Bulunamazsa AI başlar, karekod arka planda sürer. Kimlik (no/ETTN/tarih/VKN) karekoddan;
  toplamlar DEĞİŞTİRİLMEZ, karşılaştırılır (genel, KDV, satırlar = mal/hizmet toplamı). Okunamazsa akış eskisi gibi.
  Ölçüm (tarayıcı, sentetik A4): 5/5 okundu, 0,4–2,9 sn; karekodsuz sayfa 0,2 sn'de null.
- **İkinci okuma** (`IKINCI_MODEL = gpt-4.1`, yalnız fotoğraf, belge başına 1): toplam/karekod tutmazsa ya da sayılan
  okunandan farklıysa. Tutan okuma kullanılır; ikisi de tutmazsa toplam karekoddan alınır → satırlar sunucu
  kontrolünü geçemez, stoğa girmeden kuruluma düşer. ⚠️ Hangi modelin ikinci okumada en iyi olduğu ÖLÇÜLMEDİ.
- **Kör sayım kararı** (`mal-kabul.js`): tam / okuma hatası (ikinci okuma sayılanla aynı → fatura miktarı düzeltilir,
  fark YOK) / teslimat farkı / belirsiz (fark açılır, "okuma şüpheli"). XML / metinli PDF'te okuma kesin sayılır.
  Tartılamayan/sayılamayan kalem: "faturadaki gibi al" → `sayim='sayilmadi'` izi.
- **SQL 21** (`sql/21_mal_kabul.sql`): belge_satirlari'na gelen_miktar/sayim/teslimat/okunan_miktar/barista_notu;
  `teslimat_farklari` + `islem_gecmisi` (RLS: yalnız patron okur; yazma yalnız işlevlerle); tetikleyiciler (giriş,
  iptal, fark → geçmiş; belge iptal → açık fark iptal); `belge_kayitli_mi`, `teslimat_gorevleri`,
  `teslimat_farki_coz` (yalnız patron); belge_kaydet / belge_satiri_stokla / kurulum_satir_coz yeni hâlleri.
  Giriş kalemi tutarı = alınan malın değeri (tutar × gelen / faturadaki). Geri alma: `scripts/geri-al-21.sql`
  (uygula → geri al → yeniden uygula yerelde denendi).
- **Testler:** `npm test` 69/69 (yeni: test/js/mal-kabul.test.mjs), `npm run test:sql` tüm zincir + test/mal_kabul_test.sql
  (24→22, fiyat şişmez, yetki, başka mekan, mükerrer, sayılamayan, hiç gelmeyen, okuma hatası, kurulum yolu, geri alma,
  geçmiş değiştirilemez). Eski A/B2/C/D/G setleri 0 TL yeniden puanlandı: değişmedi.
- **Demoda uçtan uca denendi** (`node scripts/demo/sunucu.mjs`; demo artık dosya yüklemeyi taklit eder +
  `scripts/demo/demo-mal-kabul.sql` örnek görev): e-fatura XML → kör sayım 22 → yeniden sayım + not → kayıt → patron
  Özet'inde görev → "İade alındı" ve "Diğer + açıklama" ile kapatma → geçmişte 8 kayıt.
- **Denenmedi:** fotoğraf + AI + ikinci okuma akışı (demoda AI yok) · gerçek telefon (iOS/Android) · gerçek imzalı
  e-fatura kâğıdı ve karekodu · canlı veritabanı.
- Kapsam dışı bırakılan (kullanıcı kararı): indirim satırı ve tartılı ürün okuma düzeltmeleri (market fişi sorunları).

### Canlıya alma (kullanıcı onayıyla)
1. Kullanıcının imzalı e-fatura PDF'i/fotoğrafıyla telefonda deneme (karekod + kör sayım) — OpenAI ≈ 0,003–0,013 $.
2. Yedek (`node scripts/yedek-al.mjs <klasör>`) → Supabase'de `sql/21_mal_kabul.sql` → SONRA ön yüz push.
   (Ön yüz önce giderse: eski sunucu sayılan miktarı yok sayardı → sessiz yanlış. Bu yüzden Mal geldi açılırken
   \`belge_kayitli_mi\` yoksa "Uygulama güncelleniyor" deyip sayımı BAŞLATMAZ; Özet açılır, görev kartı görünmez.
   Eski sunucu + yeni ön yüz ile denendi.)
3. Geri dönüş: `scripts/geri-al-21.sql` + `git revert`.

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
- Satış raporu: CSV/XLSX kurulumda cihazda okunuyor (23 Ekim, canlıda değil); fotoğraf/PDF rapor hâlâ elle yazılır.
- Gerçek (sentetik olmayan) fatura fotoğraflarıyla doğruluk ölçülmedi.

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

- 2026-10-21: iki commit push edildi; canlı duman testi (giriş, Mal geldi, Fire var, Haftalık sayım; kayıt yapılmadan) geçti.
  Kullanıcı kararı: test faturalarıyla ayar burada bitti.

## Sadeleştirme — 2026-10-21
- KDV dahil/hariç **gösterim ayarı kaldırıldı** (Mekan sekmesindeki kart); her yerde KDV dahil gösteriliyor. Faturanın KDV
  bilgisi (hariç tutar, oran) içeride saklanmaya ve toplam kontrolünde kullanılmaya devam ediyor. Veritabanındaki
  `mekanlar.kdv_gosterim` sütunu ve `kdv_gosterim_ayarla()` dokunulmadan duruyor (ön yüz artık okumuyor). **Push edilmedi.**
- Kullanıcının listeden seçtikleri uygulandı: Mekan'daki AI okuma sayacı kaldırıldı; malzeme fiyatı her zaman KDV dahil
  girilir ("Bu fiyat KDV dahil/hariç" seçimi yok, KDV oranı kaldı); malzeme listesinde yalnız fiyat; fatura detayındaki
  tekrar eden "genel toplam/indirim" satırı kaldırıldı; eksik belge uyarısı tek cümle; kullanılmayan eski fire/sayım
  formları silindi (form yalnız satış).
- Seçilmeyenler duruyor: fiyat geçmişi, "Fatura elle gir", okuma testi düğmesi, sayım sonrası satış raporu adımı.
- Doğrulama: geçici patron hesabı + test mekânında malzeme ekleme (42,50 TL KDV dahil), satış girişi, e-fatura ile
  Mal geldi, kısa uyarı ve fatura detayı denendi; test verisi silindi. **Push edilmedi.**

- KDV + sadeleştirme commit'leri push edildi (018d46e); canlıda Girişler, Malzeme, Mekan ve fatura detayı kayıt yapılmadan
  kontrol edildi, konsol hatası yok.

- Malzeme formunda KDV oranı alanı da kaldırıldı: yalnız ad, birim, KDV dahil fiyat. Oran faturadan gelmişse
  veritabanı hariç fiyatı yeni dahil fiyattan yeniden hesaplar; yoksa yalnız dahil fiyat saklanır (test mekânında denendi).

## Açık yetkiler (Supabase 30 Ekim 2026 değişikliği) — 2026-10-21
- Canlı yetkiler (role_table_grants + column_privileges) dosyalarla karşılaştırıldı: 19 tablonun hepsinde RLS açık; anon'a hiçbir
  tabloda yetki yok; 17 tablo dosyalarla birebir. Tek açık: mekanlar/uyeler için authenticated SELECT eski varsayılandan
  geliyordu → `sql/11_acik_yetkiler.sql` ile açıkça yazıldı ve canlıya uygulandı (davranış değişmedi).
- Not: service_role'ün tüm tablolardaki tam yetkisi de varsayılandan geliyor; uygulamanın service_role ile eriştiği yerler
  (ic_ayarlar, okuma_testleri, ai_okuma_bitir) dosyalarda açıkça grant'li.
- CLAUDE.md'ye kural eklendi: yeni tablo aynı dosyada RLS + politika + açık grant (gerekirse service_role) ile gelir.
- Canlı kontrol (giriş yapmış patron): tüm sekmeler ve REST okumaları 200, permission denied yok.

## Stok güvenilirliği düzeltmeleri — 2026-10-21 (CANLIDA: sql/12 + veri düzeltmesi + ön yüz push d172bf9)
- Denetim (salt-okuma) bulguları: kurulumda bağlanan satırda fiyat kontrolü yoktu (soda 24 ml / 14.500 ₺/L); fatura
  Girişler'den iptal edilince belge açık kalıyor, aynı fatura yeniden yüklenemiyordu; stok farkı raporu yoktu; satış
  raporu stoğa işlenmiyordu; sayım ekranı şişeli malzemeyi litre soruyordu; defterde yanlış/eskimiş kayıtlar.
- `sql/12_stok_duzeltmeleri.sql`: kurulum_satir_coz fiyat/miktar kontrolü (+p_onay), giris_iptal belgeyi de iptal eder,
  kurulum_satis_raporu_isle (aynı güne 2. satış reddedilir), kurulum_kuyrugu ürünleri döndürür, stok_farki raporu.
  Kural: sayım gün sonu; hareket tarihi girişin tarihi; malzeme başına önceki sayımdan bu sayıma; TL güncel fiyatla.
- Ön yüz: Rapor sekmesi (patron), kurulumda birim fiyat önizleme + "Fiyat/miktar doğru" kutusu + satış raporu adet
  formu; sayımda adında paket boyu olan g/ml malzeme şişe olarak sayılır, özet ekranda birimle gösterilir.
  eslestirme.js: ölçü birimi + adda farklı paket boyu → çarpan bilinmez (kurulum); takip dışı kararından SONRA
  açılan malzemeye uyan satır yeniden kuruluma gider.
- Testler: `npm test` (JS 40/40), `npm run test:sql` (PGlite, tüm SQL testleri). Canlı fonksiyonlar repo ile birebir
  aynı (07/08 hariç), yerel test DB canlıyı temsil ediyor. Ön yüz tarayıcıda tıklanarak denenmedi (canlıya çıkınca).
- Yedek: Desktop\kahve-stok-yedek\2026-10-21_duzeltme-oncesi (tüm tablolar JSON + fonksiyonlar; gizli imza yazılmadı).
- Veri düzeltme betiği `scripts/veri-duzeltme-2026-10-21.sql` (3 belge iptal; defter: vanilya → Vanilya şurubu 700,
  soda çarpan 200, 5 yanlış kayıt silinir; soda satırı 4.800 ml / 72,50 ₺). Yedeğin yerel kopyasında denendi.

- Canlıya alma (2026-10-21): yedek `kahve-stok-yedek\2026-10-21_canliya-alma-oncesi` (ilk yedekle birebir aynıydı),
  boş DB'ye geri yükleme gidiş-dönüşü 19/19 tablo aynı. Canlı 12 fonksiyonları yerelle aynı; canlı sonrası dışa aktarma
  (`2026-10-21_duzeltme-sonrasi`) yalnız beklenen 15 değişikliği gösterdi. Maden suyu 100 / vanilya 50 sayımı TEST verisi,
  korundu.
- Geri dönüş: `scripts/veri-duzeltme-geri-al-2026-10-21.sql` → `scripts/geri-al-12.sql` → `git revert` + push.
  Yedeğin yerel kopyasında provası yapıldı: tablolar + yetkiler birebir, fonksiyon metinleri canlıdaki (CRLF) hâline döner.
- Açık (eski, bu işte değişmedi): `fatura_kaydet` (Fatura elle gir) sunucuda rol/fiyat kontrolü yapmıyor; ekranda yalnız
  patronda ama barista API'den doğrudan çağırabilir. Karar kullanıcıda (yalnız patrona kısıtlamak?).

- Canlı ekran testi (patron oturumu, kayıt yok): Girişler'de soda 4,8 litre; Rapor sekmesi 10 malzemeyi "ilk sayım"
  gösteriyor; Kurulum açılıyor (kuyruk boş); sayımda soda/vanilya "şişe / paket", özet "3 şişe = 2,1 litre"; 375 px'te
  sekmeler sığıyor; konsol hatası yok; DB sayıları değişmedi. Kurulum fiyat önizleme / satış raporu formu canlıda
  bekleyen belge olmadığı için görülmedi (yalnız SQL testleriyle doğrulandı).

- Kullanıcı kararı (2026-10-21): `fatura_kaydet` yetki açığı şimdilik böyle kalıyor. 23 Ekim: kullanıcı kapatılmasını istedi → sql/14 (canlıya uygulanmadı).

## Sıradaki adım
CANLIDA (2026-10-23 akşam): sql/13, 14, 15, 20 canlıya uygulandı ve doğrulandı; ön yüz push edildi (2adf651).
Yedek: `Desktopkahve-stok-yedek6-10-23_canliya-alma-oncesi` (`node scripts/yedek-al.mjs <klasör>` ile; depo dosya türleri `_kovalar.json`).
Canlı duman testi (patron oturumu, kayıt yok): Özet, Stok, Rapor, Girişler, Ayarlar (Malzemeler/Ürünler/Mekan) açılıyor,
konsolda hata yok, yatay taşma yok. Barista girişi denenmedi (şifre gerekir); barista ana ekran kodu önceki canlı sürümle aynı.
Sonraki: ikinci haftalık sayımdan sonra Özet/Rapor açığını kontrol et; barista hesabıyla Mal geldi/Fire/Sayım ekranlarına bak.
Bilinen veri notu: canlıda "Sade maden suyu 200 ml" 100 litre, "Vanilya şurubu 700 ml" 50 litre sayılmış (21 Ekim test sayımı).

## 6 saatlik bağımsız çalışma — 2026-10-23 (yerel, push yok)

Aynı klasörde aynı anda iki ajan çalıştı: **Codex** (2, 3, 4, 6, 7. işler; `main` üzerinde) ve **Claude** (1, 5, 8. işler +
Codex'in işlerinin gözden geçirmesi; ayrı çalışma kopyası `C:\Users\berke\kahve-stok-claude`, dal `claude/patron-ekranlari`,
sonra `main`'e ileri sarıldı). Çakışma yok; bütün commit'ler `main`'de sırayla.

| İş | Durum | Test / ölçüm |
|---|---|---|
| 1. Patron ekranları | YAPILDI | Özet, Stok, Rapor, Girişler, Ayarlar; 375 px'te taşma yok; uçtan uca tıklama testi hatasız |
| 2. Açık raporu doğrulaması | YAPILDI (Codex) + ek test (Claude) | 14 gün elle hesap −233 TL birebir; ayrıca 10 günlük stok/trend testi elle hesapla |
| 3. Elle fatura yalnız patron | YAPILDI (Codex) | sql/14: barista/kurulum/mekansız/anon reddedilir, veri değişmez |
| 4. Satış CSV/Excel + ikram | YAPILDI (Codex), iyileştirildi (Claude) | Örnek CSV/XLSX 537 adet, 6 ikram dahil |
| 5. Fotoğraf okuma doğruluğu | YAPILDI (genel kurallar) | Görülmemiş D seti, tek ölçüm: 14/16 doğru, 1 kurulum, 1 yanlış |
| 6. Demo Kafe verisi | YAPILDI | Ekran görüntüleri bununla; 3. hafta süt −17,4 L / −764 TL |
| 7. Veri izni metni | TASLAK (Codex) | `docs/veri-izni-taslak.md`; bölge/saklama/iletişim boş bırakıldı |
| 8. Diğer iyileştirmeler | YAPILDI | Aşağıda |

**1. Patron ekranları (app.js, patron-hesap.js, style.css, sql/20_patron_ekranlari.sql)**
- Alt menü: Özet · Stok · Rapor · Girişler · Ayarlar (Malzemeler/Ürünler/Mekan/Kurulum Ayarlar'ın altında). Barista ekranı değişmedi.
- **Özet:** son haftanın açığı büyük rakamla (kırmızı = normalden yüksek, yeşil = normal), önceki haftayla fark, en çok açık
  veren 3 malzeme, bekleyen fatura/satış raporu uyarısı, haftalara göre açık grafiği, "≈ N gün yeter" azalan malzemeler.
  Yeni mekânda "İlk adımlar" listesi (malzeme → tarif → barista daveti → ilk sayım).
- **Stok:** her malzemede şu an elde ne var (son sayım + sonra gelen − satılan − fire), günlük birimle ("17 litre",
  "10,4 kg", "350 ml"), kaç gün yeteceği (son 28 gün ortalaması) ve elde olan malın TL değeri. Yeni SQL: `stok_durumu()`.
- **Rapor:** hafta seçimi, toplam açık/fazla, her malzemede önceki sayım / gelen / kullanılan / fire / olması gereken /
  sayılan / açık — miktar ve TL. Kural: **kayıp, kullanılanın %3'ünden fazla VE 50 TL'den büyükse kırmızı**; fazla
  çıkan sarı; diğerleri yeşil (`patron-hesap.js`'de tek yerde). Haftalık açık grafiği (SQL: `acik_trendi()`).
  "Raporu indir (Excel)": Türkçe Excel'de açılan CSV (cihazda üretilir; formül enjeksiyonuna karşı korumalı).
- **Girişler:** tarih · tür · tedarikçi/açıklama · tutar satırları (fatura TL, fire TL, satış ürün adedi, sayım malzeme
  sayısı), türe göre süzgeç; ayrıntı dokununca açılır.
- Ekran görüntüleri: `ekran-goruntuleri/once/` (5 adet, eski ekranlar) ve `ekran-goruntuleri/sonra/` (12 adet, koyu tema
  ve yeni mekan dahil), hepsi 375 px, Demo Kafe verisiyle.
- Yerel demo: `node scripts/demo/sunucu.mjs` → http://localhost:8787 (patron@demo.kafe / barista@demo.kafe /
  yeni@demo.kafe, şifre demo1234 — yalnız bu yerel sunucuda). Canlıya hiç bağlanmaz; PGlite + sql/ dosyaları.

**2. Açık raporu:** Codex'in 14 günlük senaryosu (−233 TL) + `test/patron_ekranlari_test.sql` (elle hesaplanmış şu anki
stok, kaç gün yeter, trend = rapor, barista/başka mekan/anonim ret, bekleyen fatura uyarısının dönemi).

**4. Satış raporu (Claude ekleri):** "Stok Adı", "Satış Miktarı", "Ürün Açıklaması" gibi kasa programı başlıkları tanınır;
kod/grup/fiyat sütunları aday olmaz; "ARA TOPLAM:", "Genel Toplam (TL)" satırları atlanır; tarifi olmayan ürün (şişe su,
kek) için "Tarifi yok, stoktan düşme" seçeneği — eskiden böyle bir satır varsa rapor hiç kaydedilemiyordu.

**5. Fotoğraf okuma** (yalnız `scripts/okuma-testi.sh` ile, model gpt-4.1-mini)
- Genel kurallar (eski A/B2 setlerinin saklı ham AI cevapları üzerinde, OpenAI'sız geliştirildi):
  (a) ürün adındaki paket içi ("25'Lİ", "(500'lü)") AI'nın miktarıyla çelişirse satır kuruluma değil **baristanın paket
  sayımına** gider; sayım ekranı yazarken toplamı gösterir ("= 500 adet"); (b) AI "takip dışı" dese de satır bir malzemenin
  baş ismini kısaltmasız taşıyorsa ("ESPRESSO HARMANI ÇEKİRDEK") sessizce düşmez, kuruluma gider (tamlama — bardak
  kapağı, süt kreması — hariç); (c) tedarikçinin adında da geçen kelime ("ANADOLU SÜT" faturasında "ANADOLU") -lu/-li
  sıfatı sanılmaz.
- Ölçüm sırası (dürüst): **Set C** (9 belge, kod dondurulduktan sonra üretildi) ilk ölçüm: 23 satırdan 15 doğru, 5 kurulum,
  3 yanlış (biri kahvenin sessizce takip dışı sayılması). C'ye bakılarak (b) ve (c) eklendi → C artık bağımsız değil.
  **Set D** (8 yeni belge, sonra üretildi) **tek gerçek ölçüm: 16 satırdan 14 doğru, 1 kurulum, 1 yanlış** (D04 "çift
  cidarlı bardak" takip dışı sayıldı → stok eksik). Bu da genel kuralla düzeltildi (-lı sıfatı farklı ürün sayılmaz);
  yeniden puanlamada D 14 doğru / 2 kurulum / 0 yanlış — ama bu bağımsız ölçüm değildir. Eski A/B2'de gerileme yok.
- Setler sentetik çekimlerdir (tarayıcıda üretilip eğiklik/ışık/gürültü eklendi), gerçek telefon fotoğrafı değildir:
  `Desktop\test-faturalar-C`, `Desktop\test-faturalar-D` (cevap anahtarları ve ham sonuç içinde).
- Ortalama AI süresi 2,5–3,0 sn, fatura başı ≈ 0,0020 $.
- `okuma-testi.sh` düzeltildi: çok satırlı sorgu Windows'ta `npx` ile bozuluyordu; hata anında temizlik mesajı görünmüyordu.
- **Test yolu sonunda KAPALI** ("okuma testi KAPALI" döndü), canlı depoda `_test/` klasörü boş (kontrol edildi).

**OpenAI harcaması (bu oturum, tamamı okuma testi): ≈ 0,054 $** (C seti iki kez ≈ 0,038 $ — ilk çalıştırmada betik hatası
nedeniyle sonuçlar alınamadı —, D seti 0,016 $). Codex OpenAI kullanmadı.

**6. Demo verisi:** `scripts/demo/demo-veri.sql` (ekran görüntüleri bununla: 4 hafta, günlük satış, faturalar, fire,
haftalık sayım, 3. haftada süt −17,4 L, 1 bekleyen fatura, boş "Yeni Kafe"). Canlıya yazmaz. Codex'in
`scripts/demo-kafe.mjs` + `demo-plan.mjs` betiği kullanıcı kararıyla kaldırıldı (tek demo betiği kalsın).

**8. Diğer:** rapordaki "fatura bekliyor" uyarısı yalnız o haftaya düşen faturada çıkar (eskiden bütün eski haftalarda);
sunucu güncellenmeden ön yüz açılırsa İngilizce hata yerine Türkçe uyarı; çıkışta seçili hafta/ay sıfırlanır (aynı
telefonda başka mekan açılınca "sayım yok" görünüyordu); sekme simgesi.

**Testler (son):** `npm test` 63/63, `npm run test:sql` tüm zincir (01–15, 20 ve testleri) geçti.
**Denenmeyenler:** gerçek telefonda (iOS/Android) dokunma ve indirme; canlı veriyle yeni ekranlar; Excel'in gerçek kasa
programı çıktıları; gerçek (sentetik olmayan) fatura fotoğrafları.

### Canlıya alma sırası (senin yapman gerekenler)
1. `main`'deki yerel commit'leri ve ekran görüntülerini gözden geçir (`ekran-goruntuleri/once` ↔ `sonra`).
2. Canlı veritabanının yedeğini al (önceki gibi `Desktop\kahve-stok-yedek\…`).
3. Supabase SQL Editor'da yalnız yeni dosyaları **bu sırayla** çalıştır: `sql/13_rapor_uyarilari.sql` →
   `sql/14_fatura_patron_yetkisi.sql` → `sql/15_satis_excel_dosya.sql` → `sql/20_patron_ekranlari.sql`.
   (01–12 zaten canlıda; tekrar çalıştırma.) Edge Function değişikliği yok.
4. **SQL'ler bittikten sonra** ön yüzü yayımla (`git push` → GitHub Pages). Sıra önemli: ön yüz önce giderse patronun Özet
   ekranı "sunucu güncellemesi yapılmamış" uyarısı verir.
5. Kendi patron hesabınla telefonda: Özet, Stok, Rapor (hafta değiştir, "Raporu indir"), Girişler süzgeci. Barista
   hesabıyla: Mal geldi / Fire / Sayım ekranlarının aynı kaldığını gör; baristanın "Fatura elle gir" çağrısının reddi.
6. İlk gerçek satış raporu Excel/CSV gelince kurulumda eşleşmeyen satırları ve "Tarifi yok" seçeneğini kontrol et.
7. Veri izni taslağındaki boşlukları (bölge, saklama süresi, iletişim, silme) doldur; sonra yayımla.
8. Geri dönüş: ön yüz için `git revert` + push; SQL için 20 → `drop function public.stok_durumu(); drop function
   public.acik_trendi(int);`, 13/14/15 için önceki işlev metinleri `kahve-stok-yedek` yedeğinde.

## İlk GERÇEK fiş testi — 2026-10-23 (kod değişmedi, gpt-4.1-mini, 0,0026 $)
- Set: `Desktop\test-faturalar-gercek` (kullanıcının telefonla çektiği gerçek fişler; G01 = ŞOK market fişi). Fişler
  biriktikçe buraya eklenir; kod ölçüm bitene kadar dondurulur. Test için fişteki 3 ürün malzeme tanımlandı.
- G01: 8 satırdan 5 doğru, 2 kurulum, 1 yanlış. Tedarikçi, VKN, tarih, KDV 46,60, genel toplam 427,42 doğru; fiş no okunmadı.
- Bulgu 1 (yanlış): "1,033Kg X 99,00" çarpanı AI'da ürün adına yapıştı ("1,033KG TADPİ PİLİÇ BAGET KG") → eşleştirme
  addaki 1,033 kg'ı paket boyu sandı → 1,033 × 1033 = 1.067 g önerildi (1.033 g olmalı). Tartıyla satılan ürün riski.
- Bulgu 2: indirim satırları ("25TLFINISH110TL −149,00") ayrı ürün ve ARTI tutarla okundu ("2STL…"); toplam kontrolü
  tutmadı (yakalandı). Takip dışı oldukları için stok zararı yok; malzemeye denk gelseydi yanlış giriş riski.
- Ozmo (adında 23G, malzeme adet) kuruluma düştü — beklenen güvenli davranış.
- G02 (market fişi, üstü kesik; 0,0024 $, 5,6 sn): 10 satırdan 4 doğru, 0 yanlış, 5 kurulum (+2 latte tek satırda
  birleşti, puanlamada "okunamadı" görünür ama doğru). Toplam, KDV, tarih doğru; mağaza adı görünmüyordu → AI boş
  bıraktı (uydurmadı). Tartılı çarpanlar bu kez doğru satıra gitti ama ağırlık rakamları kaydı (0,656→0,655;
  0,378→0,373) — miktar × birim fiyat ≠ tutar ile yakalanabilir (şu an kontrol yok). AI "Piliç bonfile"yi
  "Piliç baget"e bağladı (0,95 güven) → baş isim koruması kuruluma attı. Latte süt/kahveye bağlanmadı.
  Asıl zayıflık: AI'nın 0,7–0,75 güvenli "takip dışı" kararları (Cemilusta, ekmek, soğan, latte) 0,8 eşiğinin
  altında kalıp kuruluma düşüyor → patrona gereksiz iş.
