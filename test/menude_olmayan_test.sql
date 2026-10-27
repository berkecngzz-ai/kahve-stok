-- 32_menude_olmayan.sql: menüye girilmemiş ürün kaydedilmez, uyarıya/rapora girmez; menüdeki reçetesiz ürün uyarılır.
\set ON_ERROR_STOP 1
insert into auth.users values
 ('d4d4d4d4-0000-0000-0000-000000000001','patronMO@x.com'),
 ('d4d4d4d4-0000-0000-0000-000000000002','baristaMO@x.com'),
 ('d4d4d4d4-0000-0000-0000-000000000003','patronMO2@x.com');

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
-- Fatura: barista saydı, eşleşmiş satırlar (tutar KDV dahil)
create or replace function pg_temp.fatura(ozet text, tarih date, genel numeric, satirlar jsonb) returns jsonb language sql as $$
  select public.belge_kaydet(jsonb_build_object(
    'istek_id', gen_random_uuid(), 'tur', 'fatura', 'kaynak', 'ai', 'dosya_ozeti', ozet, 'tedarikci', 'Toptan Gıda',
    'tedarikci_vkn', '5555555555', 'tarih', tarih, 'toplamlar', jsonb_build_object('genel', genel),
    'okunan', jsonb_build_object('not', 'test'), 'satirlar', satirlar)) $$;
create or replace function pg_temp.kalem(metin text, miktar numeric, birim text, malzeme uuid, carpan numeric, tutar numeric) returns jsonb
language sql as $$
  select jsonb_build_object('metin', metin, 'miktar', miktar, 'birim', birim, 'sinif', 'eslesti', 'malzeme_id', malzeme,
    'carpan', carpan, 'barista_onayi', true, 'gelen_miktar', miktar, 'sayim', 'sayildi', 'teslimat', 'tam', 'tutar_dahil', tutar) $$;
-- Satış raporu belgesi (dosyası depoda)
create or replace function pg_temp.rapor(mekan uuid) returns uuid language plpgsql as $$
declare v_yol text := mekan || '/' || gen_random_uuid() || '/rapor.csv';
begin
  execute 'reset role';
  insert into storage.objects (bucket_id, name) values ('fatura-belgeleri', v_yol);
  execute 'set role authenticated';
  return (public.belge_kaydet(jsonb_build_object('istek_id', gen_random_uuid(), 'tur', 'satis_raporu', 'kaynak', 'dosya',
    'dosyalar', jsonb_build_array(v_yol))) ->> 'id')::uuid;
end $$;
create or replace function pg_temp.satir(tarih date, ad text, urun uuid, adet int, tur text default 'satis', fis text default null,
  zaman text default null, tutar numeric default null) returns jsonb language sql as $$
  select jsonb_build_object('tarih', tarih, 'ad', ad, 'ad_anahtar', lower(ad), 'urun_id', urun, 'adet', adet, 'tur', tur,
    'fis_no', fis, 'zaman', zaman, 'tutar', tutar) $$;
create or replace function pg_temp.sayim(tarih date, kalemler jsonb) returns uuid language sql as $$
  select public.giris_kaydet('sayim', tarih, null, kalemler) $$;
create or replace function pg_temp.satir_bul(r jsonb, malzeme uuid) returns jsonb language sql as $$
  select x from jsonb_array_elements(r -> 'satirlar') x where x ->> 'malzeme_id' = malzeme::text $$;
set role authenticated;
select pg_temp.ol('d4d4d4d4-0000-0000-0000-000000000001','patronMO@x.com');
select public.mekan_olustur('Kafe MO','Ece');
select id as ma from mekanlar where ad = 'Kafe MO' \gset
insert into malzemeler (ad, birim, fiyat) values ('Süt','ml',50);
select id as sut from malzemeler where ad = 'Süt' and mekan_id = :'ma' \gset
select public.urun_kaydet(null, 'Latte', jsonb_build_array(jsonb_build_object('malzeme_id', :'sut', 'miktar', 200))) as latte \gset
insert into urunler (ad) values ('Kurabiye');
select id as kurabiye from urunler where ad = 'Kurabiye' and mekan_id = :'ma' \gset
select pg_temp.sayim(public.bugun() - 2, jsonb_build_array(jsonb_build_object('malzeme_id', :'sut', 'miktar', 10000))) as s1 \gset

-- Kasa raporu: Latte (menüde, reçeteli), Kurabiye (menüde, reçetesiz), Su (menüde yok → urun_id boş)
select public.satis_raporu_isle(pg_temp.rapor(:'ma'), jsonb_build_array(
  pg_temp.satir(public.bugun() - 1, 'Latte', :'latte', 10), pg_temp.satir(public.bugun() - 1, 'Kurabiye', :'kurabiye', 3),
  pg_temp.satir(public.bugun() - 1, 'Su 0,5 L', null, 5))) as r \gset
reset role;
select pg_temp.dogrula(not exists (select 1 from satis_satirlari where mekan_id = :'ma' and urun_id is null),
  'menüde olmayan ürün kaydedildi');
select pg_temp.dogrula((select count(*) from satis_satirlari where mekan_id = :'ma') = 2, 'menüdeki satırlar kaydedilmedi');
set role authenticated;
select pg_temp.dogrula(public.tarifsiz_satislar() = '[{"urun": "Kurabiye", "adet": 3, "menude": true}]'::jsonb,
  'tarifsiz listesi yanlış: ' || public.tarifsiz_satislar()::text);
select pg_temp.sayim(public.bugun(), jsonb_build_array(jsonb_build_object('malzeme_id', :'sut', 'miktar', 8000))) as s2 \gset
select public.stok_farki(:'s2') as rap \gset
select pg_temp.dogrula((pg_temp.satir_bul((:'rap')::jsonb, :'sut') ->> 'satis')::numeric = 2000, 'Latte stoktan düşmedi');
select pg_temp.dogrula((:'rap')::jsonb ->> 'uyarilar' like '%Kurabiye%' and (:'rap')::jsonb ->> 'uyarilar' not like '%Su 0,5%',
  'rapor uyarısı yanlış: ' || ((:'rap')::jsonb ->> 'uyarilar'));
-- Yalnız menü dışı ürün içeren rapor reddedilir
select pg_temp.hata_bekle(format($$select public.satis_raporu_isle(pg_temp.rapor(%L), jsonb_build_array(pg_temp.satir(public.bugun(), 'Su 0,5 L', null, 4)))$$, :'ma'),
  'menüdeki ürünlerden hiçbiri yok');
