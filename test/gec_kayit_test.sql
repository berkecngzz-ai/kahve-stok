-- 35_gec_kayit_kurallari.sql: barista geriye tarih sınırı, "mal ne zaman geldi" teslim günü, kapanmış hafta uyarısı.
\set ON_ERROR_STOP 1
insert into auth.users values ('a2a2a2a2-0000-0000-0000-000000000001','patronGK@x.com'), ('a2a2a2a2-0000-0000-0000-000000000002','baristaGK@x.com');
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
create or replace function pg_temp.sut(n numeric) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('malzeme_id', (select id from malzemeler where ad = 'Süt' and mekan_id = benim_mekanim()), 'miktar', n)) $$;
create or replace function pg_temp.fatura(ozet text, teslim date, gun_once int default 0) returns jsonb language sql as $$
  select public.belge_kaydet(jsonb_build_object('istek_id', gen_random_uuid(), 'tur', 'fatura', 'kaynak', 'ai', 'dosya_ozeti', ozet,
    'tedarikci', 'Süt A.Ş.', 'tarih', public.bugun() - gun_once, 'teslim_tarihi', teslim, 'toplamlar', jsonb_build_object('genel', 540),
    'okunan', jsonb_build_object('not', 'test'), 'satirlar', jsonb_build_array(jsonb_build_object('metin', 'SÜT 1L', 'miktar', 12, 'birim', 'adet',
      'tutar_dahil', 540, 'sinif', 'eslesti', 'malzeme_id', (select id from malzemeler where ad = 'Süt' and mekan_id = benim_mekanim()),
      'carpan', 1000, 'barista_onayi', true, 'gelen_miktar', 12, 'sayim', 'sayildi', 'teslimat', 'tam')))) $$;

set role authenticated;
select pg_temp.ol('a2a2a2a2-0000-0000-0000-000000000001','patronGK@x.com');
select public.mekan_olustur('Kafe GK','Gül');
select id as ma, davet_kodu as kod from mekanlar where ad = 'Kafe GK' \gset
insert into malzemeler (ad, birim, fiyat) values ('Süt','ml',45), ('Kahve','g',1000);
select pg_temp.ol('a2a2a2a2-0000-0000-0000-000000000002','baristaGK@x.com');
select public.mekana_katil(:'kod','Gani');

-- 1) Barista: 2 gün önce reddedilir, dün olur; patron eski tarih girebilir
select pg_temp.hata_bekle($$select public.giris_kaydet('sayim', public.bugun() - 2, null, pg_temp.sut(1000))$$, 'yalnız bugün ve dün');
select pg_temp.hata_bekle($$select public.giris_kaydet('fire', public.bugun() - 9, 'x', pg_temp.sut(100))$$, 'yalnız bugün ve dün');
select public.giris_kaydet('fire', public.bugun() - 1, 'Döküldü', pg_temp.sut(100)) as fire_dun \gset
select pg_temp.ol('a2a2a2a2-0000-0000-0000-000000000001','patronGK@x.com');
select public.giris_kaydet('sayim', public.bugun() - 10, null, jsonb_build_array(
  jsonb_build_object('malzeme_id', (select id from malzemeler where ad = 'Süt' and mekan_id = :'ma'), 'miktar', 10000),
  jsonb_build_object('malzeme_id', (select id from malzemeler where ad = 'Kahve' and mekan_id = :'ma'), 'miktar', 2000))) as s1 \gset

-- 2) Mal ne zaman geldi: barista 3 gün önce dedi → stok o güne; 10 gün önce reddedilir; patron 30 gün önce girebilir
select pg_temp.ol('a2a2a2a2-0000-0000-0000-000000000002','baristaGK@x.com');
select pg_temp.fatura(repeat('1', 64), public.bugun() - 3, 6) as f1 \gset
reset role;
select pg_temp.dogrula((select g.tarih from belgeler b join girisler g on g.id = b.giris_id where b.id = ((:'f1')::jsonb ->> 'id')::uuid) = public.bugun() - 3,
  'teslim günü stoğa yazılmadı');
select pg_temp.dogrula((select teslim_tarihi from belgeler where id = ((:'f1')::jsonb ->> 'id')::uuid) = public.bugun() - 3, 'teslim günü belgeye yazılmadı');
select pg_temp.dogrula(coalesce(current_setting('app.teslim_tarihi', true), '') = '', 'teslim günü ayarı sonraki işleme sızdı');
set role authenticated;
select pg_temp.hata_bekle(format($$select pg_temp.fatura(%L, public.bugun() - 10)$$, repeat('2', 64)), 'en fazla 7 gün');
-- Teslim günü verilmezse eskisi gibi yüklendiği gün
select pg_temp.fatura(repeat('3', 64), null, 1) as f3 \gset
reset role;
select pg_temp.dogrula((select g.tarih from belgeler b join girisler g on g.id = b.giris_id where b.id = ((:'f3')::jsonb ->> 'id')::uuid) = public.bugun(),
  'teslim günü yokken yükleme günü kullanılmadı');
set role authenticated;
select pg_temp.ol('a2a2a2a2-0000-0000-0000-000000000001','patronGK@x.com');
select pg_temp.fatura(repeat('4', 64), public.bugun() - 30, 30) as f4 \gset

-- 3) Kapanmış hafta uyarısı: bitiş sayımı 5 gün önce girilmiş; sonradan döneme fire eklenince uyarı çıkar
select public.giris_kaydet('sayim', public.bugun() - 5, null, jsonb_build_array(
  jsonb_build_object('malzeme_id', (select id from malzemeler where ad = 'Süt' and mekan_id = :'ma'), 'miktar', 30000),
  jsonb_build_object('malzeme_id', (select id from malzemeler where ad = 'Kahve' and mekan_id = :'ma'), 'miktar', 2000))) as s2 \gset
reset role;
update girisler set olusturma = now() - interval '5 days' where id = :'s2';
update girisler set olusturma = now() - interval '6 days' where mekan_id = :'ma' and id <> :'s2' and tarih <= public.bugun() - 5;
set role authenticated;
select pg_temp.dogrula(not (public.stok_farki(:'s2') ->> 'uyarilar' like '%kapandıktan sonra%'), 'geç kayıt yokken uyarı çıktı: ' || (public.stok_farki(:'s2') ->> 'uyarilar'));
select public.giris_kaydet('fire', public.bugun() - 7, 'Geç girildi', pg_temp.sut(500));
select pg_temp.dogrula(public.stok_farki(:'s2') ->> 'uyarilar' like '%kapandıktan sonra 1 kayıt%', 'geç fire uyarısı yok: ' || (public.stok_farki(:'s2') ->> 'uyarilar'));
-- Sayım düzeltmesi de sayılır
select public.sayim_duzelt(:'s2', (select id from malzemeler where ad = 'Kahve' and mekan_id = :'ma'), 1990, 'düzeltme');
select pg_temp.dogrula(public.stok_farki(:'s2') ->> 'uyarilar' like '%kapandıktan sonra 2 kayıt%', 'sayım düzeltmesi sayılmadı: ' || (public.stok_farki(:'s2') ->> 'uyarilar'));
reset role;
