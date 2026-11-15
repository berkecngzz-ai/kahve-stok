-- 37_sayim_talebi.sql: patron sayım ister, barista görür, geniş sayım isteği kapatır; başka mekan görmez.
\set ON_ERROR_STOP 1
insert into auth.users values ('a4a4a4a4-0000-0000-0000-000000000001','patronST@x.com'), ('a4a4a4a4-0000-0000-0000-000000000002','baristaST@x.com'),
  ('a4a4a4a4-0000-0000-0000-000000000003','patronST2@x.com');
create or replace function pg_temp.ol(u text, e text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, false), set_config('request.jwt.claim.email', e, false) $$;
create or replace function pg_temp.dogrula(b boolean, mesaj text) returns void language plpgsql as $$
begin if not coalesce(b, false) then raise exception '%', mesaj; end if; end $$;
create or replace function pg_temp.hata_bekle(q text, beklenen text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then
    if sqlerrm not like '%' || beklenen || '%' then raise exception 'Beklenmeyen hata: % (sorgu: %)', sqlerrm, q; end if;
    return;
  end;
  raise exception 'Hata bekleniyordu ama olmadı: %', q;
end $$;

set role authenticated;
select pg_temp.ol('a4a4a4a4-0000-0000-0000-000000000001','patronST@x.com');
select public.mekan_olustur('Kafe ST','Ali');
select id as ma, davet_kodu as kod from mekanlar where ad = 'Kafe ST' \gset
insert into malzemeler (ad, birim, fiyat) values ('Süt','ml',45), ('Kahve','g',1000);
select pg_temp.ol('a4a4a4a4-0000-0000-0000-000000000002','baristaST@x.com');
select public.mekana_katil(:'kod','Can');

-- Barista isteyemez; istek yokken null
select pg_temp.hata_bekle($$select public.sayim_iste()$$, 'yalnız patron');
select pg_temp.dogrula(public.sayim_talebi() is null, 'istek yokken açık istek döndü');
-- Patron ister; çift dokunma tek istek
select pg_temp.ol('a4a4a4a4-0000-0000-0000-000000000001','patronST@x.com');
select public.sayim_iste();
select public.sayim_iste();
select pg_temp.dogrula((select count(*) from sayim_talepleri) = 1, 'çift dokunma iki istek açtı');
-- Barista görür
select pg_temp.ol('a4a4a4a4-0000-0000-0000-000000000002','baristaST@x.com');
select pg_temp.dogrula(public.sayim_talebi() ->> 'isteyen_ad' = 'Ali', 'barista isteği görmüyor');
-- Tek malzeme (günlük süt) sayımı isteği kapatmaz; geniş sayım kapatır
select public.giris_kaydet_tek(gen_random_uuid(), 'sayim', public.bugun(), null,
  jsonb_build_array(jsonb_build_object('malzeme_id', (select id from malzemeler where ad = 'Süt' and mekan_id = :'ma'), 'miktar', 1000)));
select pg_temp.dogrula(public.sayim_talebi() is not null, 'tek malzeme sayımı isteği kapattı');
select public.giris_kaydet_tek(gen_random_uuid(), 'sayim', public.bugun(), null, jsonb_build_array(
  jsonb_build_object('malzeme_id', (select id from malzemeler where ad = 'Süt' and mekan_id = :'ma'), 'miktar', 1000),
  jsonb_build_object('malzeme_id', (select id from malzemeler where ad = 'Kahve' and mekan_id = :'ma'), 'miktar', 500)));
select pg_temp.dogrula(public.sayim_talebi() is null, 'geniş sayım isteği kapatmadı');
-- Başka mekan görmez
select pg_temp.ol('a4a4a4a4-0000-0000-0000-000000000001','patronST@x.com');
select public.sayim_iste();
select pg_temp.ol('a4a4a4a4-0000-0000-0000-000000000003','patronST2@x.com');
select public.mekan_olustur('Kafe ST2','Ece');
select pg_temp.dogrula(public.sayim_talebi() is null and (select count(*) from sayim_talepleri) = 0, 'başka mekanın isteği görünüyor');
reset role;
