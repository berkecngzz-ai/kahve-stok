-- Adım 2: malzeme / ürün / tarif izolasyon ve yetki testleri. Her test başarısızsa hata fırlatır.
-- izolasyon_test.sql'den sonra (ya da tek başına) çalıştırılabilir; kendi kullanıcılarını kullanır.
\set ON_ERROR_STOP 1
insert into auth.users values
 ('55555555-5555-5555-5555-555555555555','patronC@x.com'),
 ('66666666-6666-6666-6666-666666666666','baristaC@x.com'),
 ('77777777-7777-7777-7777-777777777777','patronD@x.com'),
 ('88888888-8888-8888-8888-888888888888','mekansiz@x.com');

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

set role authenticated;

-- Patron C mekan açar, malzemeleri ve bir latte tarifi girer
select pg_temp.ol('55555555-5555-5555-5555-555555555555','patronC@x.com');
select public.mekan_olustur('Kafe C','Cem');
select davet_kodu as kod_c from mekanlar \gset
insert into malzemeler (ad, birim, fiyat) values ('Süt','ml',40), ('Kahve çekirdeği','g',900), ('Bardak','adet',3);
select id as sut from malzemeler where ad = 'Süt' \gset
select id as kahve from malzemeler where ad = 'Kahve çekirdeği' \gset
select id as bardak from malzemeler where ad = 'Bardak' \gset
select public.urun_kaydet(null, 'Latte', jsonb_build_array(
  jsonb_build_object('malzeme_id', :'kahve', 'miktar', 18),
  jsonb_build_object('malzeme_id', :'sut', 'miktar', 200),
  jsonb_build_object('malzeme_id', :'bardak', 'miktar', 1))) as latte \gset

do $$ begin
  assert (select count(*) from malzemeler) = 3, 'patron kendi malzemelerini göremiyor';
  assert (select count(*) from tarif_kalemleri) = 3, 'tarif kaydedilmedi';
end $$;

-- Aynı adla ikinci malzeme/ürün olmaz (büyük-küçük harf farkı da sayılmaz)
select pg_temp.hata_bekle($$insert into malzemeler (ad, birim) values ('süt ','ml')$$, 'malzemeler_ad_uniq');
select pg_temp.hata_bekle($$select public.urun_kaydet(null,'LATTE',
  jsonb_build_array(jsonb_build_object('malzeme_id', (select id from malzemeler limit 1), 'miktar', 1)))$$, 'zaten var');

-- Hatalı tarifler reddedilir
select pg_temp.hata_bekle($$select public.urun_kaydet(null,'Boş','[]')$$, 'en az bir malzeme');
select pg_temp.hata_bekle(format($$select public.urun_kaydet(null,'Sıfır',
  '[{"malzeme_id":"%s","miktar":0}]')$$, :'sut'), 'büyük bir sayı');
select pg_temp.hata_bekle(format($$select public.urun_kaydet(null,'Yazı',
  '[{"malzeme_id":"%s","miktar":"abc"}]')$$, :'sut'), 'büyük bir sayı');
select pg_temp.hata_bekle(format($$select public.urun_kaydet(null,'Çift',
  '[{"malzeme_id":"%s","miktar":1},{"malzeme_id":"%s","miktar":2}]')$$, :'sut', :'sut'), 'iki kez');
select pg_temp.hata_bekle($$select public.urun_kaydet(null,'Uydurma',
  '[{"malzeme_id":"not-a-uuid","miktar":1}]')$$, 'geçersiz');

-- Birim değiştirilemez, malzeme silinemez, toplu silme yok
select pg_temp.hata_bekle(format($$update malzemeler set birim='g' where id=%L$$, :'sut'), 'permission denied');
select pg_temp.hata_bekle($$delete from malzemeler$$, 'permission denied');
select pg_temp.hata_bekle($$delete from urunler$$, 'permission denied');
select pg_temp.hata_bekle($$truncate tarif_kalemleri$$, 'permission denied');
select pg_temp.hata_bekle($$truncate uyeler$$, 'permission denied');

-- Patron fiyatı değiştirir, malzemeyi pasife alır; tarifi düzenler
update malzemeler set fiyat = 45 where id = :'sut';
update malzemeler set aktif = false where id = :'bardak';
select public.urun_kaydet(:'latte', 'Latte (büyük)', jsonb_build_array(
  jsonb_build_object('malzeme_id', :'kahve', 'miktar', 20.5),
  jsonb_build_object('malzeme_id', :'sut', 'miktar', 250)));
do $$ begin
  assert (select fiyat from malzemeler where ad = 'Süt') = 45, 'patron fiyat değiştiremedi';
  assert (select count(*) from tarif_kalemleri) = 2, 'tarif düzenlenince eski kalemler kalmış';
  assert (select ad from urunler) = 'Latte (büyük)', 'ürün adı değişmedi';
end $$;

-- Barista C katılır: görür ama değiştiremez
select pg_temp.ol('66666666-6666-6666-6666-666666666666','baristaC@x.com');
select public.mekana_katil(:'kod_c','Deniz');
do $$ begin
  assert (select count(*) from malzemeler) = 3, 'barista malzemeleri göremiyor';
  assert (select count(*) from urunler) = 1, 'barista ürünleri göremiyor';
  assert (select count(*) from tarif_kalemleri) = 2, 'barista tarifi göremiyor';
end $$;
select pg_temp.hata_bekle($$insert into malzemeler (ad, birim) values ('Şurup','ml')$$, 'row-level security');
select pg_temp.hata_bekle(format($$select public.urun_kaydet(%L,'X',
  '[{"malzeme_id":"%s","miktar":1}]')$$, :'latte', :'sut'), 'yalnızca patron');
-- Kural gereği bu ikisi hiçbir satırı etkilememeli
delete from tarif_kalemleri where urun_id = :'latte';
update malzemeler set fiyat = 1 where id = :'sut';
select pg_temp.ol('55555555-5555-5555-5555-555555555555','patronC@x.com');
do $$ begin
  assert (select fiyat from malzemeler where ad = 'Süt') = 45, 'barista fiyat değiştirebildi';
  assert (select count(*) from tarif_kalemleri) = 2, 'barista tarif silebildi';
end $$;
select pg_temp.ol('66666666-6666-6666-6666-666666666666','baristaC@x.com');
select pg_temp.hata_bekle($$insert into tarif_kalemleri (urun_id, malzeme_id, miktar)
  select (select id from urunler limit 1), (select id from malzemeler where aktif limit 1), 5$$, 'row-level security');

-- Patron D, C'nin hiçbir şeyini görmez ve değiştiremez
select pg_temp.ol('77777777-7777-7777-7777-777777777777','patronD@x.com');
select public.mekan_olustur('Kafe D','Duru');
insert into malzemeler (ad, birim, fiyat) values ('Süt','ml',38);  -- aynı ad başka mekanda serbest
select id as sut_d from malzemeler \gset
do $$ begin
  assert (select count(*) from malzemeler) = 1, 'D, C''nin malzemelerini görüyor';
  assert (select count(*) from urunler) = 0, 'D, C''nin ürünlerini görüyor';
  assert (select count(*) from tarif_kalemleri) = 0, 'D, C''nin tarifini görüyor';
end $$;
update malzemeler set fiyat = 1 where id = :'sut';   -- C'nin malzemesi: etkilememeli
update urunler set ad = 'ele geçti' where id = :'latte';
select pg_temp.hata_bekle(format($$select public.urun_kaydet(%L,'Ele geçti',
  '[{"malzeme_id":"%s","miktar":1}]')$$, :'latte', :'sut_d'), 'Ürün bulunamadı');
select pg_temp.hata_bekle(format($$select public.urun_kaydet(null,'Çalıntı',
  '[{"malzeme_id":"%s","miktar":1}]')$$, :'sut'), 'geçersiz');
-- D kendi ürününe C'nin malzemesini doğrudan bağlayamaz
select public.urun_kaydet(null, 'Süt bardağı',
  jsonb_build_array(jsonb_build_object('malzeme_id', :'sut_d', 'miktar', 200))) as urun_d \gset
select pg_temp.hata_bekle(format($$insert into tarif_kalemleri (urun_id, malzeme_id, miktar) values (%L,%L,1)$$,
  :'urun_d', :'sut'), 'foreign key');
-- D, C'nin mekanına satır yazamaz
select pg_temp.ol('55555555-5555-5555-5555-555555555555','patronC@x.com');
select id as mekan_c from mekanlar \gset
select pg_temp.ol('77777777-7777-7777-7777-777777777777','patronD@x.com');
select pg_temp.hata_bekle(format($$insert into malzemeler (mekan_id, ad, birim) values (%L,'Sızma','g')$$,
  :'mekan_c'), 'row-level security');

select pg_temp.ol('55555555-5555-5555-5555-555555555555','patronC@x.com');
do $$ begin
  assert (select fiyat from malzemeler where ad = 'Süt') = 45, 'D, C''nin fiyatını değiştirdi';
  assert (select ad from urunler) = 'Latte (büyük)', 'D, C''nin ürününü değiştirdi';
end $$;

-- Mekansız kişi hiçbir şey görmez; giriş yapmamış kişi tablolara erişemez
select pg_temp.ol('88888888-8888-8888-8888-888888888888','mekansiz@x.com');
do $$ begin
  assert (select count(*) from malzemeler) = 0, 'mekansız kişi malzeme görüyor';
  assert (select count(*) from urunler) = 0, 'mekansız kişi ürün görüyor';
end $$;
select pg_temp.hata_bekle($$insert into malzemeler (ad, birim) values ('X','g')$$, 'row-level security');

reset role;
set role anon;
select pg_temp.hata_bekle($$select * from malzemeler$$, 'permission denied');
select pg_temp.hata_bekle($$select * from tarif_kalemleri$$, 'permission denied');
select pg_temp.hata_bekle($$select public.urun_kaydet(null,'X','[]')$$, 'permission denied');
reset role;
\echo 'TUM MALZEME/TARIF TESTLERI GECTI'
