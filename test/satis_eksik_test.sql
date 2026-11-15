-- 39_satis_eksik.sql: dönemde satış raporu olan gün sayısı (satis_gun). Başlangıç sayımının günü önceki döneme aittir,
-- bitiş sayımının günü bu döneme; iptal edilen satış sayılmaz; başka mekânın satışı sayılmaz.
\set ON_ERROR_STOP 1
insert into auth.users values ('c9c9c9c9-0000-0000-0000-000000000001','patronSE@x.com'), ('c9c9c9c9-0000-0000-0000-000000000002','patronSE2@x.com');
create or replace function pg_temp.ol(u text, e text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, false), set_config('request.jwt.claim.email', e, false) $$;
create or replace function pg_temp.dogrula(b boolean, mesaj text) returns void language plpgsql as $$
begin if not coalesce(b, false) then raise exception '%', mesaj; end if; end $$;
create or replace function pg_temp.rapor(mekan uuid) returns uuid language plpgsql as $$
declare v_yol text := mekan || '/' || gen_random_uuid() || '/rapor.csv';
begin
  execute 'reset role';
  insert into storage.objects (bucket_id, name) values ('fatura-belgeleri', v_yol);
  execute 'set role authenticated';
  return (public.belge_kaydet(jsonb_build_object('istek_id', gen_random_uuid(), 'tur', 'satis_raporu', 'kaynak', 'dosya',
    'dosyalar', jsonb_build_array(v_yol))) ->> 'id')::uuid;
end $$;
create or replace function pg_temp.satir(tarih date, urun uuid) returns jsonb language sql as $$
  select jsonb_build_object('tarih', tarih, 'ad', 'Latte', 'ad_anahtar', 'latte', 'urun_id', urun, 'adet', 2, 'tur', 'satis') $$;
create or replace function pg_temp.k(n numeric, m numeric) returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('malzeme_id', (select id from malzemeler where ad = 'Süt' and mekan_id = benim_mekanim()), 'miktar', n),
    jsonb_build_object('malzeme_id', (select id from malzemeler where ad = 'Kahve' and mekan_id = benim_mekanim()), 'miktar', m)) $$;

set role authenticated;
select pg_temp.ol('c9c9c9c9-0000-0000-0000-000000000001','patronSE@x.com');
select public.mekan_olustur('Kafe SE','Su');
select id as ma from mekanlar where ad = 'Kafe SE' \gset
insert into malzemeler (ad, birim, fiyat) values ('Süt','ml',40), ('Kahve','g',1000);
select public.urun_kaydet(null, 'Latte', jsonb_build_array(
  jsonb_build_object('malzeme_id', (select id from malzemeler where ad = 'Süt' and mekan_id = :'ma'), 'miktar', 200))) as latte \gset

-- Dönem 1 (bugün−14 → bugün−7): satış bugün−14 (başlangıç günü, sayılmaz), −12, −10, −7 (bitiş günü, sayılır) → 3 gün
-- Dönem 2 (bugün−7 → bugün): hiç satış yok → 0 gün (satılan her şey fark görünürdü)
select public.giris_kaydet_tek(gen_random_uuid(), 'sayim', public.bugun() - 14, null, pg_temp.k(20000, 3000));
select public.giris_kaydet_tek(gen_random_uuid(), 'sayim', public.bugun() - 7, null, pg_temp.k(18000, 3000));
select public.giris_kaydet_tek(gen_random_uuid(), 'sayim', public.bugun(), null, pg_temp.k(15000, 3000));
select public.satis_raporu_isle(pg_temp.rapor(:'ma'), jsonb_build_array(
  pg_temp.satir(public.bugun() - 14, :'latte'), pg_temp.satir(public.bugun() - 12, :'latte'),
  pg_temp.satir(public.bugun() - 10, :'latte'), pg_temp.satir(public.bugun() - 7, :'latte')));

select pg_temp.dogrula((public.acik_trendi(8) -> 0 ->> 'gun')::int = 7 and (public.acik_trendi(8) -> 0 ->> 'satis_gun')::int = 0,
  'satışsız dönem satis_gun 0 olmalı: ' || (public.acik_trendi(8) -> 0 ->> 'satis_gun'));
select pg_temp.dogrula((public.acik_trendi(8) -> 1 ->> 'satis_gun')::int = 3,
  'önceki dönem 3 satış günü olmalı (başlangıç günü hariç, bitiş günü dahil): ' || (public.acik_trendi(8) -> 1 ->> 'satis_gun'));

-- Başka mekânın satışı bu mekânın dönemine sayılmaz
select pg_temp.ol('c9c9c9c9-0000-0000-0000-000000000002','patronSE2@x.com');
select public.mekan_olustur('Kafe SE2','Su');
select id as mb from mekanlar where ad = 'Kafe SE2' \gset
insert into malzemeler (ad, birim, fiyat) values ('Süt','ml',40), ('Kahve','g',1000);
select public.urun_kaydet(null, 'Latte', jsonb_build_array(
  jsonb_build_object('malzeme_id', (select id from malzemeler where ad = 'Süt' and mekan_id = :'mb'), 'miktar', 200))) as latte2 \gset
select public.satis_raporu_isle(pg_temp.rapor(:'mb'), jsonb_build_array(pg_temp.satir(public.bugun() - 3, :'latte2')));
select pg_temp.ol('c9c9c9c9-0000-0000-0000-000000000001','patronSE@x.com');
select pg_temp.dogrula((public.acik_trendi(8) -> 0 ->> 'satis_gun')::int = 0, 'başka mekânın satışı sayıldı');

-- İptal edilen satış sayılmaz
select public.satis_raporu_isle(pg_temp.rapor(:'ma'), jsonb_build_array(pg_temp.satir(public.bugun() - 2, :'latte')));
select pg_temp.dogrula((public.acik_trendi(8) -> 0 ->> 'satis_gun')::int = 1, 'yeni satış günü sayılmadı');
select public.giris_iptal((select id from girisler where mekan_id = :'ma' and tur = 'satis' and tarih = public.bugun() - 2));
select pg_temp.dogrula((public.acik_trendi(8) -> 0 ->> 'satis_gun')::int = 0, 'iptal edilen satış sayıldı');
reset role;
