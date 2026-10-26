-- 28_fatura_birim_fiyat.sql: AI birim fiyatı tutarsız ama toplam tutuyor + barista saydı + maliyet olağan → stoğa girer.
\set ON_ERROR_STOP 1
insert into auth.users values ('f7f7f7f7-0000-0000-0000-000000000001','patronBF@x.com'), ('f7f7f7f7-0000-0000-0000-000000000002','baristaBF@x.com');
create or replace function pg_temp.ol(u text, e text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, false), set_config('request.jwt.claim.email', e, false) $$;
create or replace function pg_temp.dogrula(b boolean, mesaj text) returns void language plpgsql as $$
begin if not coalesce(b, false) then raise exception '%', mesaj; end if; end $$;
create or replace function pg_temp.fatura(ozet text, genel numeric, haric numeric, bfiyat numeric, gelen numeric, mal uuid) returns jsonb language sql as $$
  select public.belge_kaydet(jsonb_build_object('istek_id', gen_random_uuid(), 'tur', 'fatura', 'kaynak', 'ai', 'dosya_ozeti', ozet,
    'tedarikci', 'Yıldız Süt', 'tedarikci_vkn', '9870012345', 'tarih', public.bugun(), 'toplamlar', jsonb_build_object('genel', genel),
    'okunan', jsonb_build_object('not', 'test'),
    'satirlar', jsonb_build_array(jsonb_build_object('metin', 'Tam Yağlı Süt 1 L (12li koli)', 'miktar', 48, 'birim', 'lt', 'birim_fiyat', bfiyat,
      'tutar_haric', haric, 'kdv_orani', 1, 'sinif', 'eslesti', 'malzeme_id', mal, 'carpan', 1000, 'barista_onayi', true,
      'gelen_miktar', gelen, 'sayim', 'sayildi', 'teslimat', case when gelen = 48 then 'tam' else 'teslimat_farki' end)))) $$;
set role authenticated;
select pg_temp.ol('f7f7f7f7-0000-0000-0000-000000000001','patronBF@x.com');
select public.mekan_olustur('Kafe BF','Ada');
select id as m, davet_kodu as kod from mekanlar where ad = 'Kafe BF' \gset
insert into malzemeler (ad, birim, fiyat) values ('Tam yağlı süt','ml',42);
select id as sut from malzemeler where mekan_id = :'m' \gset
select pg_temp.ol('f7f7f7f7-0000-0000-0000-000000000002','baristaBF@x.com');
select public.mekana_katil(:'kod','Can');
-- (a) birim fiyat koli başına (500), satır 2.000 TL, toplam 2.020 tutuyor, barista 48 L saydı → stokta
select pg_temp.fatura(repeat('c', 64), 2020, 2000, 500, 48, :'sut') as a \gset
select pg_temp.dogrula((:'a')::jsonb ->> 'durum' = 'tamam' and ((:'a')::jsonb ->> 'stoklanan')::int = 1, '(a) stoğa girmedi: ' || :'a');
-- (b) toplam tutmuyor → kontrolde kalır
select pg_temp.fatura(repeat('d', 64), 9999, 2000, 500, 48, :'sut') as b \gset
reset role;
select pg_temp.dogrula((select durum = 'bekliyor' from belge_satirlari where belge_id = ((:'b')::jsonb ->> 'id')::uuid), '(b) toplam tutmadan stoğa girdi');
set role authenticated;
-- (c) birim maliyet olağandışı (48 L için 20.000 TL ≈ 420 TL/L) → kontrolde kalır
select pg_temp.fatura(repeat('e', 64), 20200, 20000, 5000, 48, :'sut') as c \gset
reset role;
select pg_temp.dogrula((select durum = 'bekliyor' from belge_satirlari where belge_id = ((:'c')::jsonb ->> 'id')::uuid), '(c) olağandışı fiyat stoğa girdi');
-- (d) barista farklı saydı (teslimat farkı) → bu yama devreye girmez
set role authenticated;
select pg_temp.fatura(repeat('f', 64), 2020.01, 2000, 500, 40, :'sut') as d \gset
reset role;
select pg_temp.dogrula((select bekleme_sebebi is distinct from null or durum = 'stokta' from belge_satirlari where belge_id = ((:'d')::jsonb ->> 'id')::uuid), '(d) beklenmeyen durum');
select pg_temp.dogrula(not has_function_privilege('authenticated', 'public.belge_kaydet_v23(jsonb)', 'execute'), 'eski belge_kaydet doğrudan çağrılabiliyor');
