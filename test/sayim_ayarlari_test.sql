-- 38_sayim_ayarlari.sql: mekan ayarları, dönem trendindeki kullanılan mal değeri ve sayım isteğinin durumu.
\set ON_ERROR_STOP 1
insert into auth.users values ('a5a5a5a5-0000-0000-0000-000000000001','patronSA@x.com'), ('a5a5a5a5-0000-0000-0000-000000000002','baristaSA@x.com');
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
create or replace function pg_temp.k(n numeric, m numeric) returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('malzeme_id', (select id from malzemeler where ad = 'Süt' and mekan_id = benim_mekanim()), 'miktar', n),
    jsonb_build_object('malzeme_id', (select id from malzemeler where ad = 'Kahve' and mekan_id = benim_mekanim()), 'miktar', m)) $$;

set role authenticated;
select pg_temp.ol('a5a5a5a5-0000-0000-0000-000000000001','patronSA@x.com');
select public.mekan_olustur('Kafe SA','Su');
select id as ma, davet_kodu as kod from mekanlar where ad = 'Kafe SA' \gset
insert into malzemeler (ad, birim, fiyat) values ('Süt','ml',40), ('Kahve','g',1000);

-- 1) Ayarlar: varsayılan haftalık / %5; geçersiz değer reddedilir; barista değiştiremez
select pg_temp.dogrula((public.mekan_ayarlari() ->> 'sayim_sikligi')::int = 7 and (public.mekan_ayarlari() ->> 'fark_esigi')::numeric = 5
  and (public.mekan_ayarlari() ->> 'fark_siniri_tl')::numeric = 500, 'varsayılan ayar');
select public.mekan_ayar_kaydet(14, 8, 750);
select pg_temp.dogrula((public.mekan_ayarlari() ->> 'sayim_sikligi')::int = 14 and (public.mekan_ayarlari() ->> 'fark_esigi')::numeric = 8
  and (public.mekan_ayarlari() ->> 'fark_siniri_tl')::numeric = 750, 'ayar kaydedilmedi');
select pg_temp.hata_bekle($$select public.mekan_ayar_kaydet(10, 5, 500)$$, 'Sayım sıklığı');
select pg_temp.hata_bekle($$select public.mekan_ayar_kaydet(7, 0, 500)$$, 'Fark eşiği');
select pg_temp.hata_bekle($$select public.mekan_ayar_kaydet(7, 5, 0)$$, 'fark sınırı');
select pg_temp.ol('a5a5a5a5-0000-0000-0000-000000000002','baristaSA@x.com');
select public.mekana_katil(:'kod','Can');
select pg_temp.hata_bekle($$select public.mekan_ayar_kaydet(7, 5, 500)$$, 'yalnız patron');

-- 2) Dönem: 10 gün önce sayım (10 L süt, 2 kg kahve), arada 4 L süt + 500 g kahve fire, bugün sayım 5 L / 1,4 kg
--    kullanılan = 4 L × 40 + 0,5 kg × 1000 = 660 TL; dönem 10 gün; fark: süt −1 L (−40), kahve −100 g (−100)
select pg_temp.ol('a5a5a5a5-0000-0000-0000-000000000001','patronSA@x.com');
select public.giris_kaydet_tek(gen_random_uuid(), 'sayim', public.bugun() - 10, null, pg_temp.k(10000, 2000));
select public.giris_kaydet_tek(gen_random_uuid(), 'fire', public.bugun() - 5, 'test', pg_temp.k(4000, 500));
select public.giris_kaydet_tek(gen_random_uuid(), 'sayim', public.bugun(), null, pg_temp.k(5000, 1400));
select public.acik_trendi(8) -> 0 as d \gset
select pg_temp.dogrula((:'d'::jsonb ->> 'gun')::int = 10, 'dönem günü: ' || :'d');
select pg_temp.dogrula((:'d'::jsonb ->> 'kullanilan_tl')::numeric = 660, 'kullanılan mal değeri: ' || (:'d'::jsonb ->> 'kullanilan_tl'));
select pg_temp.dogrula((:'d'::jsonb ->> 'acik_tl')::numeric = -140, 'dönem farkı: ' || (:'d'::jsonb ->> 'acik_tl'));

-- 3) Sayım isteği: bekliyor → barista gördü → tamamlandı; açık istek varken yenisi açılmaz
select public.sayim_iste();
select public.sayim_iste();
select pg_temp.dogrula((select count(*) from sayim_talepleri where mekan_id = :'ma') = 1, 'açık istek varken ikinci istek açıldı');
select pg_temp.dogrula(public.sayim_talebi() ->> 'durum' = 'bekliyor', 'durum bekliyor değil');
select public.sayim_talebi_gordum();   -- patron "gördü" sayılmaz
select pg_temp.dogrula(public.sayim_talebi() ->> 'durum' = 'bekliyor', 'patron görünce görüldü oldu');
select pg_temp.ol('a5a5a5a5-0000-0000-0000-000000000002','baristaSA@x.com');
select public.sayim_talebi_gordum();
select pg_temp.dogrula(public.sayim_talebi() ->> 'durum' = 'goruldu', 'barista görünce durum değişmedi');
select public.giris_kaydet_tek(gen_random_uuid(), 'sayim', public.bugun(), null, pg_temp.k(5000, 1400));
select pg_temp.dogrula(public.sayim_talebi() ->> 'durum' = 'tamamlandi', 'sayım isteği tamamlanmadı');
-- Tamamlandıktan sonra yeni istek açılabilir
select pg_temp.ol('a5a5a5a5-0000-0000-0000-000000000001','patronSA@x.com');
select public.sayim_iste();
select pg_temp.dogrula((select count(*) from sayim_talepleri where mekan_id = :'ma') = 2 and public.sayim_talebi() ->> 'durum' = 'bekliyor',
  'tamamlanan istekten sonra yeni istek açılmadı');
reset role;
