-- 12_stok_duzeltmeleri.sql testleri. Her test başarısızsa hata fırlatır.
-- Sıra: ... 10, 11, 12, bu dosya (node test/sql-calistir.mjs --hepsi).
\set ON_ERROR_STOP 1
insert into auth.users values
 ('dddddddd-0000-0000-0000-000000000001','patronP@x.com'),
 ('dddddddd-0000-0000-0000-000000000002','baristaP@x.com'),
 ('dddddddd-0000-0000-0000-000000000003','patronQ@x.com'),
 ('dddddddd-0000-0000-0000-000000000004','patronR@x.com'),
 ('dddddddd-0000-0000-0000-000000000005','baristaR@x.com'),
 ('dddddddd-0000-0000-0000-000000000009','kurulumP@x.com');
insert into public.kurulum_hesaplari (user_id) values ('dddddddd-0000-0000-0000-000000000009');

create or replace function pg_temp.ol(u text, e text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, false), set_config('request.jwt.claim.email', e, false) $$;
create or replace function pg_temp.hata_bekle(q text, beklenen text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then
    if sqlerrm not like '%' || beklenen || '%' then raise exception 'Beklenmeyen hata: % (sorgu: %)', sqlerrm, q; end if;
    return;
  end;
  raise exception 'Hata bekleniyordu ama olmadı: %', q;
end $$;
create or replace function pg_temp.dogrula(b boolean, mesaj text) returns void language plpgsql as $$
begin if not coalesce(b, false) then raise exception '%', mesaj; end if; end $$;
-- Fotoğraftan okunmuş, eşleşmesi kuruluma kalmış tek satırlık fatura (barista yükler).
create or replace function pg_temp.fatura1(istek text, ozet text, metin text, miktar numeric, birim text, haric numeric,
                                          aday uuid) returns jsonb language sql as $$
  select public.belge_kaydet(jsonb_build_object(
    'istek_id', istek, 'tur', 'fatura', 'kaynak', 'ocr', 'dosya_ozeti', ozet, 'tedarikci', 'Metro Market',
    'tarih', public.bugun(), 'toplamlar', jsonb_build_object('genel', haric), 'okunan', jsonb_build_object('not', 'test'),
    'satirlar', jsonb_build_array(jsonb_build_object('metin', metin, 'miktar', miktar, 'birim', birim,
      'tutar_haric', haric, 'kdv_orani', 0, 'sinif', 'belirsiz', 'aday_malzeme_id', aday)))) $$;
-- Belgenin ilk satırının id'si
create or replace function pg_temp.satir(belge jsonb) returns bigint language sql as $$
  select id from public.belge_satirlari where belge_id = (belge ->> 'id')::uuid order by sira limit 1 $$;

set role authenticated;

-- ===== Kafe P: patron, barista, malzemeler, Latte tarifi =====
select pg_temp.ol('dddddddd-0000-0000-0000-000000000001','patronP@x.com');
select public.mekan_olustur('Kafe P','Pelin');
select id as mekan_p, davet_kodu as kod_p from mekanlar \gset
insert into malzemeler (ad, birim, fiyat_haric, kdv_orani) values
  ('Sade maden suyu 200 ml','ml',75,0), ('Süt','ml',40,0), ('Kahve','g',1000,0), ('Bardak','adet',2,0);
select id as soda from malzemeler where ad like 'Sade%' \gset
select id as sut from malzemeler where ad = 'Süt' \gset
select id as kahve from malzemeler where ad = 'Kahve' \gset
select id as bardak from malzemeler where ad = 'Bardak' \gset
select public.urun_kaydet(null, 'Latte', jsonb_build_array(
  jsonb_build_object('malzeme_id', :'kahve', 'miktar', 18), jsonb_build_object('malzeme_id', :'sut', 'miktar', 200),
  jsonb_build_object('malzeme_id', :'bardak', 'miktar', 1))) as latte \gset
select pg_temp.ol('dddddddd-0000-0000-0000-000000000002','baristaP@x.com');
select public.mekana_katil(:'kod_p','Bora');

-- ===== Kafe Q (başka mekan, izolasyon için) =====
select pg_temp.ol('dddddddd-0000-0000-0000-000000000003','patronQ@x.com');
select public.mekan_olustur('Kafe Q','Kerem');
insert into malzemeler (ad, birim, fiyat_haric, kdv_orani) values ('Kahve Q','g',900,0);
select id as kahve_q from malzemeler \gset
select public.urun_kaydet(null, 'Espresso Q', jsonb_build_array(jsonb_build_object('malzeme_id', :'kahve_q', 'miktar', 9))) as urun_q \gset

-- ================================================================================================
-- 1) KURULUM FİYAT/MİKTAR KONTROLÜ
-- ================================================================================================
select pg_temp.ol('dddddddd-0000-0000-0000-000000000002','baristaP@x.com');
select pg_temp.fatura1('22222222-aaaa-0000-0000-000000000001', repeat('1', 64), 'SODA SADE 200ML', 24, 'ml', 348, :'soda') as f1 \gset
select pg_temp.dogrula((:'f1')::jsonb ->> 'durum' = 'bekliyor', 'soda satırı kuruluma düşmedi: ' || :'f1');
reset role;   -- satır kimliği barista/kurulumdan gizli; test yönetici olarak okur
select pg_temp.satir((:'f1')::jsonb) as f1_satir \gset
set role authenticated;

select pg_temp.ol('dddddddd-0000-0000-0000-000000000009','kurulumP@x.com');
-- Çarpan 1 (24 ml) → 14.500 ₺/litre: kontrol durdurur, hiçbir şey stoğa ya da deftere girmez
select pg_temp.hata_bekle(format($$select public.kurulum_satir_coz(%s, 'malzeme', %L, 1, null, null, null, true)$$,
  :'f1_satir', :'soda'), 'Fiyat tutmuyor');
reset role;
select pg_temp.dogrula((select durum = 'bekliyor' from belge_satirlari where id = :'f1_satir'), 'reddedilen satır stoğa girdi');
select pg_temp.dogrula((select count(*) = 0 from eslestirme_defteri where mekan_id = :'mekan_p'), 'reddedilen bağlama deftere yazıldı');
select pg_temp.dogrula((select count(*) = 0 from malzeme_hareketleri where mekan_id = :'mekan_p'), 'reddedilen bağlama stoğa girdi');
set role authenticated;
-- Doğru çarpan (1 şişe = 200 ml) → 4.800 ml, 72,50 ₺/litre (%3 fark) → geçer, deftere 200 yazılır
select public.kurulum_satir_coz(:f1_satir, 'malzeme', :'soda', 200, null, null, null, true);
reset role;
select pg_temp.dogrula((select stok_miktari = 4800 and durum = 'stokta' from belge_satirlari where id = :'f1_satir'), 'soda 4800 ml girmedi');
select pg_temp.dogrula((select fiyat = 72.50 from malzemeler where id = :'soda'), 'soda fiyatı 72,50 olmadı');
select pg_temp.dogrula((select carpan = 200 from eslestirme_defteri where mekan_id = :'mekan_p' and metin_anahtar = 'soda sade 200ml'),
  'deftere doğru çarpan yazılmadı');
set role authenticated;

-- Gerçek zam (süt 40 → 60 ₺/litre, %50): onaysız durur, "doğru" onayıyla geçer
select pg_temp.ol('dddddddd-0000-0000-0000-000000000002','baristaP@x.com');
select pg_temp.fatura1('22222222-aaaa-0000-0000-000000000002', repeat('2', 64), 'TAM YAĞLI SÜT 1L', 12, 'lt', 720, :'sut') as f2 \gset
reset role;
select pg_temp.satir((:'f2')::jsonb) as f2_satir \gset
set role authenticated;
select pg_temp.ol('dddddddd-0000-0000-0000-000000000009','kurulumP@x.com');
select pg_temp.hata_bekle(format($$select public.kurulum_satir_coz(%s, 'malzeme', %L, 1000, null, null, null, false)$$,
  :'f2_satir', :'sut'), 'kayıtlı fiyat 40,00');
select public.kurulum_satir_coz(:f2_satir, 'malzeme', :'sut', 1000, null, null, null, false, true);
reset role;
select pg_temp.dogrula((select stok_miktari = 12000 from belge_satirlari where id = :'f2_satir'), 'onaylı zam satırı girmedi');
select pg_temp.dogrula((select fiyat = 60 from malzemeler where id = :'sut'), 'onaylı zamla fiyat güncellenmedi');
set role authenticated;

-- Fiyatı hiç bilinmeyen malzeme (0 TL): kıyas yok, eskisi gibi geçer · takip dışı yolu değişmedi
select pg_temp.ol('dddddddd-0000-0000-0000-000000000001','patronP@x.com');
insert into malzemeler (ad, birim) values ('Peçete','adet');
select id as pecete from malzemeler where ad = 'Peçete' \gset
select pg_temp.ol('dddddddd-0000-0000-0000-000000000002','baristaP@x.com');
select pg_temp.fatura1('22222222-aaaa-0000-0000-000000000003', repeat('3', 64), 'PEÇETE 100LÜ', 2, 'adet', 80, :'pecete') as f3 \gset
reset role;
select pg_temp.satir((:'f3')::jsonb) as f3_satir \gset
set role authenticated;
select pg_temp.ol('dddddddd-0000-0000-0000-000000000009','kurulumP@x.com');
select public.kurulum_satir_coz(:f3_satir, 'malzeme', :'pecete', 100, null, null, null, false);
-- Patron ve barista kurulum işlemi yapamaz
select pg_temp.ol('dddddddd-0000-0000-0000-000000000001','patronP@x.com');
select pg_temp.hata_bekle(format($$select public.kurulum_satir_coz(%s, 'takip_disi', null, null, null, null, null, false)$$,
  :'f2_satir'), 'yalnızca kurulum');

-- ================================================================================================
-- 2) FATURA İPTALİ → BELGE DE İPTAL → AYNI BELGE YENİDEN YÜKLENEBİLİR
-- ================================================================================================
reset role;
select giris_id as f1_giris from belgeler where id = ((:'f1')::jsonb ->> 'id')::uuid \gset
set role authenticated;
-- Başka mekanın patronu iptal edemez
select pg_temp.ol('dddddddd-0000-0000-0000-000000000003','patronQ@x.com');
select pg_temp.hata_bekle(format($$select public.giris_iptal(%L)$$, :'f1_giris'), 'Kayıt bulunamadı');
-- Aynı dosya iptalden önce: reddedilir
select pg_temp.ol('dddddddd-0000-0000-0000-000000000002','baristaP@x.com');
select pg_temp.hata_bekle($$select pg_temp.fatura1(gen_random_uuid()::text, repeat('1', 64), 'SODA SADE 200ML', 24, 'ml', 348, null)$$,
  'daha önce yüklenmiş');
-- Patron iptal eder → belge de iptal, fiyat eskiye döner
select pg_temp.ol('dddddddd-0000-0000-0000-000000000001','patronP@x.com');
select public.giris_iptal(:'f1_giris');
reset role;
select pg_temp.dogrula((select iptal_zamani is not null and iptal_eden_ad = 'Pelin' from belgeler where id = ((:'f1')::jsonb ->> 'id')::uuid),
  'fatura iptal edildi ama belge açık kaldı');
select pg_temp.dogrula((select fiyat = 75 from malzemeler where id = :'soda'), 'iptal sonrası fiyat eskiye dönmedi');
set role authenticated;
-- Aynı dosya yeniden yüklenebilir (defterden otomatik, 200 çarpanla)
select pg_temp.ol('dddddddd-0000-0000-0000-000000000002','baristaP@x.com');
select public.belge_kaydet(jsonb_build_object(
    'istek_id', gen_random_uuid(), 'tur', 'fatura', 'kaynak', 'ocr', 'dosya_ozeti', repeat('1', 64), 'tedarikci', 'Metro Market',
    'tarih', public.bugun(), 'toplamlar', jsonb_build_object('genel', 348), 'okunan', jsonb_build_object('not', 'test'),
    'satirlar', jsonb_build_array(jsonb_build_object('metin', 'SODA SADE 200ML', 'miktar', 24, 'birim', 'ml',
      'tutar_haric', 348, 'kdv_orani', 0, 'sinif', 'eslesti', 'malzeme_id', :'soda', 'carpan', 200)))) as f1b \gset
select pg_temp.dogrula((:'f1b')::jsonb ->> 'durum' = 'tamam' and ((:'f1b')::jsonb ->> 'stoklanan')::int = 1,
  'iptal edilen fatura yeniden yüklenemedi: ' || :'f1b');
-- Satış/fire/sayım iptali (belgesiz) eskisi gibi çalışır
select public.giris_kaydet('fire', public.bugun(), 'Döküldü', jsonb_build_array(jsonb_build_object('malzeme_id', :'sut', 'miktar', 100))) as fire1 \gset
select public.giris_iptal(:'fire1');

-- ================================================================================================
-- 3) SATIŞ RAPORU → SATIŞ GİRİŞİ (stoğa işlenir)
-- ================================================================================================
insert into storage.objects (bucket_id, name) values
  ('fatura-belgeleri', :'mekan_p' || '/r1/rapor.jpg'), ('fatura-belgeleri', :'mekan_p' || '/r2/rapor.jpg');
select public.belge_kaydet(jsonb_build_object('istek_id', gen_random_uuid(), 'tur', 'satis_raporu', 'kaynak', 'dosya',
  'dosyalar', jsonb_build_array(:'mekan_p' || '/r1/rapor.jpg'))) ->> 'id' as rapor1 \gset
select public.belge_kaydet(jsonb_build_object('istek_id', gen_random_uuid(), 'tur', 'satis_raporu', 'kaynak', 'dosya',
  'dosyalar', jsonb_build_array(:'mekan_p' || '/r2/rapor.jpg'))) ->> 'id' as rapor2 \gset

-- Kurulum dışındakiler işleyemez
select pg_temp.ol('dddddddd-0000-0000-0000-000000000001','patronP@x.com');
select pg_temp.hata_bekle(format($$select public.kurulum_satis_raporu_isle(%L, public.bugun(), '[{"urun_id":"%s","miktar":1}]')$$,
  :'rapor1', :'latte'), 'yalnızca kurulum');

select pg_temp.ol('dddddddd-0000-0000-0000-000000000009','kurulumP@x.com');
-- Kuyrukta mekanın ürünleri de var (form için)
select pg_temp.dogrula((select bool_or(k -> 'urunler' @> jsonb_build_array(jsonb_build_object('ad', 'Latte')))
  from jsonb_array_elements(public.kurulum_kuyrugu()) k where k ->> 'mekan' = 'Kafe P'), 'kuyrukta ürünler yok');
-- Başka mekanın ürünü, kesirli adet, boş liste → reddedilir
select pg_temp.hata_bekle(format($$select public.kurulum_satis_raporu_isle(%L, public.bugun(), '[{"urun_id":"%s","miktar":1}]')$$,
  :'rapor1', :'urun_q'), 'bu mekana ait olmayan');
select pg_temp.hata_bekle(format($$select public.kurulum_satis_raporu_isle(%L, public.bugun(), '[{"urun_id":"%s","miktar":1.5}]')$$,
  :'rapor1', :'latte'), 'tam sayı');
select pg_temp.hata_bekle(format($$select public.kurulum_satis_raporu_isle(%L, public.bugun(), '[]')$$, :'rapor1'), 'En az bir');
select pg_temp.hata_bekle(format($$select public.kurulum_satis_raporu_isle(%L, public.bugun() + 1, '[{"urun_id":"%s","miktar":1}]')$$,
  :'rapor1', :'latte'), 'ileri olamaz');
-- 10 Latte (ikram dahil) → 180 g kahve, 2000 ml süt, 10 bardak
select public.kurulum_satis_raporu_isle(:'rapor1', public.bugun() - 1,
  jsonb_build_array(jsonb_build_object('urun_id', :'latte', 'miktar', 10))) as satis1 \gset
reset role;
select pg_temp.dogrula((select count(*) = 3 and sum(miktar) filter (where malzeme_id = :'kahve') = 180
  and sum(miktar) filter (where malzeme_id = :'sut') = 2000 and sum(miktar) filter (where malzeme_id = :'bardak') = 10
  from malzeme_hareketleri where giris_id = :'satis1'), 'satış raporu tarifle malzemeye çevrilmedi');
select pg_temp.dogrula((select tur = 'satis' and tarih = public.bugun() - 1 and mekan_id = :'mekan_p' from girisler where id = :'satis1'),
  'satış girişi yanlış');
select pg_temp.dogrula((select durum = 'tamam' and giris_id = :'satis1' from belgeler where id = :'rapor1'), 'rapor tamam/bağlı olmadı');
set role authenticated;
-- Aynı rapor ikinci kez işlenemez · aynı güne ikinci satış (çift sayım) reddedilir
select pg_temp.hata_bekle(format($$select public.kurulum_satis_raporu_isle(%L, public.bugun(), '[{"urun_id":"%s","miktar":1}]')$$,
  :'rapor1', :'latte'), 'zaten işlenmiş');
select pg_temp.hata_bekle(format($$select public.kurulum_satis_raporu_isle(%L, public.bugun() - 1, '[{"urun_id":"%s","miktar":1}]')$$,
  :'rapor2', :'latte'), 'satış zaten girilmiş');
-- Patron satışı iptal ederse rapor da iptal olur (yeniden yüklenip işlenebilir)
select pg_temp.ol('dddddddd-0000-0000-0000-000000000001','patronP@x.com');
select pg_temp.dogrula((select count(*) = 1 from girisler where id = :'satis1'), 'patron rapordan gelen satışı görmüyor');
select public.giris_iptal(:'satis1');
reset role;
select pg_temp.dogrula((select iptal_zamani is not null from belgeler where id = :'rapor1'), 'satış iptali raporu iptal etmedi');
set role authenticated;
-- İptalden sonra aynı gün ikinci rapor işlenebilir
select pg_temp.ol('dddddddd-0000-0000-0000-000000000009','kurulumP@x.com');
select public.kurulum_satis_raporu_isle(:'rapor2', public.bugun() - 1,
  jsonb_build_array(jsonb_build_object('urun_id', :'latte', 'miktar', 3)));

-- ================================================================================================
-- 4) STOK FARKI RAPORU (Kafe R, temiz veri)
--    Sayım 1 (B-14) → fatura (B-10) → fire (B-9) → sayım 2 (B-7) ve aynı gün satış
--    Sayım 1 gününün satışı ve faturası önceki döneme aittir (sayım gün sonu).
-- ================================================================================================
select pg_temp.ol('dddddddd-0000-0000-0000-000000000004','patronR@x.com');
select public.mekan_olustur('Kafe R','Rana');
select id as mekan_r, davet_kodu as kod_r from mekanlar \gset
insert into malzemeler (ad, birim, fiyat_haric, kdv_orani) values
  ('Kahve','g',1000,0), ('Süt','ml',40,0), ('Bardak','adet',2,0), ('Şeker','g',50,0), ('Su','adet',5,0), ('Şurup','ml',0,0);
select id as r_kahve from malzemeler where ad = 'Kahve' \gset
select id as r_sut from malzemeler where ad = 'Süt' \gset
select id as r_bardak from malzemeler where ad = 'Bardak' \gset
select id as r_seker from malzemeler where ad = 'Şeker' \gset
select id as r_su from malzemeler where ad = 'Su' \gset
select id as r_surup from malzemeler where ad = 'Şurup' \gset
select public.urun_kaydet(null, 'Latte', jsonb_build_array(
  jsonb_build_object('malzeme_id', :'r_kahve', 'miktar', 18), jsonb_build_object('malzeme_id', :'r_sut', 'miktar', 200),
  jsonb_build_object('malzeme_id', :'r_bardak', 'miktar', 1))) as r_latte \gset

-- Sayım yokken
select pg_temp.dogrula(public.stok_farki() ->> 'durum' = 'sayim_yok', 'sayım yokken rapor yanlış');

select public.giris_kaydet('sayim', public.bugun() - 14, null, jsonb_build_array(
  jsonb_build_object('malzeme_id', :'r_kahve', 'miktar', 1000), jsonb_build_object('malzeme_id', :'r_sut', 'miktar', 5000),
  jsonb_build_object('malzeme_id', :'r_bardak', 'miktar', 100), jsonb_build_object('malzeme_id', :'r_su', 'miktar', 10),
  jsonb_build_object('malzeme_id', :'r_surup', 'miktar', 700))) as sayim1 \gset
-- Sayım 1 günündeki satış ve fatura: önceki döneme ait, sayılmaz
select public.giris_kaydet('satis', public.bugun() - 14, null, jsonb_build_array(jsonb_build_object('urun_id', :'r_latte', 'miktar', 5)));
select public.fatura_kaydet(public.bugun() - 14, 'Metro', jsonb_build_array(
  jsonb_build_object('malzeme_id', :'r_kahve', 'miktar', 2000, 'tutar_kdv_haric', 2000, 'kdv_orani', 0)),
  '{"genel": 2000}', '[]');
-- Dönem içi: +1000 g kahve (fatura), iptal edilen fatura (sayılmaz), 40 g kahve firesi
select public.fatura_kaydet(public.bugun() - 10, 'Metro', jsonb_build_array(
  jsonb_build_object('malzeme_id', :'r_kahve', 'miktar', 1000, 'tutar_kdv_haric', 1000, 'kdv_orani', 0)),
  '{"genel": 1000}', '[]');
select public.fatura_kaydet(public.bugun() - 10, 'Metro', jsonb_build_array(
  jsonb_build_object('malzeme_id', :'r_kahve', 'miktar', 500, 'tutar_kdv_haric', 500, 'kdv_orani', 0)),
  '{"genel": 500}', '[]') as iptal_fatura \gset
select public.giris_iptal(:'iptal_fatura');
select pg_temp.ol('dddddddd-0000-0000-0000-000000000005','baristaR@x.com');
select public.mekana_katil(:'kod_r','Rüya');
select public.giris_kaydet('fire', public.bugun() - 9, 'Döküldü', jsonb_build_array(jsonb_build_object('malzeme_id', :'r_kahve', 'miktar', 40)));
-- Sayım 2 ve aynı günün satışı (gün sonu kuralı: sayıma dahil)
select public.giris_kaydet('sayim', public.bugun() - 7, null, jsonb_build_array(
  jsonb_build_object('malzeme_id', :'r_kahve', 'miktar', 1500), jsonb_build_object('malzeme_id', :'r_sut', 'miktar', 1000),
  jsonb_build_object('malzeme_id', :'r_bardak', 'miktar', 85), jsonb_build_object('malzeme_id', :'r_seker', 'miktar', 3000),
  jsonb_build_object('malzeme_id', :'r_surup', 'miktar', 500))) as sayim2 \gset
select public.giris_kaydet('satis', public.bugun() - 7, null, jsonb_build_array(jsonb_build_object('urun_id', :'r_latte', 'miktar', 20)));
-- Barista raporu göremez (fiyat içerir)
select pg_temp.hata_bekle($$select public.stok_farki()$$, 'yalnızca patron');

select pg_temp.ol('dddddddd-0000-0000-0000-000000000004','patronR@x.com');
select public.stok_farki()::text as rapor \gset
create temp table r as select * from jsonb_to_recordset((:'rapor')::jsonb -> 'satirlar') as x(
  ad text, durum text, baslangic numeric, gelen numeric, satis numeric, fire numeric, beklenen numeric, sayilan numeric,
  fark numeric, fark_tl numeric);
-- Kahve: 1000 + 1000 − 360 − 40 = 1600 beklenen, 1500 sayıldı → −100 g = −100 ₺
select pg_temp.dogrula((select baslangic = 1000 and gelen = 1000 and satis = 360 and fire = 40 and beklenen = 1600
  and sayilan = 1500 and fark = -100 and fark_tl = -100 and durum = 'tamam' from r where ad = 'Kahve'), 'kahve satırı yanlış: ' || :'rapor');
-- Süt: 5000 − 4000 = 1000 → fark 0 · Bardak: 100 − 20 = 80, 85 sayıldı → +5 = +10 ₺
select pg_temp.dogrula((select beklenen = 1000 and fark = 0 and fark_tl = 0 from r where ad = 'Süt'), 'süt satırı yanlış');
select pg_temp.dogrula((select beklenen = 80 and fark = 5 and fark_tl = 10 from r where ad = 'Bardak'), 'bardak satırı yanlış');
-- Şeker ilk kez sayıldı (kıyas yok) · Su bu sayımda atlandı · Şurup fiyatsız (fark var, TL yok)
select pg_temp.dogrula((select durum = 'ilk_sayim' and fark is null from r where ad = 'Şeker'), 'ilk sayım işaretlenmedi');
select pg_temp.dogrula((select durum = 'sayilmadi' and fark is null from r where ad = 'Su'), 'sayılmayan işaretlenmedi');
select pg_temp.dogrula((select fark = -200 and fark_tl is null from r where ad = 'Şurup'), 'fiyatsız malzeme yanlış');
select pg_temp.dogrula(((:'rapor')::jsonb ->> 'toplam_acik_tl')::numeric = -100 and ((:'rapor')::jsonb ->> 'toplam_fazla_tl')::numeric = 10
  and (:'rapor')::jsonb ->> 'bitis' = (public.bugun() - 7)::text and (:'rapor')::jsonb ->> 'baslangic' = (public.bugun() - 14)::text,
  'rapor toplamları/dönemi yanlış: ' || :'rapor');
select pg_temp.dogrula(jsonb_array_length((:'rapor')::jsonb -> 'uyarilar') = 1
  and (:'rapor')::jsonb -> 'uyarilar' ->> 0 like 'Fiyatı girilmemiş%', 'beklenmeyen uyarı: ' || :'rapor');
select pg_temp.dogrula(jsonb_array_length((:'rapor')::jsonb -> 'sayimlar') = 2, 'sayım listesi yanlış');
-- Önceki sayım seçilirse: kıyaslanacak daha eski sayım yok → hepsi ilk sayım
select pg_temp.dogrula((select bool_and(x ->> 'durum' <> 'tamam') from jsonb_array_elements(public.stok_farki(:'sayim1') -> 'satirlar') x),
  'eski sayım seçimi yanlış');
-- Başka mekanın sayımı seçilemez / görülemez
select pg_temp.ol('dddddddd-0000-0000-0000-000000000003','patronQ@x.com');
select pg_temp.dogrula(public.stok_farki(:'sayim2') ->> 'durum' = 'sayim_yok', 'başka mekanın stok farkı görüldü');

-- Uyarılar: aynı gün ikinci satış (çift sayım şüphesi), bekleyen fatura, bekleyen satış raporu
select pg_temp.ol('dddddddd-0000-0000-0000-000000000004','patronR@x.com');
select public.giris_kaydet('satis', public.bugun() - 7, null, jsonb_build_array(jsonb_build_object('urun_id', :'r_latte', 'miktar', 1)));
insert into storage.objects (bucket_id, name) values ('fatura-belgeleri', :'mekan_r' || '/r9/rapor.jpg');
select public.belge_kaydet(jsonb_build_object('istek_id', gen_random_uuid(), 'tur', 'satis_raporu', 'kaynak', 'dosya',
  'dosyalar', jsonb_build_array(:'mekan_r' || '/r9/rapor.jpg')));
select pg_temp.fatura1('22222222-aaaa-0000-0000-000000000009', repeat('9', 64), 'BİLİNMEYEN ÜRÜN', 1, 'adet', 10, null);
select public.stok_farki()::text as rapor2 \gset
select pg_temp.dogrula((select count(*) = 4 from jsonb_array_elements_text((:'rapor2')::jsonb -> 'uyarilar') u
  where u like '%fatura eşleştirme bekliyor%' or u like '%satış raporu henüz işlenmedi%'
     or u like '%birden fazla satış girişi%' or u like 'Fiyatı girilmemiş%'), 'uyarılar eksik: ' || :'rapor2');
-- Hiç satış girilmemiş dönem uyarısı (Kafe P'de sayım + önceki sayım, satış yok)
select pg_temp.ol('dddddddd-0000-0000-0000-000000000001','patronP@x.com');
select public.giris_kaydet('sayim', public.bugun() - 30, null, jsonb_build_array(jsonb_build_object('malzeme_id', :'bardak', 'miktar', 10)));
select public.giris_kaydet('sayim', public.bugun() - 20, null, jsonb_build_array(jsonb_build_object('malzeme_id', :'bardak', 'miktar', 10)));
select pg_temp.dogrula((select bool_or(u like '%hiç satış girilmemiş%') from jsonb_array_elements_text(public.stok_farki() -> 'uyarilar') u),
  'satışsız dönem uyarısı yok');

reset role;
