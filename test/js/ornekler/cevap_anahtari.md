# Test faturaları – doğru cevaplar

Hepsi hayali, üzerlerinde TEST yazıyor. Rakamlar birbiriyle tutarlı; uygulamanın okuduğu sonucu bu listeyle karşılaştır.

Önce şu malzemeleri tanımla: **Süt (litre), Kahve çekirdeği (gram), Filtre kahve (gram), Karamel şurubu (ml), Vanilya şurubu (ml), Bardak (adet)**.

### 01_sut_efatura  (ÖRNEK SÜT GIDA LTD. ŞTİ.)

| Satır | Miktar | Tutar | Beklenen sonuç |
|---|---|---|---|
| Ak Çiftlik Tam Yağlı Süt 1L | 24 Adet | 924,00 | Süt 24 L |
| Ak Çiftlik Laktozsuz Süt 1L | 6 Adet | 312,00 | Süt 6 L (laktozsuz da süt sayılırsa) – yeni ürün, 'süt mü?' sorusu beklenir |
| Ak Çiftlik Barista Süt 1L | 12 Adet | 540,00 | Süt 12 L – yeni ürün, 'süt mü?' sorusu beklenir |

Ara toplam **1.776,00**, KDV **17,76**, genel toplam **1.793,76 TL**

Ne denenmeli: tamamı süt; PDF'ten okumanın en kolay testi.

### 02_kahve_sirup_efatura  (DENEME KAHVE KAVURMA A.Ş.)

| Satır | Miktar | Tutar | Beklenen sonuç |
|---|---|---|---|
| Espresso Blend Çekirdek Kahve 1KG | 3 Adet | 2.760,00 | Kahve çekirdeği 3.000 g |
| Kolombiya Filtre Kahve 250G | 4 Adet | 1.240,00 | Filtre kahve 1.000 g |
| Karamel Şurup 70CL | 2 Adet | 530,00 | Karamel şurubu 1.400 ml |
| Vanilya Şurup 70CL | 2 Adet | 530,00 | Vanilya şurubu 1.400 ml |

Ara toplam **5.060,00**, KDV **506,00**, genel toplam **5.566,00 TL**

Ne denenmeli: aynı fatura PDF ve XML olarak var. İkisini sırayla yükle; ikincisinde **"daha önce yüklenmiş"** uyarısı çıkmalı (fatura no aynı: TST2026000000102).

### 03_toptanci_foto  (ÖRNEK TOPTAN GIDA (TEST))

| Satır | Miktar | Tutar | Beklenen sonuç |
|---|---|---|---|
| ACIFTLIK T.YAG SUT 1LT | 12 AD | 462,00 | Süt 12 L – kısaltmalı, ama 01 faturasıyla aynı ürün |
| MNN KRML SRP 70CL | 1 AD | 265,00 | Karamel şurubu 700 ml – kısaltma, büyük ihtimalle kurulum kuyruğuna düşer |
| PECETE 100LU | 10 PK | 420,00 | Takip dışı |
| BULASIK DETERJANI 5LT | 1 AD | 189,90 | Takip dışı |
| KARTON BARDAK 8OZ 50LI | 4 PK | 380,00 | Bardak 200 adet (bardak takip ediliyorsa), yoksa takip dışı |

Ara toplam **1.716,90**, KDV **229,10**, genel toplam **1.946,00 TL**

Ne denenmeli: telefon fotoğrafı gibi eğik ve gölgeli. Peçete ve deterjan **kuyruğa düşmemeli**, sessizce takip dışı sayılmalı.

### 04_market_fis  (DENEME MARKET (TEST))

| Satır | Miktar | Tutar | Beklenen sonuç |
|---|---|---|---|
| SUT 1L YAGLI | 6 AD | 246,00 | Süt 6 L |
| KAKAO TOZU 500G | 1 AD | 210,00 | Takip dışı (kakao takip edilmiyorsa) |
| SEKER KUP 1KG | 2 AD | 129,00 | Takip dışı (şeker takip edilmiyorsa) |

Ara toplam **585,00**, KDV **24,75**, genel toplam **609,75 TL**

Ne denenmeli: en zor durum, gürültülü termal fiş. Birkaç satırın kuyruğa düşmesi normal; önemli olan **yanlış rakamın stoka girmemesi**. Toplam tutmazsa uyarı çıkmalı.

### 05_satis_raporu_haftalik.csv

Satış raporu okuma adımı için. 6 adet **ikram latte** fiyatı 0 TL; bu satır da tüketim sayılmalı (6 latte kadar süt ve kahve).

### Ek testler

- 01 PDF'i iki kez yükle → ikinci yüklemede uyarı.
- 03 fotoğrafını yükleyip bir rakamı bilerek yanlış düzelt → "Toplam tutmuyor" çıkmalı.
- KDV oranları test içindir, gerçek oranlar ürüne göre değişebilir.
