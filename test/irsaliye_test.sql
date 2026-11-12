-- 36_irsaliye.sql: fiyatsız irsaliye stoğa girer; sonra gelen fatura stoğu ikinci kez eklemez (mahsup), fiyatı verir.
\set ON_ERROR_STOP 1
insert into auth.users values ('a3a3a3a3-0000-0000-0000-000000000001','patronIR@x.com'), ('a3a3a3a3-0000-0000-0000-000000000002','baristaIR@x.com');
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
create or replace function pg_temp.mz(ad text) returns uuid language sql as $$
  select id from malzemeler where ad = $1 and mekan_id = (select id from mekanlar where ad = 'Kafe IR') $$;
-- Stoğa giren (iptal edilmemiş fatura hareketleri) toplamı
create or replace function pg_temp.giren(ad text) returns numeric language sql as $$
  select coalesce(sum(h.miktar), 0) from malzeme_hareketleri h join girisler g on g.id = h.giris_id
  where h.malzeme_id = pg_temp.mz($1) and g.iptal_zamani is null and g.tur = 'fatura' $$;
create or replace function pg_temp.irsaliye(ozet text, no text, ted text, vkn text, adet numeric, gun_once int default 0) returns jsonb language sql as $$
  select public.belge_kaydet(jsonb_build_object('istek_id', gen_random_uuid(), 'tur', 'fatura', 'kaynak', 'ai', 'irsaliye', true,
    'dosya_ozeti', ozet, 'fatura_no', no, 'tedarikci', ted, 'tedarikci_vkn', vkn, 'tarih', public.bugun() - gun_once,
    'teslim_tarihi', public.bugun() - gun_once, 'okunan', jsonb_build_object('not', 'test'),
    'satirlar', jsonb_build_array(jsonb_build_object('metin', 'SÜT YARIM YAĞLI 1 L', 'miktar', adet, 'birim', 'adet',
      'tutar_dahil', 999, 'sinif', 'eslesti', 'malzeme_id', pg_temp.mz('Süt'), 'carpan', 1000, 'barista_onayi', true),
      jsonb_build_object('metin', 'PEÇETE', 'miktar', 5, 'birim', 'adet', 'sinif', 'belirsiz')))) $$;
create or replace function pg_temp.fatura(ozet text, no text, ted text, vkn text, adet numeric, tutar numeric) returns jsonb language sql as $$
  select public.belge_kaydet(jsonb_build_object('istek_id', gen_random_uuid(), 'tur', 'fatura', 'kaynak', 'ai',
    'dosya_ozeti', ozet, 'fatura_no', no, 'tedarikci', ted, 'tedarikci_vkn', vkn, 'tarih', public.bugun(),
    'toplamlar', jsonb_build_object('genel', tutar), 'okunan', jsonb_build_object('not', 'test'),
    'satirlar', jsonb_build_array(jsonb_build_object('metin', 'SÜT YARIM YAĞLI 1 L', 'miktar', adet, 'birim', 'adet',
      'tutar_dahil', tutar, 'sinif', 'eslesti', 'malzeme_id', pg_temp.mz('Süt'), 'carpan', 1000, 'barista_onayi', true)))) $$;

set role authenticated;
select pg_temp.ol('a3a3a3a3-0000-0000-0000-000000000001','patronIR@x.com');
select public.mekan_olustur('Kafe IR','İpek');
select id as ma, davet_kodu as kod from mekanlar where ad = 'Kafe IR' \gset
insert into malzemeler (ad, birim, fiyat) values ('Süt','ml',40);
select pg_temp.ol('a3a3a3a3-0000-0000-0000-000000000002','baristaIR@x.com');
select public.mekana_katil(:'kod','Can');

-- 1) İrsaliye: toplam yok, fiyat yok → stoğa girer; fiyat kontrol bekler
select pg_temp.irsaliye(repeat('a', 64), 'S2026000011209', 'SÜTAŞ', '7880022136', 180, 2) as i1 \gset
reset role;
select pg_temp.dogrula((:'i1')::jsonb ->> 'irsaliye' = 'true', 'irsaliye bayrağı dönmedi');
select pg_temp.dogrula(pg_temp.giren('Süt') = 180000, 'irsaliye stoğa girmedi: ' || pg_temp.giren('Süt'));
select pg_temp.dogrula((select irsaliye and genel_toplam is null and toplam_tutuyor is null and durum = 'tamam' from belgeler where id = ((:'i1')::jsonb ->> 'id')::uuid),
  'irsaliye belgesi yanlış işaretlendi');
select pg_temp.dogrula((select bool_and(tutar_dahil is null and fiyat_kontrol) from belge_satirlari where belge_id = ((:'i1')::jsonb ->> 'id')::uuid and durum = 'stokta'),
  'irsaliyeye fiyat yazıldı');
select pg_temp.dogrula((select count(*) from fiyat_gecmisi where malzeme_id = pg_temp.mz('Süt') and kaynak = 'fatura') = 0, 'irsaliye fiyat geçmişine yazdı');
select pg_temp.dogrula((select bool_and('irsaliye' = any(k.uyarilar) and not ('fiyat_kontrol' = any(k.uyarilar)))
  from giris_kalemleri k join belgeler b on b.giris_id = k.giris_id where b.id = ((:'i1')::jsonb ->> 'id')::uuid), 'irsaliye kalemi tutar görevine düştü');
select pg_temp.dogrula((select g.belge_genel_toplam is null from belgeler b join girisler g on g.id = b.giris_id where b.id = ((:'i1')::jsonb ->> 'id')::uuid),
  'irsaliye girişine toplam yazıldı');
select pg_temp.dogrula((select g.tarih from belgeler b join girisler g on g.id = b.giris_id where b.id = ((:'i1')::jsonb ->> 'id')::uuid) = public.bugun() - 2,
  'irsaliye teslim günü');
set role authenticated;
-- Aynı irsaliye (no + tedarikçi) ikinci kez reddedilir
select pg_temp.hata_bekle(format($$select pg_temp.irsaliye(%L, 'S2026000011209', 'SÜTAŞ', '7880022136', 180)$$, repeat('b', 64)), 'daha önce yüklenmiş');
-- Aynı gün aynı tedarikçiden İKİNCİ (farklı) irsaliye kabul edilir
select pg_temp.irsaliye(repeat('c', 64), 'S2026000011300', 'SÜTAŞ', '7880022136', 60, 2) as i2 \gset
reset role;
select pg_temp.dogrula(pg_temp.giren('Süt') = 240000, 'ikinci irsaliye girmedi');

-- 2) Ay sonu faturası iki irsaliyeyi birden kapatır: stok değişmez, fiyat girer
set role authenticated;
select pg_temp.fatura(repeat('d', 64), 'SUT2026000099', 'SÜTAŞ', '7880022136', 240, 9600) as f1 \gset
reset role;
select pg_temp.dogrula(pg_temp.giren('Süt') = 240000, 'fatura irsaliyedeki malı İKİNCİ KEZ ekledi: ' || pg_temp.giren('Süt'));
select pg_temp.dogrula(((:'f1')::jsonb ->> 'irsaliye_mahsup')::int = 1, 'mahsup sayısı');
select pg_temp.dogrula((select sum(miktar) from irsaliye_mahsuplari where mekan_id = :'ma') = 240000, 'mahsup miktarı');
select pg_temp.dogrula((select bool_and('irsaliyede' = any(k.uyarilar)) from giris_kalemleri k join belgeler b on b.giris_id = k.giris_id
  where b.id = ((:'f1')::jsonb ->> 'id')::uuid), 'fatura kalemi irsaliyede diye işaretlenmedi');
select pg_temp.dogrula((select fiyat from fiyat_gecmisi where malzeme_id = pg_temp.mz('Süt') and kaynak = 'fatura' order by id desc limit 1) = 40, 'faturadan fiyat gelmedi');
select pg_temp.dogrula(round(public.malzeme_birim_maliyet(pg_temp.mz('Süt'), public.bugun()), 4) = 0.04, 'birim maliyet yanlış');

-- 3) Faturalanmış irsaliye, faturası iptal edilmeden iptal edilemez; fatura iptal → irsaliye yeniden açık
set role authenticated;
select pg_temp.ol('a3a3a3a3-0000-0000-0000-000000000001','patronIR@x.com');
select pg_temp.hata_bekle(format($$select public.giris_iptal((select giris_id from belgeler where id = %L))$$, (:'i1')::jsonb ->> 'id'), 'faturayla eşleşti');
select public.giris_iptal((select giris_id from belgeler where id = ((:'f1')::jsonb ->> 'id')::uuid));
reset role;
select pg_temp.dogrula((select public.irsaliye_acik_miktar(id) from belge_satirlari where belge_id = ((:'i1')::jsonb ->> 'id')::uuid and durum = 'stokta') = 180000,
  'fatura iptalinden sonra irsaliye açık değil');
select pg_temp.dogrula(pg_temp.giren('Süt') = 240000, 'fatura iptali stoğu bozdu');

-- 4) Fatura irsaliyeden FAZLA: fazlası stoğa girer (240 açık + 60 yeni)
set role authenticated;
select pg_temp.fatura(repeat('e', 64), 'SUT2026000100', 'SÜTAŞ', '7880022136', 300, 12000) as f2 \gset
reset role;
select pg_temp.dogrula(pg_temp.giren('Süt') = 300000, 'fazla kısım stoğa girmedi: ' || pg_temp.giren('Süt'));

-- 5) Başka tedarikçi: yalnız miktar birebir aynıysa mahsup; farklıysa normal stok
set role authenticated;
select pg_temp.irsaliye(repeat('f', 64), 'IRS2026000000175', 'SÖYLEMEZOĞLU', '7800045250', 120, 1) as i3 \gset
select pg_temp.fatura(repeat('0', 64), 'ERB2026000001', 'ERBAK ULUDAĞ', '3380002041', 50, 2000) as f3 \gset
reset role;
select pg_temp.dogrula(pg_temp.giren('Süt') = 470000, 'başka tedarikçi farklı miktar mahsup edildi: ' || pg_temp.giren('Süt'));
set role authenticated;
select pg_temp.fatura(repeat('9', 64), 'ERB2026000002', 'ERBAK ULUDAĞ', '3380002041', 120, 4800) as f4 \gset
reset role;
select pg_temp.dogrula(pg_temp.giren('Süt') = 470000, 'başka tedarikçi birebir miktar mahsup edilmedi: ' || pg_temp.giren('Süt'));

-- 6) Normal fatura (irsaliyesiz) eskisi gibi
set role authenticated;
select pg_temp.fatura(repeat('8', 64), 'MTR1', 'METRO', '6200031354', 10, 400) as f5 \gset
reset role;
select pg_temp.dogrula(pg_temp.giren('Süt') = 480000, 'normal fatura bozuldu');
select pg_temp.dogrula(((:'f5')::jsonb ->> 'irsaliye_mahsup')::int = 0, 'normal faturada mahsup');

-- 7) Başka mekan mahsup tablosunu göremez
insert into auth.users values ('a3a3a3a3-0000-0000-0000-000000000003','patronIR2@x.com');
set role authenticated;
select pg_temp.ol('a3a3a3a3-0000-0000-0000-000000000003','patronIR2@x.com');
select public.mekan_olustur('Kafe IR2','Ece');
select pg_temp.dogrula((select count(*) from irsaliye_mahsuplari) = 0, 'başka mekanın mahsupları görünüyor');
reset role;
