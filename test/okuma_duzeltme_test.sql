-- 31_okuma_duzeltme.sql: yanlış okunan miktar faturanın kendi rakamlarından düzelir; gerçek zam ve baristanın farklı
-- saydığı satır düzeltilmez.
\set ON_ERROR_STOP 1
insert into auth.users values
 ('c7c7c7c7-0000-0000-0000-000000000001','patronOD@x.com'),
 ('c7c7c7c7-0000-0000-0000-000000000002','baristaOD@x.com');
create or replace function pg_temp.ol(u text, e text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, false), set_config('request.jwt.claim.email', e, false) $$;
create or replace function pg_temp.dogrula(b boolean, mesaj text) returns void language plpgsql as $$
begin if not coalesce(b, false) then raise exception '%', mesaj; end if; end $$;
-- Süt faturası: okunan miktar, okunan birim fiyat, satır tutarı (KDV dahil), barista sayımı
create or replace function pg_temp.sut(ozet text, tarih date, miktar numeric, bf numeric, tutar numeric, malzeme uuid,
  gelen numeric default null) returns jsonb language sql as $$
  select public.belge_kaydet(jsonb_build_object(
    'istek_id', gen_random_uuid(), 'tur', 'fatura', 'kaynak', 'ai', 'dosya_ozeti', ozet, 'tedarikci', 'Muğla Süt',
    'tedarikci_vkn', '6230451187', 'tarih', tarih, 'toplamlar', jsonb_build_object('genel', tutar),
    'okunan', jsonb_build_object('not', 'test'), 'satirlar', jsonb_build_array(jsonb_build_object(
      'metin', 'SÜT 1 L', 'miktar', miktar, 'birim', 'adet', 'birim_fiyat', bf, 'tutar_dahil', tutar, 'sinif', 'eslesti',
      'malzeme_id', malzeme, 'carpan', 1000, 'barista_onayi', true, 'gelen_miktar', coalesce(gelen, miktar),
      'sayim', 'sayildi', 'teslimat', case when gelen is null or gelen = miktar then 'tam' else 'teslimat_farki' end)))) $$;
create or replace function pg_temp.bsatir(r jsonb) returns belge_satirlari language sql as $$
  select * from belge_satirlari where belge_id = (r ->> 'id')::uuid $$;

set role authenticated;
select pg_temp.ol('c7c7c7c7-0000-0000-0000-000000000001','patronOD@x.com');
select public.mekan_olustur('Kafe OD','Berke');
select id as ma, davet_kodu as kod from mekanlar where ad = 'Kafe OD' \gset
insert into malzemeler (ad, birim, fiyat) values ('Süt','ml',58);
select id as sut from malzemeler where ad = 'Süt' and mekan_id = :'ma' \gset
select pg_temp.ol('c7c7c7c7-0000-0000-0000-000000000002','baristaOD@x.com');
select public.mekana_katil(:'kod','Selen');

-- Referans: tedarikçinin doğru okunmuş faturaları (36 L × 58 TL); miktar ortancası için üç fatura
select pg_temp.sut(repeat('1', 64), public.bugun() - 9, 36, 58, 2088, :'sut') as f0 \gset
select pg_temp.sut(repeat('2', 64), public.bugun() - 8, 36, 58, 2088, :'sut') as f01 \gset
select pg_temp.sut(repeat('3', 64), public.bugun() - 7, 36, 58, 2088, :'sut') as f02 \gset
reset role;
select pg_temp.dogrula((pg_temp.bsatir(:'f02')).durum = 'stokta', 'referans faturalar stoğa girmedi');

-- A) Miktar 3 okundu, birim fiyat 58 doğru, tutar 2.088 → 36 (birim fiyattan)
set role authenticated;
select pg_temp.sut(repeat('a', 64), public.bugun() - 6, 3, 58, 2088, :'sut') as fa \gset
reset role;
select pg_temp.dogrula((pg_temp.bsatir(:'fa')).durum = 'stokta' and (pg_temp.bsatir(:'fa')).miktar = 36
  and (pg_temp.bsatir(:'fa')).okunan_miktar = 3 and (pg_temp.bsatir(:'fa')).teslimat = 'okuma_hatasi'
  and (pg_temp.bsatir(:'fa')).stok_miktari = 36000, 'A: birim fiyattan düzeltilmedi: ' || to_jsonb(pg_temp.bsatir(:'fa'))::text);
select pg_temp.dogrula((:'fa')::jsonb ->> 'durum' = 'tamam', 'A: belge durumu tamam değil');

-- B) Koli karışması: 3 okundu, birim fiyat da 696 (koli fiyatı) okundu → 12'li koli → 36
set role authenticated;
select pg_temp.sut(repeat('b', 64), public.bugun() - 5, 3, 696, 2088, :'sut') as fb \gset
reset role;
select pg_temp.dogrula((pg_temp.bsatir(:'fb')).durum = 'stokta' and (pg_temp.bsatir(:'fb')).miktar = 36
  and (pg_temp.bsatir(:'fb')).stok_miktari = 36000, 'B: koli katı düzeltilmedi: ' || to_jsonb(pg_temp.bsatir(:'fb'))::text);

-- C) Gerçek zam: 36 L × 80 TL (%38) — okuma doğru; düzeltilmez, kontrolde kalır
set role authenticated;
select pg_temp.sut(repeat('c', 64), public.bugun() - 4, 36, 80, 2880, :'sut') as fc \gset
reset role;
select pg_temp.dogrula((pg_temp.bsatir(:'fc')).durum = 'bekliyor' and (pg_temp.bsatir(:'fc')).miktar = 36,
  'C: gerçek zam miktar diye düzeltildi: ' || to_jsonb(pg_temp.bsatir(:'fc'))::text);

-- D) Barista "Farklı geldi" deyip 30 saydı (okunan 3): baristanın sayımı esas, otomatik düzeltme yok
set role authenticated;
select pg_temp.sut(repeat('d', 64), public.bugun() - 3, 3, 58, 2088, :'sut', 30) as fd \gset
reset role;
select pg_temp.dogrula((pg_temp.bsatir(:'fd')).okunan_miktar is null and (pg_temp.bsatir(:'fd')).miktar <> 36,
  'D: baristanın saydığı satır otomatik düzeltildi: ' || to_jsonb(pg_temp.bsatir(:'fd'))::text);

-- E) Stok: A ve B 36'şar litre girdi (toplam 3 referans + A + B = 180 L)
select pg_temp.dogrula((select sum(h.miktar) from malzeme_hareketleri h join girisler g on g.id = h.giris_id
  where g.mekan_id = :'ma' and g.tur = 'fatura' and g.iptal_zamani is null) >= 180000, 'E: düzeltilen satırlar stoğa girmedi');
