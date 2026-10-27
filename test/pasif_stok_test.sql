-- 34_pasif_stok.sql: pasife alınan malzemenin eldeki stoğu Stok ekranında ve değerde kalır; stoğu bitince görünmez.
\set ON_ERROR_STOP 1
insert into auth.users values ('f1f1f1f1-0000-0000-0000-000000000001','patronPS@x.com');
create or replace function pg_temp.ol(u text, e text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, false), set_config('request.jwt.claim.email', e, false) $$;
create or replace function pg_temp.dogrula(b boolean, mesaj text) returns void language plpgsql as $$
begin if not coalesce(b, false) then raise exception '%', mesaj; end if; end $$;
create or replace function pg_temp.st(ad text) returns jsonb language sql as $$
  select x from jsonb_array_elements(public.stok_durumu() -> 'malzemeler') x where x ->> 'ad' = ad $$;
set role authenticated;
select pg_temp.ol('f1f1f1f1-0000-0000-0000-000000000001','patronPS@x.com');
select public.mekan_olustur('Kafe PS','Pia');
insert into malzemeler (ad, birim, fiyat) values ('Badem sütü','ml',130), ('Hindistan sütü','ml',150), ('Süt','ml',45);
select public.giris_kaydet('sayim', public.bugun() - 1, null, (select jsonb_agg(jsonb_build_object('malzeme_id', id, 'miktar',
  case ad when 'Badem sütü' then 8000 when 'Hindistan sütü' then 0 else 20000 end)) from malzemeler));
update malzemeler set aktif = false where ad in ('Badem sütü', 'Hindistan sütü');
select pg_temp.dogrula((pg_temp.st('Badem sütü') ->> 'aktif')::boolean = false and (pg_temp.st('Badem sütü') ->> 'simdi')::numeric = 8000
  and (pg_temp.st('Badem sütü') ->> 'deger_tl')::numeric = 1040, 'pasif ama elde olan badem sütü listede/değerde yok: ' || coalesce(pg_temp.st('Badem sütü')::text, 'yok'));
select pg_temp.dogrula(pg_temp.st('Hindistan sütü') is null, 'stoğu sıfır pasif malzeme listede görünmemeli');
select pg_temp.dogrula((pg_temp.st('Süt') ->> 'aktif')::boolean, 'aktif malzeme aktif değil görünüyor');
reset role;
