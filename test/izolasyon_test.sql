-- İki mekan, izolasyon ve yetki testleri. Her test başarısızsa hata fırlatır.
\set ON_ERROR_STOP 1
insert into auth.users values
 ('11111111-1111-1111-1111-111111111111','patronA@x.com'),
 ('22222222-2222-2222-2222-222222222222','baristaA@x.com'),
 ('33333333-3333-3333-3333-333333333333','patronB@x.com'),
 ('44444444-4444-4444-4444-444444444444','yabanci@x.com');

create function pg_temp.ol(u text, e text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, false), set_config('request.jwt.claim.email', e, false) $$;

set role authenticated;
-- Patron A mekan açar, patron B mekan açar
select pg_temp.ol('11111111-1111-1111-1111-111111111111','patronA@x.com');
select public.mekan_olustur('Kafe A','Ayşe') as a \gset
select davet_kodu as kod_a from mekanlar \gset
select pg_temp.ol('33333333-3333-3333-3333-333333333333','patronB@x.com');
select public.mekan_olustur('Kafe B','Bora');

-- Barista A, A'nın koduyla katılır
select pg_temp.ol('22222222-2222-2222-2222-222222222222','baristaA@x.com');
select public.mekana_katil(lower(:'kod_a'),'Can');

do $$ begin
  -- Barista A yalnızca Kafe A'yı ve onun 2 üyesini görür
  assert (select count(*) from mekanlar) = 1, 'barista birden fazla mekan görüyor';
  assert (select ad from mekanlar) = 'Kafe A', 'barista yanlış mekanı görüyor';
  assert (select count(*) from uyeler) = 2, 'barista başka mekanın üyelerini görüyor';
end $$;

-- Patron B, A'yı görmez
select pg_temp.ol('33333333-3333-3333-3333-333333333333','patronB@x.com');
do $$ begin
  assert (select count(*) from mekanlar) = 1 and (select ad from mekanlar) = 'Kafe B', 'B, A''yı görüyor';
  assert (select count(*) from uyeler) = 1, 'B başka üyeleri görüyor';
end $$;

-- Mekansız kişi hiçbir şey görmez; giriş yapmamış (anon) tabloya erişemez
select pg_temp.ol('44444444-4444-4444-4444-444444444444','yabanci@x.com');
do $$ begin
  assert (select count(*) from mekanlar) = 0, 'mekansız kişi mekan görüyor';
  assert (select count(*) from uyeler) = 0, 'mekansız kişi üye görüyor';
end $$;

-- Yasak işlemler: her biri hata vermeli
create function pg_temp.hata_bekle(q text, beklenen text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then
    if sqlerrm not like '%' || beklenen || '%' then raise exception 'Beklenmeyen hata: % (sorgu: %)', sqlerrm, q; end if;
    return;
  end;
  raise exception 'Hata bekleniyordu ama olmadı: %', q;
end $$;

select pg_temp.hata_bekle($$insert into mekanlar(ad,davet_kodu) values ('X','Y')$$, 'permission denied');
select pg_temp.hata_bekle($$select public.mekana_katil('YANLIS00','Z')$$, 'Davet kodu geçersiz');

select pg_temp.ol('22222222-2222-2222-2222-222222222222','baristaA@x.com');
select pg_temp.hata_bekle($$select public.davet_kodu_yenile()$$, 'yalnızca patron');
select pg_temp.hata_bekle($$select public.mekan_olustur('Kafe C','Can')$$, 'zaten bir mekana');
select pg_temp.hata_bekle($$update uyeler set rol='patron'$$, 'permission denied');
select pg_temp.hata_bekle($$delete from uyeler$$, 'permission denied');
select pg_temp.hata_bekle($$select public.yeni_davet_kodu()$$, 'permission denied');

-- Patron B, A'nın baristasını çıkaramaz
select pg_temp.ol('33333333-3333-3333-3333-333333333333','patronB@x.com');
select pg_temp.hata_bekle($$select public.uye_cikar('22222222-2222-2222-2222-222222222222')$$, 'senin mekanında değil');

-- Patron A kodu yeniler, eski kod artık çalışmaz; baristayı çıkarır
select pg_temp.ol('11111111-1111-1111-1111-111111111111','patronA@x.com');
select public.davet_kodu_yenile();
select public.uye_cikar('22222222-2222-2222-2222-222222222222');
select pg_temp.ol('44444444-4444-4444-4444-444444444444','yabanci@x.com');
select pg_temp.hata_bekle(format($$select public.mekana_katil(%L,'Y')$$, :'kod_a'), 'Davet kodu geçersiz');
select pg_temp.ol('22222222-2222-2222-2222-222222222222','baristaA@x.com');
do $$ begin assert (select count(*) from mekanlar) = 0, 'çıkarılan barista hâlâ mekanı görüyor'; end $$;

reset role;
set role anon;
select pg_temp.hata_bekle($$select * from mekanlar$$, 'permission denied');
select pg_temp.hata_bekle($$select public.mekan_olustur('X','Y')$$, 'permission denied');
reset role;
\echo 'TUM IZOLASYON TESTLERI GECTI'
