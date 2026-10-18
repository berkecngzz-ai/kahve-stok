-- Adım 3: girişler, iptal kuralları, fiyat geçmişi ve izolasyon testleri. Her test başarısızsa hata fırlatır.
-- Sıra: supabase_taklit, 01, 02, izolasyon_test, malzeme_tarif_test, 03, bu dosya.
\set ON_ERROR_STOP 1
insert into auth.users values
 ('99999999-9999-9999-9999-999999999991','patronE@x.com'),
 ('99999999-9999-9999-9999-999999999992','baristaE@x.com'),
 ('99999999-9999-9999-9999-999999999993','patronF@x.com'),
 ('99999999-9999-9999-9999-999999999994','mekansiz2@x.com');

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

-- 03 dosyası çalıştığında var olan fiyatlar geçmişe "baslangic" olarak yazılmış olmalı (Kafe C ve D'den)
do $$ begin
  assert (select count(*) from fiyat_gecmisi where kaynak = 'baslangic') = 4, 'başlangıç fiyatları geçmişe yazılmamış';
end $$;

set role authenticated;

-- Patron E: mekan, malzemeler, latte tarifi
select pg_temp.ol('99999999-9999-9999-9999-999999999991','patronE@x.com');
select public.mekan_olustur('Kafe E','Elif');
select davet_kodu as kod_e from mekanlar \gset
insert into malzemeler (ad, birim, fiyat) values ('Süt','ml',40), ('Kahve','g',1000);
select id as sut from malzemeler where ad = 'Süt' \gset
select id as kahve from malzemeler where ad = 'Kahve' \gset
select public.urun_kaydet(null, 'Latte', jsonb_build_array(
  jsonb_build_object('malzeme_id', :'kahve', 'miktar', 18),
  jsonb_build_object('malzeme_id', :'sut', 'miktar', 200))) as latte \gset
update malzemeler set fiyat = 45 where id = :'sut';
do $$ begin
  assert (select count(*) from fiyat_gecmisi) = 3, 'elle fiyat değişiklikleri geçmişe yazılmadı';
  assert (select fiyat from fiyat_gecmisi where kaynak = 'elle' order by id desc limit 1) = 45, 'son elle fiyat yanlış';
  assert (select degistiren_ad from fiyat_gecmisi order by id desc limit 1) = 'Elif', 'değiştiren adı yok';
end $$;

-- Barista E katılır ve bugünkü faturayı girer: süt 24 lt = 1200 TL (50 TL/lt), kahve 5 kg = 6000 TL
select pg_temp.ol('99999999-9999-9999-9999-999999999992','baristaE@x.com');
select public.mekana_katil(:'kod_e','Ege');
select public.giris_kaydet('fatura', public.bugun(), 'Metro', jsonb_build_array(
  jsonb_build_object('malzeme_id', :'sut', 'miktar', 24000, 'tutar', 1200),
  jsonb_build_object('malzeme_id', :'kahve', 'miktar', 5000, 'tutar', 6000))) as fatura1 \gset
do $$ begin
  assert (select fiyat from malzemeler where ad = 'Süt') = 50, 'fatura süt fiyatını güncellemedi';
  assert (select fiyat from malzemeler where ad = 'Kahve') = 1200, 'fatura kahve fiyatını güncellemedi';
  assert (select count(*) from fiyat_gecmisi where kaynak = 'fatura') = 2, 'fatura fiyatları geçmişe yazılmadı';
  assert (select miktar from malzeme_hareketleri h join malzemeler m on m.id = h.malzeme_id where m.ad = 'Süt') = 24000,
    'fatura hareketi yanlış';
  assert (select giren_ad from girisler) = 'Ege', 'giren adı yok';
end $$;

-- Dünkü (eski tarihli) fatura geçmişe yazılır ama güncel fiyatı ezmez
select public.giris_kaydet('fatura', public.bugun() - 1, null, jsonb_build_array(
  jsonb_build_object('malzeme_id', :'sut', 'miktar', 1000, 'tutar', 30))) as fatura_dun \gset
do $$ begin
  assert (select fiyat from malzemeler where ad = 'Süt') = 50, 'eski tarihli fatura güncel fiyatı ezdi';
  assert (select count(*) from fiyat_gecmisi where kaynak = 'fatura') = 3, 'eski tarihli fatura geçmişe yazılmadı';
end $$;

-- Ücretsiz gelen mal (tutar 0) fiyatı değiştirmez
select public.giris_kaydet('fatura', public.bugun(), 'Numune', jsonb_build_array(
  jsonb_build_object('malzeme_id', :'kahve', 'miktar', 250, 'tutar', 0)));
do $$ begin assert (select fiyat from malzemeler where ad = 'Kahve') = 1200, 'tutarsız fatura fiyatı değiştirdi'; end $$;

-- Satış: 10 latte → 180 g kahve + 2000 ml süt
select public.giris_kaydet('satis', public.bugun(), null,
  jsonb_build_array(jsonb_build_object('urun_id', :'latte', 'miktar', 10))) as satis1 \gset
-- Fire: 500 ml süt döküldü + 1 latte yanlış yapıldı → süt 700, kahve 18
select public.giris_kaydet('fire', public.bugun(), 'Döküldü', jsonb_build_array(
  jsonb_build_object('malzeme_id', :'sut', 'miktar', 500),
  jsonb_build_object('urun_id', :'latte', 'miktar', 1))) as fire1 \gset
-- Sayım (0 da geçerli)
select public.giris_kaydet('sayim', public.bugun(), null, jsonb_build_array(
  jsonb_build_object('malzeme_id', :'sut', 'miktar', 20000),
  jsonb_build_object('malzeme_id', :'kahve', 'miktar', 0)));

create or replace function pg_temp.dogrula(b boolean, mesaj text) returns void language plpgsql as $$
begin if not coalesce(b, false) then raise exception '%', mesaj; end if; end $$;
create or replace function pg_temp.hareket(g uuid, malzeme text) returns numeric language sql as $$
  select h.miktar from malzeme_hareketleri h join malzemeler m on m.id = h.malzeme_id
  where h.giris_id = g and m.ad = malzeme $$;
select pg_temp.dogrula(pg_temp.hareket(:'satis1', 'Kahve') = 180 and pg_temp.hareket(:'satis1', 'Süt') = 2000,
  'satış hareketi yanlış');
select pg_temp.dogrula(pg_temp.hareket(:'fire1', 'Süt') = 700 and pg_temp.hareket(:'fire1', 'Kahve') = 18,
  'fire hareketi yanlış');

-- Hatalı girişler
select pg_temp.hata_bekle($$select public.giris_kaydet('fatura', public.bugun() + 1, null, '[]')$$, 'ileri olamaz');
select pg_temp.hata_bekle($$select public.giris_kaydet('fatura', public.bugun() - 400, null, '[]')$$, 'bir yıl');
select pg_temp.hata_bekle($$select public.giris_kaydet('fatura', null, null, '[]')$$, 'Tarih seç');
select pg_temp.hata_bekle($$select public.giris_kaydet('hirsiz', public.bugun(), null, '[]')$$, 'Geçersiz giriş türü');
select pg_temp.hata_bekle($$select public.giris_kaydet('sayim', public.bugun(), null, '[]')$$, 'En az bir satır');
select pg_temp.hata_bekle(format($$select public.giris_kaydet('fire', public.bugun(), ' ',
  '[{"malzeme_id":"%s","miktar":1}]')$$, :'sut'), 'Fire sebebini');
select pg_temp.hata_bekle(format($$select public.giris_kaydet('fatura', public.bugun(), null,
  '[{"urun_id":"%s","miktar":1,"tutar":1}]')$$, :'latte'), 'geçersiz bir malzeme');
select pg_temp.hata_bekle(format($$select public.giris_kaydet('satis', public.bugun(), null,
  '[{"malzeme_id":"%s","miktar":1}]')$$, :'sut'), 'geçersiz bir malzeme');
select pg_temp.hata_bekle(format($$select public.giris_kaydet('fire', public.bugun(), 'x',
  '[{"malzeme_id":"%s","urun_id":"%s","miktar":1}]')$$, :'sut', :'latte'), 'geçersiz bir malzeme');
select pg_temp.hata_bekle(format($$select public.giris_kaydet('satis', public.bugun(), null,
  '[{"urun_id":"%s","miktar":1.5}]')$$, :'latte'), 'tam sayı');
select pg_temp.hata_bekle(format($$select public.giris_kaydet('fatura', public.bugun(), null,
  '[{"malzeme_id":"%s","miktar":0,"tutar":1}]')$$, :'sut'), 'büyük bir sayı');
select pg_temp.hata_bekle(format($$select public.giris_kaydet('fatura', public.bugun(), null,
  '[{"malzeme_id":"%s","miktar":10,"tutar":-5}]')$$, :'sut'), 'Fatura tutarları');
select pg_temp.hata_bekle(format($$select public.giris_kaydet('fatura', public.bugun(), null,
  '[{"malzeme_id":"%s","miktar":10}]')$$, :'sut'), 'Fatura tutarları');
select pg_temp.hata_bekle(format($$select public.giris_kaydet('fatura', public.bugun(), null,
  '[{"malzeme_id":"%s","miktar":0.001,"tutar":900000}]')$$, :'sut'), 'çok yüksek');
select pg_temp.hata_bekle(format($$select public.giris_kaydet('sayim', public.bugun(), null,
  '[{"malzeme_id":"%s","miktar":1},{"malzeme_id":"%s","miktar":2}]')$$, :'sut', :'sut'), 'iki satırda');
select pg_temp.hata_bekle(format($$select public.giris_kaydet('sayim', public.bugun(), null,
  '[{"malzeme_id":"%s","miktar":"5"}]')$$, :'sut'), 'Sayım miktarları');
do $$ begin assert (select count(*) from girisler) = 6, 'hatalı girişlerden biri kaydedilmiş'; end $$;

-- Tarif değişse de eski satışın hareketi değişmez
select pg_temp.ol('99999999-9999-9999-9999-999999999991','patronE@x.com');
select public.urun_kaydet(:'latte', 'Latte', jsonb_build_array(jsonb_build_object('malzeme_id', :'kahve', 'miktar', 25)));
select pg_temp.dogrula(pg_temp.hareket(:'satis1', 'Kahve') = 180 and pg_temp.hareket(:'satis1', 'Süt') = 2000,
  'tarif değişince eski satış değişti');

-- Patron bir sayım girer; barista onu iptal edemez
select public.giris_kaydet('sayim', public.bugun(), null,
  jsonb_build_array(jsonb_build_object('malzeme_id', :'sut', 'miktar', 100))) as sayim_patron \gset
select pg_temp.ol('99999999-9999-9999-9999-999999999992','baristaE@x.com');
select pg_temp.hata_bekle(format($$select public.giris_iptal(%L)$$, :'sayim_patron'), 'aynı gün');

-- Barista kendi bugünkü faturasını iptal eder → fiyatlar geri döner (süt: bugünkü elle 45, kahve: elle 1000)
select public.giris_iptal(:'fatura1');
do $$ begin
  assert (select fiyat from malzemeler where ad = 'Süt') = 45, 'iptal sonrası süt fiyatı geri dönmedi';
  assert (select fiyat from malzemeler where ad = 'Kahve') = 1000, 'iptal sonrası kahve fiyatı geri dönmedi';
  assert (select iptal_eden_ad from girisler where tur = 'fatura' and aciklama = 'Metro') = 'Ege', 'iptal eden yazılmadı';
  assert (select count(*) from fiyat_gecmisi where kaynak = 'fatura') = 3, 'iptal fiyat geçmişini sildi';
  assert (select count(*) from giris_kalemleri) > 0, 'iptal kayıtları sildi';
end $$;
select pg_temp.hata_bekle(format($$select public.giris_iptal(%L)$$, :'fatura1'), 'zaten iptal');

-- Barista dünkü kendi kaydını iptal edemez (kaydı dün girilmiş gibi yap)
reset role;
update girisler set olusturma = now() - interval '1 day' where id = :'satis1';
set role authenticated;
select pg_temp.hata_bekle(format($$select public.giris_iptal(%L)$$, :'satis1'), 'aynı gün');
-- Patron eski kaydı iptal edebilir
select pg_temp.ol('99999999-9999-9999-9999-999999999991','patronE@x.com');
select public.giris_iptal(:'satis1');

-- Doğrudan yazma/silme yok
select pg_temp.hata_bekle($$update girisler set iptal_zamani = null$$, 'permission denied');
select pg_temp.hata_bekle($$delete from girisler$$, 'permission denied');
select pg_temp.hata_bekle($$delete from giris_kalemleri$$, 'permission denied');
select pg_temp.hata_bekle($$update malzeme_hareketleri set miktar = 0$$, 'permission denied');
select pg_temp.hata_bekle($$delete from fiyat_gecmisi$$, 'permission denied');
select pg_temp.hata_bekle(format($$insert into fiyat_gecmisi (mekan_id, malzeme_id, fiyat, tarih, kaynak)
  select mekan_id, id, 1, public.bugun(), 'elle' from malzemeler where id = %L$$, :'sut'), 'permission denied');
select pg_temp.hata_bekle($$truncate girisler$$, 'permission denied');
select pg_temp.hata_bekle(format($$select public.fiyat_yenile(%L)$$, :'sut'), 'permission denied');

-- Patron F, E'nin hiçbir kaydını görmez, iptal edemez, E'nin malzemesiyle giriş yapamaz
select pg_temp.ol('99999999-9999-9999-9999-999999999993','patronF@x.com');
select public.mekan_olustur('Kafe F','Fatma');
insert into malzemeler (ad, birim, fiyat) values ('Süt','ml',38);
do $$ begin
  assert (select count(*) from girisler) = 0, 'F, E''nin girişlerini görüyor';
  assert (select count(*) from giris_kalemleri) = 0, 'F, E''nin giriş satırlarını görüyor';
  assert (select count(*) from malzeme_hareketleri) = 0, 'F, E''nin hareketlerini görüyor';
  assert (select count(*) from fiyat_gecmisi) = 1, 'F, başkasının fiyat geçmişini görüyor';
end $$;
select pg_temp.hata_bekle(format($$select public.giris_iptal(%L)$$, :'fire1'), 'bulunamadı');
select pg_temp.hata_bekle(format($$select public.giris_kaydet('sayim', public.bugun(), null,
  '[{"malzeme_id":"%s","miktar":1}]')$$, :'sut'), 'geçersiz bir malzeme');
select pg_temp.hata_bekle(format($$select public.giris_kaydet('satis', public.bugun(), null,
  '[{"urun_id":"%s","miktar":1}]')$$, :'latte'), 'geçersiz bir malzeme');
select pg_temp.ol('99999999-9999-9999-9999-999999999991','patronE@x.com');
do $$ begin
  assert (select iptal_zamani from girisler where tur = 'fire') is null, 'F, E''nin firesini iptal etti';
end $$;

-- Mekansız kişi giriş yapamaz, bir şey görmez
select pg_temp.ol('99999999-9999-9999-9999-999999999994','mekansiz2@x.com');
select pg_temp.hata_bekle($$select public.giris_kaydet('sayim', public.bugun(), null, '[]')$$, 'mekana katılmalısın');
do $$ begin
  assert (select count(*) from girisler) = 0, 'mekansız kişi giriş görüyor';
  assert (select count(*) from fiyat_gecmisi) = 0, 'mekansız kişi fiyat geçmişi görüyor';
end $$;

reset role;
set role anon;
select pg_temp.hata_bekle($$select * from girisler$$, 'permission denied');
select pg_temp.hata_bekle($$select * from fiyat_gecmisi$$, 'permission denied');
select pg_temp.hata_bekle($$select public.giris_kaydet('sayim', current_date, null, '[]')$$, 'permission denied');
select pg_temp.hata_bekle($$select public.giris_iptal(gen_random_uuid())$$, 'permission denied');
reset role;
\echo 'TUM GIRIS TESTLERI GECTI'
