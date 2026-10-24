-- 23_kdv_sade_eslesme.sql testleri: KDV kimseye sorulmaz, belirsiz fiyat stoğu durdurmaz, eşleşmeyen satır sessizce
-- geçilir, patron fiyatı tek alanla onaylar. Senaryolar: (a) KDV'si net fatura, (b) KDV'si okunamayan fatura,
-- (c) onaylı fiyatı olmayan ürün, (d) toplamı tutmayan fatura, (e) karekodlu fatura (sunucu tarafı), eski kayıtlar.
\set ON_ERROR_STOP 1
insert into auth.users values
 ('f4f4f4f4-0000-0000-0000-000000000001','patronKD@x.com'),
 ('f4f4f4f4-0000-0000-0000-000000000002','baristaKD@x.com'),
 ('f4f4f4f4-0000-0000-0000-000000000003','patronKQ@x.com'),
 ('f4f4f4f4-0000-0000-0000-000000000009','kurulumKD@x.com');
insert into public.kurulum_hesaplari (user_id) values ('f4f4f4f4-0000-0000-0000-000000000009');

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
create or replace function pg_temp.fatura(istek text, ozet text, toplamlar jsonb, satirlar jsonb, ettn text default null)
returns jsonb language sql as $$
  select public.belge_kaydet(jsonb_build_object(
    'istek_id', istek, 'tur', 'fatura', 'kaynak', 'ai', 'dosya_ozeti', ozet, 'tedarikci', 'Toptan Gıda',
    'tedarikci_vkn', '5555555555', 'tarih', public.bugun(), 'ettn', ettn,
    'toplamlar', toplamlar, 'okunan', jsonb_build_object('not', 'test'), 'satirlar', satirlar)) $$;
-- Barista sayıp onayladığı eşleşmiş satır (miktar: belge birimi; carpan: stok birimine)
create or replace function pg_temp.kalem(metin text, miktar numeric, malzeme uuid, carpan numeric, ek jsonb) returns jsonb
language sql as $$
  select jsonb_build_object('metin', metin, 'miktar', miktar, 'birim', 'adet', 'sinif', 'eslesti', 'malzeme_id', malzeme,
    'carpan', carpan, 'barista_onayi', true, 'gelen_miktar', miktar, 'sayim', 'sayildi', 'teslimat', 'tam') || ek $$;
create or replace function pg_temp.satir(belge jsonb, sira int) returns public.belge_satirlari language sql as $$
  select * from public.belge_satirlari where belge_id = (belge ->> 'id')::uuid and sira = $2 $$;

set role authenticated;

-- ===== Kafe KD: patron, barista; Süt (fiyatlı), Kahve (fiyatlı), Kakao (hiç fiyatı yok) =====
select pg_temp.ol('f4f4f4f4-0000-0000-0000-000000000001','patronKD@x.com');
select public.mekan_olustur('Kafe KD','Deniz');
select id as mekan, davet_kodu as kod from mekanlar where ad = 'Kafe KD' \gset
insert into malzemeler (ad, birim, fiyat_haric, kdv_orani) values ('Süt','ml',40,1);
insert into malzemeler (ad, birim, fiyat) values ('Kahve','g',1000);
insert into malzemeler (ad, birim) values ('Kakao','g');
select id as sut from malzemeler where ad = 'Süt' and mekan_id = :'mekan' \gset
select id as kahve from malzemeler where ad = 'Kahve' and mekan_id = :'mekan' \gset
select id as kakao from malzemeler where ad = 'Kakao' and mekan_id = :'mekan' \gset
select pg_temp.ol('f4f4f4f4-0000-0000-0000-000000000002','baristaKD@x.com');
select public.mekana_katil(:'kod','Bora');

-- ===== Eski kayıt (23'ten önceki biçim): oranlı satır, onaylı fiyat. Bozulmadan açılmalı/hesaplanmalı =====
reset role;
select pg_temp.ol('f4f4f4f4-0000-0000-0000-000000000001','patronKD@x.com');
set role authenticated;
select (public.fiyat_kontrolleri()) as fk0 \gset
select pg_temp.dogrula(jsonb_array_length((:'fk0')::jsonb) = 0, 'başlangıçta kontrol bekleyen olmamalı');

-- ================================================================================================
-- (a) KDV'si net okunan fatura: 12 L süt, 480 hariç %1 → 484,80. Fiyat onaylı, kontrol yok.
-- ================================================================================================
select pg_temp.ol('f4f4f4f4-0000-0000-0000-000000000002','baristaKD@x.com');
select pg_temp.fatura('41414141-0000-0000-0000-000000000001', repeat('1', 64),
  jsonb_build_object('genel', 484.80, 'kdv_haric', 480),
  jsonb_build_array(pg_temp.kalem('SÜT 1L', 12, :'sut', 1000, jsonb_build_object('tutar_haric', 480, 'kdv_orani', 1)))) as fa \gset
select pg_temp.dogrula((:'fa')::jsonb ->> 'durum' = 'tamam' and ((:'fa')::jsonb ->> 'toplam_tutuyor')::boolean, '(a) tamamlanmadı: ' || :'fa');
reset role;
select pg_temp.dogrula((select durum = 'stokta' and not fiyat_kontrol from pg_temp.satir((:'fa')::jsonb, 1)), '(a) satır stokta/onaylı değil');
select pg_temp.dogrula((select fiyat = 40.40 and kdv_orani = 1 from malzemeler where id = :'sut'), '(a) fiyat 40,40 değil');
select pg_temp.dogrula((select tutar = 484.80 and uyarilar is null from giris_kalemleri where malzeme_id = :'sut'),
  '(a) giriş kalemi KDV dahil tutarla yazılmadı');

-- ================================================================================================
-- (b) KDV'si okunamayan ama ürün ve miktarı net fatura: 2 kg kahve, 2.100 hariç, oran yok; toplam 2.520
--     (oran bilinmiyor). Hariç toplam faturadaki hariç toplamı tutuyor → stoğa girer, fiyat kontrol bekler.
--     Oran UYDURULMAZ: kahvenin fiyatı (1.000 ₺/kg) değişmez.
-- ================================================================================================
reset role;
select pg_temp.ol('f4f4f4f4-0000-0000-0000-000000000002','baristaKD@x.com');
set role authenticated;
select pg_temp.fatura('41414141-0000-0000-0000-000000000002', repeat('2', 64),
  jsonb_build_object('genel', 2520, 'kdv_haric', 2100),
  jsonb_build_array(pg_temp.kalem('ESPRESSO ÇEKİRDEK 1KG', 2, :'kahve', 1000, jsonb_build_object('tutar_haric', 2100)))) as fb \gset
select pg_temp.dogrula((:'fb')::jsonb ->> 'durum' = 'tamam' and ((:'fb')::jsonb ->> 'toplam_tutuyor')::boolean,
  '(b) KDV belirsizliği yüzünden durdu: ' || :'fb');
reset role;
select pg_temp.dogrula((select durum = 'stokta' and fiyat_kontrol and kdv_orani is null and stok_miktari = 2000
  from pg_temp.satir((:'fb')::jsonb, 1)), '(b) satır stoğa girmedi ya da kontrol işaretlenmedi');
select pg_temp.dogrula((select sum(miktar) = 2000 from malzeme_hareketleri where malzeme_id = :'kahve'), '(b) stok 2 kg artmadı');
select pg_temp.dogrula((select fiyat = 1000 and kdv_orani is null from malzemeler where id = :'kahve'), '(b) fiyat değişti ya da oran uyduruldu');
select pg_temp.dogrula((select count(*) = 0 from fiyat_gecmisi where malzeme_id = :'kahve' and kaynak = 'fatura'),
  '(b) doğrulanmamış fiyat geçmişe yazıldı');
select pg_temp.dogrula((select tutar is null and 'fiyat_kontrol' = any(uyarilar) and belge_satir_id is not null
  from giris_kalemleri where malzeme_id = :'kahve'), '(b) giriş kalemi kontrol beklemiyor');

-- ================================================================================================
-- (c) Daha önce onaylı fiyatı olmayan ürün: 1 kg kakao, KDV yok → TL toplamına girmez, ayrı listelenir.
-- ================================================================================================
select pg_temp.ol('f4f4f4f4-0000-0000-0000-000000000002','baristaKD@x.com');
set role authenticated;
select pg_temp.fatura('41414141-0000-0000-0000-000000000003', repeat('3', 64),
  jsonb_build_object('genel', 300, 'kdv_haric', 250),
  jsonb_build_array(pg_temp.kalem('KAKAO 1KG', 1, :'kakao', 1000, jsonb_build_object('tutar_haric', 250)))) as fc \gset
reset role;
select pg_temp.dogrula((select fiyat_kontrol and durum = 'stokta' from pg_temp.satir((:'fc')::jsonb, 1)), '(c) kakao stoğa girmedi');
select pg_temp.dogrula((select coalesce(fiyat, 0) = 0 from malzemeler where id = :'kakao'), '(c) kakaoya fiyat uyduruldu');
select pg_temp.ol('f4f4f4f4-0000-0000-0000-000000000001','patronKD@x.com');
set role authenticated;
select public.fiyat_kontrolleri() as fk1 \gset
select pg_temp.dogrula(jsonb_array_length((:'fk1')::jsonb) = 2, '(c) iki kalem kontrol beklemeli: ' || :'fk1');
select pg_temp.dogrula((select (x ->> 'onayli_fiyat')::numeric = 0 and (x ->> 'faturadaki')::numeric = 1000
  from jsonb_array_elements((:'fk1')::jsonb) x where x ->> 'malzeme' = 'Kakao'), '(c) kakao onaylı fiyatsız listelenmedi');
select pg_temp.dogrula(((public.gunluk_kontrol()) ->> 'fiyat_kontrol')::int = 2, '(c) günlük kontrolde sayı 2 değil');
-- Onaylı fiyatı yoksa "kayıtlı fiyat doğru" olmaz; tutarla onaylanır.
select (x ->> 'id') as kakao_kalem from jsonb_array_elements((:'fk1')::jsonb) x where x ->> 'malzeme' = 'Kakao' \gset
select (x ->> 'id') as kahve_kalem from jsonb_array_elements((:'fk1')::jsonb) x where x ->> 'malzeme' = 'Kahve' \gset
select pg_temp.hata_bekle(format('select public.fiyat_kontrol_coz(%s)', :'kakao_kalem'), 'onaylı fiyatı yok');
-- Barista fiyat onaylayamaz
select pg_temp.ol('f4f4f4f4-0000-0000-0000-000000000002','baristaKD@x.com');
select pg_temp.hata_bekle(format('select public.fiyat_kontrol_coz(%s, 300)', :'kakao_kalem'), 'yalnız patron');
select pg_temp.hata_bekle('select public.fiyat_kontrolleri()', 'yalnız patrona');
-- Başka mekanın patronu bu kalemi göremez ve onaylayamaz (izolasyon)
reset role;
select pg_temp.ol('f4f4f4f4-0000-0000-0000-000000000003','patronKQ@x.com');
set role authenticated;
select public.mekan_olustur('Kafe KQ','Kaan');
select pg_temp.dogrula(jsonb_array_length(public.fiyat_kontrolleri()) = 0, 'başka mekanın kontrolleri görünüyor');
select pg_temp.hata_bekle(format('select public.fiyat_kontrol_coz(%s, 300)', :'kakao_kalem'), 'bulunamadı');
-- Patron kakaoyu faturadaki tutarla (KDV dahil 300 ₺, 1 kg) onaylar → 300 ₺/kg, kontrol kapanır
select pg_temp.ol('f4f4f4f4-0000-0000-0000-000000000001','patronKD@x.com');
select public.fiyat_kontrol_coz((:'kakao_kalem')::bigint, 300);
reset role;
select pg_temp.dogrula((select fiyat = 300 and kdv_orani is null from malzemeler where id = :'kakao'), '(c) onaylanan fiyat 300 değil');
select pg_temp.dogrula((select tutar = 300 and 'fiyat_onaylandi' = any(uyarilar) and not ('fiyat_kontrol' = any(uyarilar))
  from giris_kalemleri where id = (:'kakao_kalem')::bigint), '(c) kalem onaylanmadı');
select pg_temp.dogrula((select count(*) = 1 from islem_gecmisi where mekan_id = :'mekan' and tur = 'fiyat_onay'), '(c) onay geçmişe yazılmadı');
-- Kahve: "kayıtlı fiyat doğru" → 1.000 ₺/kg kalır
select pg_temp.ol('f4f4f4f4-0000-0000-0000-000000000001','patronKD@x.com');
set role authenticated;
select public.fiyat_kontrol_coz((:'kahve_kalem')::bigint);
select pg_temp.dogrula(jsonb_array_length(public.fiyat_kontrolleri()) = 0, 'onaydan sonra liste boşalmadı');
select pg_temp.hata_bekle(format('select public.fiyat_kontrol_coz(%s)', :'kahve_kalem'), 'zaten onaylanmış');
reset role;
select pg_temp.dogrula((select fiyat = 1000 from malzemeler where id = :'kahve'), '(b) kayıtlı fiyat değişti');

-- ================================================================================================
-- (d) Toplamı tutmayan fatura: okunan genel 999, satırlar 484,80 + ? . Kullanıcıya vergi sorulmaz (hata yok),
--     fatura "toplam tutmuyor" işaretlenir; SAYILAN süt stoğa girer (fiyat kontrol bekler), SAYILMAYAN kahve bekler.
-- ================================================================================================
select pg_temp.ol('f4f4f4f4-0000-0000-0000-000000000002','baristaKD@x.com');
set role authenticated;
select pg_temp.fatura('41414141-0000-0000-0000-000000000004', repeat('4', 64),
  jsonb_build_object('genel', 999),
  jsonb_build_array(
    pg_temp.kalem('SÜT 1L', 12, :'sut', 1000, jsonb_build_object('tutar_haric', 480, 'kdv_orani', 1)),
    pg_temp.kalem('ESPRESSO ÇEKİRDEK 1KG', 1, :'kahve', 1000, jsonb_build_object('tutar_haric', 1000, 'kdv_orani', 1,
      'gelen_miktar', null, 'sayim', 'sayilmadi', 'teslimat', null)))) as fd \gset
select pg_temp.dogrula(not ((:'fd')::jsonb ->> 'toplam_tutuyor')::boolean and (:'fd')::jsonb ->> 'durum' = 'bekliyor',
  '(d) fatura işaretlenmedi: ' || :'fd');
reset role;
select pg_temp.dogrula((select durum = 'stokta' and fiyat_kontrol from pg_temp.satir((:'fd')::jsonb, 1)), '(d) sayılan süt stoğa girmedi');
select pg_temp.dogrula((select durum = 'bekliyor' and bekleme_sebebi = 'toplam' from pg_temp.satir((:'fd')::jsonb, 2)),
  '(d) sayılmayan kahve beklemedi');
select pg_temp.dogrula((select toplam_tutuyor = false from belgeler where id = ((:'fd')::jsonb ->> 'id')::uuid), '(d) belge işaretli değil');
select pg_temp.dogrula((select fiyat = 40.40 from malzemeler where id = :'sut'), '(d) doğrulanmamış fiyat süte yazıldı');
select pg_temp.dogrula((select sum(miktar) = 24000 from malzeme_hareketleri where malzeme_id = :'sut'), '(d) süt stoğu 24 L değil');
-- Kurulum bekleyen satırı KDV sormadan bağlar (tutar KDV dahil, isteğe bağlı)
select (pg_temp.satir((:'fd')::jsonb, 2)).id as fd2 \gset
select pg_temp.ol('f4f4f4f4-0000-0000-0000-000000000009','kurulumKD@x.com');
set role authenticated;
select pg_temp.dogrula((select (x -> 'satirlar' -> 1 ->> 'tutar_dahil')::numeric = 1010
  from jsonb_array_elements(public.kurulum_kuyrugu()) m, jsonb_array_elements(m -> 'belgeler') x
  where x ->> 'id' = (:'fd')::jsonb ->> 'id'), 'kuyrukta KDV dahil tutar yok');
select public.kurulum_satir_bagla(:'fd2', :'kahve', 1000, 1, 1010, false);
reset role;
select pg_temp.dogrula((select durum = 'stokta' and not fiyat_kontrol and tutar_dahil = 1010 from pg_temp.satir((:'fd')::jsonb, 2)),
  '(d) kurulum bağlaması KDV sormadan olmadı');
select pg_temp.dogrula((select durum = 'tamam' from belgeler where id = ((:'fd')::jsonb ->> 'id')::uuid), '(d) belge tamamlanmadı');

-- ================================================================================================
-- (e) Karekodlu fatura: karekoddaki oran telefonda satıra yazılır (JS testi); sunucu fişi ve faturayı aynı kurallarla
--     işler. Burada: fiş satırı yalnız KDV dahil tutarla (oran yok) → toplam tutar, fiyat dahil tutardan, oran boş.
-- ================================================================================================
select pg_temp.ol('f4f4f4f4-0000-0000-0000-000000000002','baristaKD@x.com');
set role authenticated;
select pg_temp.fatura('41414141-0000-0000-0000-000000000005', repeat('5', 64),
  jsonb_build_object('genel', 494.40),
  jsonb_build_array(pg_temp.kalem('SÜT 1L', 12, :'sut', 1000, jsonb_build_object('tutar_dahil', 494.40))),
  '5e5e5e5e-1111-2222-3333-444444444444') as fe \gset
select pg_temp.dogrula((:'fe')::jsonb ->> 'durum' = 'tamam' and ((:'fe')::jsonb ->> 'toplam_tutuyor')::boolean, '(e) fiş tamamlanmadı: ' || :'fe');
reset role;
select pg_temp.dogrula((select not fiyat_kontrol and tutar_dahil = 494.40 and kdv_orani is null from pg_temp.satir((:'fe')::jsonb, 1)),
  '(e) dahil tutarlı satır onaylı değil');
select pg_temp.dogrula((select fiyat = 41.20 and kdv_orani is null and fiyat_haric is null from malzemeler where id = :'sut'),
  '(e) fiyat dahil tutardan (41,20) hesaplanmadı ya da oran uyduruldu');
-- Aynı karekodlu (ETTN) fatura ikinci kez kaydedilemez
select pg_temp.ol('f4f4f4f4-0000-0000-0000-000000000002','baristaKD@x.com');
set role authenticated;
select pg_temp.hata_bekle($q$select pg_temp.fatura('41414141-0000-0000-0000-000000000006', repeat('6', 64),
  '{"genel": 494.40}'::jsonb, '[{"metin":"x","sinif":"belirsiz"}]'::jsonb, '5e5e5e5e-1111-2222-3333-444444444444')$q$, 'daha önce yüklenmiş');

-- ================================================================================================
-- Eşleşmeyen satır (stok listesinde karşılığı yok): stoğa girmez, sessizce geçilir, belgeyi bekletmez.
-- ================================================================================================
select pg_temp.fatura('41414141-0000-0000-0000-000000000007', repeat('7', 64),
  jsonb_build_object('genel', 545.40),
  jsonb_build_array(pg_temp.kalem('SÜT 1L', 12, :'sut', 1000, jsonb_build_object('tutar_dahil', 494.40)),
    jsonb_build_object('metin', 'DETERJAN 5L', 'miktar', 1, 'birim', 'adet', 'tutar_dahil', 51, 'sinif', 'belirsiz'))) as fu \gset
select pg_temp.dogrula((:'fu')::jsonb ->> 'durum' = 'tamam' and ((:'fu')::jsonb ->> 'takip_disi')::int = 1,
  'eşleşmeyen satır belgeyi bekletti: ' || :'fu');
reset role;
select pg_temp.dogrula((select durum = 'takip_disi' and cozen = 'eslesmedi' and malzeme_id is null
  from pg_temp.satir((:'fu')::jsonb, 2)), 'eşleşmeyen satır sessizce geçilmedi');
select pg_temp.dogrula((select count(*) = 0 from eslestirme_defteri where mekan_id = :'mekan' and metin_anahtar = metin_anahtari('DETERJAN 5L')),
  'eşleşmeyen satır deftere yazıldı');
-- Çarpan sayımdan çıktıysa (paket içi bilinmiyordu) deftere yazılmaz
select pg_temp.ol('f4f4f4f4-0000-0000-0000-000000000002','baristaKD@x.com');
set role authenticated;
select pg_temp.fatura('41414141-0000-0000-0000-000000000008', repeat('8', 64),
  jsonb_build_object('genel', 486.00),
  jsonb_build_array(jsonb_build_object('metin', 'SÜT KOLİ', 'miktar', 12, 'birim', 'diger', 'tutar_dahil', 486.00,
    'sinif', 'eslesti', 'malzeme_id', :'sut', 'carpan', 1000, 'barista_onayi', true, 'carpan_sayimdan', true,
    'gelen_miktar', 12, 'sayim', 'sayildi', 'teslimat', 'tam'))) as fs \gset
reset role;
select pg_temp.dogrula((select durum = 'stokta' from pg_temp.satir((:'fs')::jsonb, 1)), 'sayımdan çarpanlı satır stoğa girmedi');
select pg_temp.dogrula((select count(*) = 0 from eslestirme_defteri where mekan_id = :'mekan' and metin_anahtar = metin_anahtari('SÜT KOLİ')),
  'sayımdan çıkan çarpan deftere yazıldı');

-- ================================================================================================
-- Elle mal girişi: oran uydurulmaz (eskiden %0 / malzemenin oranı varsayılıyordu)
-- ================================================================================================
select pg_temp.ol('f4f4f4f4-0000-0000-0000-000000000002','baristaKD@x.com');
set role authenticated;
select public.elle_mal_kabul('41414141-0000-0000-0000-0000000000e1', 'Market', jsonb_build_array(
  jsonb_build_object('malzeme_id', :'sut', 'miktar', 1000, 'tutar', 42)));
reset role;
select pg_temp.dogrula((select kdv_orani is null and tutar_kdv_haric is null and tutar = 42 from giris_kalemleri
  where satir_metni = 'Elle giriş' and malzeme_id = :'sut'), 'elle girişte oran uyduruldu');
select pg_temp.dogrula((select fiyat = 42 and kdv_orani is null from malzemeler where id = :'sut'), 'elle giriş fiyatı 42 değil');

-- Eski kayıtlar: 23 öncesi oranlı kalemler fiyat değişimleri ve stok farkı hesabında çalışmaya devam eder
select pg_temp.ol('f4f4f4f4-0000-0000-0000-000000000001','patronKD@x.com');
set role authenticated;
select pg_temp.dogrula(jsonb_typeof(public.fiyat_degisimleri()) = 'array', 'fiyat değişimleri açılmadı');
select pg_temp.dogrula(jsonb_typeof(public.stok_durumu()) = 'object', 'stok durumu açılmadı');
reset role;
