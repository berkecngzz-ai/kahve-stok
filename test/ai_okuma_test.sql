-- Adım 4 / Parça 3: AI okuma — günlük sınır, sonucu yalnız sunucu yazar, "takip dışı" yalnız sunucudaki AI kaydından.
-- Sıra: ... 05, belge_kurulum_test, 06, bu dosya.
\set ON_ERROR_STOP 1
insert into auth.users values
 ('cccccccc-0000-0000-0000-000000000001','patronM@x.com'),
 ('cccccccc-0000-0000-0000-000000000002','baristaM@x.com'),
 ('cccccccc-0000-0000-0000-000000000003','patronN@x.com');

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

set role authenticated;
select pg_temp.ol('cccccccc-0000-0000-0000-000000000001','patronM@x.com');
select public.mekan_olustur('Kafe M','Mert');
select id as mekan_m, davet_kodu as kod_m from mekanlar \gset
insert into malzemeler (ad, birim, fiyat_haric, kdv_orani) values ('Süt','ml',40,1);
select id as sut from malzemeler \gset
select pg_temp.ol('cccccccc-0000-0000-0000-000000000002','baristaM@x.com');
select public.mekana_katil(:'kod_m','Mina');

-- GÜNLÜK SINIR (bu test için 2)
reset role;
update mekanlar set ai_gunluk_sinir = 2 where id = :'mekan_m';
set role authenticated;
select public.ai_okuma_baslat('gpt-test-mini') as okuma1 \gset
select public.ai_okuma_baslat('gpt-test-mini') as okuma2 \gset
select pg_temp.hata_bekle($$select public.ai_okuma_baslat('gpt-test-mini')$$, 'GUNLUK_SINIR');
select pg_temp.dogrula((select bugun = 2 and sinir = 2 from public.ai_okuma_durumu()), 'okuma durumu yanlış');

-- Telefon (barista) AI sonucunu yazamaz
select pg_temp.hata_bekle(format($$select public.ai_okuma_bitir(%L, 'tamam', '{}', 1, 1, 0, 1, null)$$, :'okuma1'),
  'permission denied');

-- Sunucu (service_role) yazar
reset role;
set role service_role;
select public.ai_okuma_bitir(:'okuma1', 'tamam', '{"satirlar": [
   {"metin": "PEÇETE 100LÜ", "eslesme": {"karar": "takip_disi", "guven": 0.95}},
   {"metin": "ŞEKER KÜP 1KG", "eslesme": {"karar": "takip_disi", "guven": 0.5}},
   {"metin": "SÜT 1L", "eslesme": {"karar": "malzeme", "guven": 0.9}},
   {"metin": "DETERJAN", "eslesme": {"karar": "takip_disi", "guven": 0.99}}]}', 1500, 400, 0.0012, 3200, null);
select pg_temp.hata_bekle(format($$select public.ai_okuma_bitir(%L, 'tamam', '{}', 1, 1, 0, 1, null)$$, :'okuma1'),
  'bulunamadı');   -- ikinci kez yazılamaz
select public.ai_okuma_bitir(:'okuma2', 'hata', null, null, null, null, 900, 'zaman aşımı');
reset role;
set role authenticated;

-- Barista belgeyi AI okumasıyla kaydeder. Toplam: 100×1,2 + 50×1,01 + 40×1,01 + 10×1,2 = 222,90
select pg_temp.ol('cccccccc-0000-0000-0000-000000000002','baristaM@x.com');
select public.belge_kaydet(jsonb_build_object('istek_id', gen_random_uuid(), 'tur', 'fatura', 'kaynak', 'ai',
  'ai_okuma_id', :'okuma1', 'tedarikci', 'Toptancı', 'tarih', public.bugun(),
  'toplamlar', jsonb_build_object('genel', 222.90),
  'satirlar', jsonb_build_array(
    jsonb_build_object('metin', 'PEÇETE 100LÜ', 'miktar', 1, 'birim', 'diger', 'tutar_haric', 100, 'kdv_orani', 20, 'sinif', 'takip_disi'),
    jsonb_build_object('metin', 'ŞEKER KÜP 1KG', 'miktar', 1, 'birim', 'adet', 'tutar_haric', 50, 'kdv_orani', 1, 'sinif', 'takip_disi'),
    jsonb_build_object('metin', 'SÜT 1L', 'miktar', 1, 'birim', 'adet', 'tutar_haric', 40, 'kdv_orani', 1, 'sinif', 'eslesti',
                       'malzeme_id', :'sut', 'carpan', 1000, 'barista_onayi', true),
    jsonb_build_object('metin', 'KARTON BARDAK', 'miktar', 1, 'birim', 'adet', 'tutar_haric', 10, 'kdv_orani', 20, 'sinif', 'takip_disi'))
  )) as s1 \gset
-- Peçete: AI emin → takip dışı · Şeker: AI emin değil → bekler · Süt: stokta · Bardak: AI başka metin dedi (deterjan) → bekler
select pg_temp.dogrula(((:'s1')::jsonb ->> 'takip_disi')::int = 1 and ((:'s1')::jsonb ->> 'bekleyen')::int = 2
  and ((:'s1')::jsonb ->> 'stoklanan')::int = 1, 'AI takip dışı kararı yanlış uygulandı: ' || :'s1');

-- Aynı AI okuması ikinci bir belgede kullanılamaz (takip dışı kabul edilmez, kaynak OCR sayılır)
select public.belge_kaydet(jsonb_build_object('istek_id', gen_random_uuid(), 'tur', 'fatura', 'kaynak', 'ai',
  'ai_okuma_id', :'okuma1', 'tedarikci', 'Başka', 'tarih', public.bugun(), 'toplamlar', jsonb_build_object('genel', 120),
  'satirlar', jsonb_build_array(
    jsonb_build_object('metin', 'PEÇETE 100LÜ', 'miktar', 1, 'birim', 'diger', 'tutar_haric', 100, 'kdv_orani', 20, 'sinif', 'takip_disi')))) as s2 \gset
select pg_temp.dogrula(((:'s2')::jsonb ->> 'bekleyen')::int = 1, 'AI okuması iki kez kullanıldı: ' || :'s2');
-- Hatalı (tamamlanmamış) okuma da kullanılamaz
select public.belge_kaydet(jsonb_build_object('istek_id', gen_random_uuid(), 'tur', 'fatura', 'kaynak', 'ai',
  'ai_okuma_id', :'okuma2', 'tedarikci', 'Üçüncü', 'tarih', public.bugun(), 'toplamlar', jsonb_build_object('genel', 120),
  'satirlar', jsonb_build_array(
    jsonb_build_object('metin', 'PEÇETE 100LÜ', 'miktar', 1, 'birim', 'diger', 'tutar_haric', 100, 'kdv_orani', 20, 'sinif', 'takip_disi')))) as s3 \gset
select pg_temp.dogrula(((:'s3')::jsonb ->> 'bekleyen')::int = 1, 'hatalı AI okuması kullanıldı');
reset role;
select pg_temp.dogrula((select kaynak from belgeler where tedarikci = 'Başka') = 'ocr', 'kullanılmış AI okumasıyla kaynak AI kaldı');
select pg_temp.dogrula((select count(*) = 1 from belge_satirlari where metin = 'PEÇETE 100LÜ' and durum = 'takip_disi' and cozen = 'ai'), 'AI kararı işaretlenmedi');
set role authenticated;

-- Barista okuma kayıtlarını (maliyet) göremez; patron görür
select pg_temp.dogrula((select count(*) = 0 from ai_okumalari), 'barista AI maliyetlerini görüyor');
select pg_temp.ol('cccccccc-0000-0000-0000-000000000001','patronM@x.com');
select pg_temp.dogrula((select count(*) = 2 and sum(maliyet_usd) = 0.0012 from ai_okumalari), 'patron AI kayıtlarını göremiyor');
select pg_temp.hata_bekle($$select public.kurulum_ai_takip_disi()$$, 'yalnızca kurulum');

-- Başka mekan: kendi sınırı ayrı; M'nin okumasını kullanamaz
select pg_temp.ol('cccccccc-0000-0000-0000-000000000003','patronN@x.com');
select public.mekan_olustur('Kafe N','Nil');
select pg_temp.dogrula((select bugun = 0 and sinir = 20 from public.ai_okuma_durumu()), 'N, M''nin sınırından etkilendi');
select public.ai_okuma_baslat('gpt-test-mini') is not null as ok \gset
select pg_temp.dogrula((select count(*) = 0 from ai_okumalari where mekan_id = :'mekan_m'), 'N, M''nin AI kayıtlarını görüyor');
select public.belge_kaydet(jsonb_build_object('istek_id', gen_random_uuid(), 'tur', 'fatura', 'kaynak', 'ai',
  'ai_okuma_id', :'okuma1', 'tedarikci', 'X', 'tarih', public.bugun(), 'toplamlar', jsonb_build_object('genel', 120),
  'satirlar', jsonb_build_array(
    jsonb_build_object('metin', 'PEÇETE 100LÜ', 'miktar', 1, 'birim', 'diger', 'tutar_haric', 100, 'kdv_orani', 20, 'sinif', 'takip_disi')))) as s4 \gset
select pg_temp.dogrula(((:'s4')::jsonb ->> 'bekleyen')::int = 1, 'N, M''nin AI okumasını kullandı');

-- Kurulum: AI'nın takip dışı dediklerini görür, yanlışı geri alır (satır kuyruğa döner)
reset role;
select id as kurulumcu from auth.users where email = 'kurulum@x.com' \gset
set role authenticated;
select pg_temp.ol(:'kurulumcu','kurulum@x.com');
select public.kurulum_ai_takip_disi() as liste \gset
select pg_temp.dogrula(jsonb_array_length((:'liste')::jsonb) = 1 and (:'liste')::jsonb -> 0 ->> 'metin' = 'PEÇETE 100LÜ',
  'kurulum AI takip dışı listesi yanlış');
select public.kurulum_takip_disi_geri_al(((:'liste')::jsonb -> 0 ->> 'id')::bigint);
select pg_temp.dogrula(jsonb_array_length(public.kurulum_ai_kullanim()) >= 2, 'kurulum AI kullanım özeti boş');
reset role;
select pg_temp.dogrula((select durum = 'bekliyor' and bekleme_sebebi = 'eslesme' from belge_satirlari
  where metin = 'PEÇETE 100LÜ' and belge_id = ((:'s1')::jsonb ->> 'id')::uuid), 'geri alınan satır kuyruğa dönmedi');

set role anon;
select pg_temp.hata_bekle($$select public.ai_okuma_baslat('x')$$, 'permission denied');
select pg_temp.hata_bekle($$select * from ai_okumalari$$, 'permission denied');
reset role;
\echo 'TUM AI OKUMA TESTLERI GECTI'
