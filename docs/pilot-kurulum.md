# CoffeeStock pilot kurulum listesi

Telefondan okunur: her başlık tek ekran, adımlar numaralı. Uygulama adresi: https://berkecngzz-ai.github.io/kahve-stok/

---

## A. Hazırlık (kurulumdan önce, 5 dk)
1. Patrondan kasa programının **satış raporunu Excel ya da CSV** olarak alabildiğini doğrula (ürün adı, adet, tarih olmalı).
2. Patrondan o gün elde olan **bütün malzemeleri** (süt, kahve, şurup, bardak…) ve **ürün listesini** (latte, filtre kahve…) iste.
3. Malzeme için faturadaki **kg / litre / adet fiyatını** al (KDV dahil).
4. İki telefon hazır olsun: patron ve barista.

## B. Yeni mekan açma (patron telefonu, 2 dk)
1. Uygulamayı aç → **Hesap aç**.
2. E-posta ve şifre yaz (patronun kendi e-postası). **Patronum: mekanımı oluştur**'a bas.
3. **Mekan adı** ve **Adın** yaz → oluştur.
4. Özet ekranında **İlk adımlar** listesi çıkar. Sırayla ilerleyeceğiz.

## C. Malzeme girişi (patron, Ayarlar → Malzemeler)
1. Alt menüden **Ayarlar** → **Malzemeler** → **+ Yeni malzeme ekle**.
2. **Adı** yaz (örn. Tam yağlı süt). **Birimi** seç: kg, litre ya da adet.
3. **Fiyatı** yaz: kg / litre / adet başına, KDV dahil.
4. **Kaydet**. Her malzeme için tekrarla.
5. Birim sonradan değişmez: yanlış seçtiysen malzemeyi pasife al, yenisini aç.
6. Bardak, kapak gibi adetle sayılanları da ekle.

## D. Ürün ve reçete girişi (patron, Ayarlar → Ürünler)
1. **Ayarlar** → **Ürünler** → **+ Yeni ürün ekle**.
2. **Ürün adı**: kasadaki adla aynı yaz (örn. Latte).
3. **Tarif** bölümünde 1 adet satılınca harcananı gir: örn. 18 g kahve, 220 ml süt, 1 bardak.
4. **Kaydet**. Her ürün için tekrarla.
5. Menüde olmayan ürünü ekleme: stok takibine girmez.
6. Reçetesi olmayan ürün satılırsa stoktan düşmez, Özet'te uyarı çıkar.

## E. Baristayı bağla (patron + barista, 3 dk)
1. Patron: **Ayarlar** → **Mekan** → **Barista davet kodu** kutusundaki kodu baristaya söyle.
2. Barista kendi telefonunda uygulamayı açar → **Hesap aç**.
3. E-posta ve şifresini yazar → **Baristayım: davet koduyla katıl**.
4. Kodu ve **Adın**'ı yazar → **Mekana katıl**.
5. Barista ana ekranında 3 büyük düğme görmeli: **Mal geldi**, **Fire var**, **Haftalık sayım**.
6. Kod yanlış kişiye gittiyse: Mekan ekranından kodu yenile (eski kod çalışmaz).

## F. Başlangıç sayımı (barista, 10 dk, en önemli adım)
1. Dolapta ve rafta **her malzemeyi tek tek say**. Tahmin yazma.
2. **Haftalık sayım**'a bas. Her malzeme için sayını yaz (süt litre, kahve kg, şurup litre, bardak adet).
3. Listedeki **hepsini** doldur, sonra gönder.
4. Bu sayım "başlangıç noktası"dır. **İlk stok farkı ikinci sayımdan sonra çıkar** (7 gün sonra), bunu patrona söyle.
5. Patron: Özet'te "İlk sayım yapıldı" görünce tamam.
6. Sayımı akşam kapanıştan sonra, o günün işleri bitince yap.

## G. Baristaya gösterilecek 3 işlem (her biri 1 dk)

**1) Fatura fotoğrafı: Mal geldi**
1. **Mal geldi**'ye bas, faturayı ya da irsaliyeyi düz bir yüzeyde, tam ve net çek.
2. Listeyi kontrol et. Doğruysa **Hepsi geldi, kaydet**.
3. Eksik geldiyse o satırın altında **Farklı geldi**'ye bas, gelen miktarı say.
4. Listede olmayan ürün (deterjan, peçete) görmezden gelinir. Kafayı yorma.
5. **Bu ürün X değil** yalnız eşleşme yanlışsa. Emin değilsen basma, patrona sor.

**2) Fire: Fire var**
1. Döküldü, bozuldu ya da yanlış yapıldıysa hemen **Fire var**'a bas.
2. Malzemeyi ya da ürünü seç, miktarı yaz, nedeni seç → kaydet.
3. Küçük de olsa gir: girilmeyen fire stok farkı olarak görünür.

**3) Z raporu: kasa satış raporu**
1. Kapanışta kasadan günün satış raporunu **Excel / CSV** al.
2. Sayım ekranından sonra çıkan yönlendirmeyle ya da Girişler'den dosyayı yükle.
3. Eşleşmeyen ürün varsa listeden ürünü seç; takip etmediğimiz ürüne **Tarifi yok** de.
4. Barista yükler, **işlemeyi patron yapar**: patronun Özet'inde "Satış raporu işlenmeyi bekliyor" çıkar.
5. Her gün yükle: yüklenmeyen gün için uygulama stok farkı hesaplamaz ve "satış raporu eksik" der.

## H. Patron günlük kontrol (1 dk)
1. **Özet**'i aç, tepedeki karta bak: ✓ Her şey yolunda / amber (sayım ya da satış raporu eksik) / kırmızı (stok farkı yüksek).
2. **Yapman gerekenler**'deki satırlara dokun, her satır bir iş söyler.
3. Eksik teslimat çıkarsa karar ver: iade alındı / sonraki teslimatta geldi / indirim yapıldı.
4. Kırmızı kart varsa dokun, hesabı açılır: önceki sayım + gelen − satılan − fire = olması gereken; sayılanla farkı gör.

## I. İlk hafta kontrol listesi
1. Gün 1: sayım yapıldı, malzeme ve ürün girildi.
2. Her gün: Z raporu yüklendi, barista fire girdi, mal gelince **Mal geldi** kullanıldı.
3. Gün 7: ikinci sayım. Sonra **Rapor** sekmesinde ilk stok farkı görünür.
4. Gün 8: patronla birlikte rapora bak: "hangi malzemede ne kadar fark var" sorusunu birlikte yanıtla.
5. Sayım hatırlatması için patron **Özet'te Sayım iste** kullanabilir; barista ana ekranında görür.

## Sık olan sorunlar (sahada)
- **"Satış raporu eksik" uyarısı:** o dönemde rapor yüklenmemiş. Eksik günlerin raporunu yükle, uyarı gider.
- **Bir malzeme "Henüz sayılmayanlar"da:** ilk sayımda yazılmamış. Sonraki sayımda yaz.
- **Fatura okunmadı / kuruluma düştü:** Özet'te "Ekibimiz işliyor" yazar. Patronun yapacağı bir şey yok.
- **Barista yanlış sayı girdi:** patron Rapor'dan o sayımı düzeltebilir (işlem geçmişine yazılır).
- **Telefonda eski sürüm görünüyor:** sayfayı aşağı çek ya da ekrandaki **Güncelle** bandına dokun.
