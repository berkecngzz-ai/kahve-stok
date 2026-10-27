-- 30_ayni_gun_sirasi.sql: canlı hata (2026-10-27): ilk sayım 0 → mal kabul (fatura basılı tarihi eski) → stokta görünmedi.
-- Kurallar: fatura stok tarihi = yüklendiği gün; açılış sayımından sonra aynı gün girilen her şey sonradır;
-- sonraki sayımlarda aynı gün gerçek zamanlı fatura/fire sayımdan sonra, satış (güne göre) sayımdan önce.
\set ON_ERROR_STOP 1
insert into auth.users values
 ('b8b8b8b8-0000-0000-0000-000000000001','patronAG@x.com'),
 ('b8b8b8b8-0000-0000-0000-000000000002','baristaAG@x.com'),
 ('b8b8b8b8-0000-0000-0000-000000000003','patronAG2@x.com');

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
create or replace function pg_temp.simdi(malzeme uuid) returns numeric language sql as $$
  select (x ->> 'simdi')::numeric from jsonb_array_elements(public.stok_durumu() -> 'malzemeler') x
  where x ->> 'malzeme_id' = malzeme::text $$;

set role authenticated;
select pg_temp.ol('b8b8b8b8-0000-0000-0000-000000000001','patronAG@x.com');
select public.mekan_olustur('Kafe AG','Berke');
select id as ma, davet_kodu as kod from mekanlar where ad = 'Kafe AG' \gset
insert into malzemeler (ad, birim, fiyat) values ('Süt','ml',50);
select id as sut from malzemeler where ad = 'Süt' and mekan_id = :'ma' \gset
select public.urun_kaydet(null, 'Latte', jsonb_build_array(jsonb_build_object('malzeme_id', :'sut', 'miktar', 200))) as latte \gset
select pg_temp.ol('b8b8b8b8-0000-0000-0000-000000000002','baristaAG@x.com');
select public.mekana_katil(:'kod','Selen');

-- 1) Açılış sayımı: süt 0
select pg_temp.sayim(public.bugun(), jsonb_build_array(jsonb_build_object('malzeme_id', :'sut', 'miktar', 0))) as s1 \gset
-- 2) Mal kabul: faturanın basılı tarihi 26 gün önce, mal bugün geldi. 24 L 1.200 TL
select pg_temp.fatura(repeat('c', 64), public.bugun() - 26, 1200, jsonb_build_array(
  pg_temp.kalem('SÜT 1L', 24, 'adet', :'sut', 1000, 1200))) as f1 \gset
select pg_temp.dogrula((:'f1')::jsonb ->> 'durum' = 'tamam', 'fatura stoğa girmedi: ' || :'f1');
reset role;
select g.tarih as f1_tarih, g.id as f1_giris from belgeler b join girisler g on g.id = b.giris_id where b.id = ((:'f1')::jsonb ->> 'id')::uuid \gset
select pg_temp.dogrula(:'f1_tarih'::date = public.bugun(), 'mal girişi faturanın basılı tarihine yazıldı: ' || :'f1_tarih');
set role authenticated;
-- KÖK HATA: stokta görünmeli
select pg_temp.ol('b8b8b8b8-0000-0000-0000-000000000001','patronAG@x.com');
select pg_temp.dogrula(pg_temp.simdi(:'sut') = 24000, 'açılış sayımından sonra gelen mal stokta yok: ' || pg_temp.simdi(:'sut'));
-- 3) Aynı gün satış raporu (açılış sayımından sonra yüklendi): 10 Latte = 2.000 ml düşer
select public.satis_raporu_isle(pg_temp.rapor(:'ma'), jsonb_build_array(pg_temp.satir(public.bugun(), 'Latte', :'latte', 10))) as r1 \gset
select pg_temp.dogrula(pg_temp.simdi(:'sut') = 22000, 'açılış günü satışı düşmedi: ' || pg_temp.simdi(:'sut'));
-- 4) Fire 500 ml
select pg_temp.ol('b8b8b8b8-0000-0000-0000-000000000002','baristaAG@x.com');
select public.giris_kaydet('fire', public.bugun(), 'Döküldü', jsonb_build_array(jsonb_build_object('malzeme_id', :'sut', 'miktar', 500)));
select pg_temp.ol('b8b8b8b8-0000-0000-0000-000000000001','patronAG@x.com');
select pg_temp.dogrula(pg_temp.simdi(:'sut') = 21500, 'fire düşmedi: ' || pg_temp.simdi(:'sut'));

-- 5) Akşam testi akışı: açılış sayımı düne alınır, bitiş sayımı bugün 21.000 → rapor −500 ml × 0,05 = −25 TL
select public.sayim_tarihi(:'s1', public.bugun() - 1);
select pg_temp.ol('b8b8b8b8-0000-0000-0000-000000000002','baristaAG@x.com');
select pg_temp.sayim(public.bugun(), jsonb_build_array(jsonb_build_object('malzeme_id', :'sut', 'miktar', 21000))) as s2 \gset
select pg_temp.ol('b8b8b8b8-0000-0000-0000-000000000001','patronAG@x.com');
select public.stok_farki(:'s2') as rap \gset
select pg_temp.dogrula((pg_temp.satir_bul((:'rap')::jsonb, :'sut') ->> 'beklenen')::numeric = 21500, 'beklenen 21.500 değil: ' || (pg_temp.satir_bul((:'rap')::jsonb, :'sut'))::text);
select pg_temp.dogrula((pg_temp.satir_bul((:'rap')::jsonb, :'sut') ->> 'fark_tl')::numeric = -25, 'kayıp −25 TL değil');

-- 6) Kapanış sayımından (açılış değil) SONRA aynı gün: yeni mal stoğa eklenir, satış raporu (gün içi satış) eklenmez
select pg_temp.dogrula(pg_temp.simdi(:'sut') = 21000, 'bitiş sayımı stoğu 21.000 değil: ' || pg_temp.simdi(:'sut'));
select pg_temp.ol('b8b8b8b8-0000-0000-0000-000000000002','baristaAG@x.com');
select pg_temp.fatura(repeat('d', 64), public.bugun(), 600, jsonb_build_array(pg_temp.kalem('SÜT 1L', 12, 'adet', :'sut', 1000, 600))) as f2 \gset
select pg_temp.ol('b8b8b8b8-0000-0000-0000-000000000001','patronAG@x.com');
select pg_temp.dogrula(pg_temp.simdi(:'sut') = 33000, 'kapanış sayımından sonra gelen mal eklenmedi: ' || pg_temp.simdi(:'sut'));
select public.satis_raporu_isle(pg_temp.rapor(:'ma'), jsonb_build_array(pg_temp.satir(public.bugun(), 'Latte', :'latte', 5, 'satis', 'F2'))) as r2 \gset
select pg_temp.dogrula(pg_temp.simdi(:'sut') = 33000, 'bugünün satışı kapanış sayımından sonra düşüldü: ' || pg_temp.simdi(:'sut'));
-- Bitiş raporu değişmez: sonradan gelen mal bu döneme girmez
select public.stok_farki(:'s2') as rap2 \gset
select pg_temp.dogrula((pg_temp.satir_bul((:'rap2')::jsonb, :'sut') ->> 'gelen')::numeric = 24000, 'sayımdan sonraki mal döneme girdi');

-- 7) Teslim günü düzeltmesi belgeye de yazılır
select public.fatura_teslim_tarihi(:'f1_giris', public.bugun() - 1);
reset role;
select pg_temp.dogrula((select teslim_tarihi from belgeler where giris_id = :'f1_giris') = public.bugun() - 1, 'teslim günü belgeye yazılmadı');
