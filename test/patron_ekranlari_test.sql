-- Patron ekranları (sql/20): şu anki stok ve açık trendi. Beklenen sayılar elle hesaplandı, rapordan türetilmedi.
--
-- Süt (ml, 40 TL/litre), Kahve (g, 1000 TL/kg); Latte = 200 ml süt + 18 g kahve. Bardak (adet) hiç sayılmadı.
--   -10. gün sayım: süt 20000, kahve 2000
--    -6. gün satış: 10 Latte  → süt 2000, kahve 180
--    -5. gün fatura: süt 12000, kahve 1000
--    -4. gün sayım: süt 27000, kahve 2720
--       beklenen: süt 20000−2000+12000 = 30000 → fark −3000 ml = −120 TL
--                 kahve 2000−180+1000 = 2820 → fark −100 g = −100 TL       → dönem açığı −220 TL
--    -3. gün fatura: süt 6000
--    -2. gün satış: 30 Latte  → süt 6000, kahve 540
--    -1. gün fire: süt 500
--   Şu an: süt 27000+6000−6000−500 = 26500 ml (1060 TL); kahve 2720−540 = 2180 g (2180 TL)
--   Günlük kullanım: ilk kayıt 10 gün önce → 11 gün. Süt (2000+6000+500)/11 = 772,7 ml → 34 gün yeter;
--                    kahve (180+540)/11 = 65,45 g → 33 gün yeter.
reset role;
create or replace function pg_temp.ol(u text, e text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, false), set_config('request.jwt.claim.email', e, false) $$;
create or replace function pg_temp.hata_bekle(q text, beklenen text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then
    if sqlerrm not like '%' || beklenen || '%' then raise exception 'Beklenmeyen hata: % (sorgu: %)', sqlerrm, q; end if;
    return;
  end;
  raise exception 'Hata bekleniyordu (%): %', beklenen, q;
end $$;
insert into auth.users values ('ffffffff-0000-0000-0000-000000000001', 'ekranpatron@example.invalid'),
                              ('ffffffff-0000-0000-0000-000000000002', 'ekranbarista@example.invalid');
set role authenticated;
select pg_temp.ol('ffffffff-0000-0000-0000-000000000001', 'ekranpatron@example.invalid');
select public.mekan_olustur('Ekran Test Kafe', 'Ekran Patron');
select davet_kodu as ekran_kod from public.mekanlar where ad = 'Ekran Test Kafe' \gset

-- Henüz hiç kayıt yokken boş ve hatasız döner.
do $$ declare r jsonb; begin
  r := stok_durumu();
  assert jsonb_array_length(r -> 'malzemeler') = 0 and (r ->> 'kullanim_gun')::int = 0, 'Boş mekan stok durumu yanlış';
  assert acik_trendi() = '[]'::jsonb, 'Boş mekan trendi yanlış';
end $$;

do $$
declare s uuid; k uuid; b uuid; l uuid; r jsonb; x jsonb; t jsonb;
begin
  insert into malzemeler (ad, birim, fiyat) values ('Ekran Süt', 'ml', 40) returning id into s;
  insert into malzemeler (ad, birim, fiyat) values ('Ekran Kahve', 'g', 1000) returning id into k;
  insert into malzemeler (ad, birim, fiyat) values ('Ekran Bardak', 'adet', 3) returning id into b;
  l := urun_kaydet(null, 'Ekran Latte', jsonb_build_array(jsonb_build_object('malzeme_id', s, 'miktar', 200),
                                                          jsonb_build_object('malzeme_id', k, 'miktar', 18)));
  perform giris_kaydet('sayim', bugun() - 10, null, jsonb_build_array(
    jsonb_build_object('malzeme_id', s, 'miktar', 20000), jsonb_build_object('malzeme_id', k, 'miktar', 2000)));
  perform giris_kaydet('satis', bugun() - 6, null, jsonb_build_array(jsonb_build_object('urun_id', l, 'miktar', 10)));
  perform fatura_kaydet(bugun() - 5, 'Ekran Tedarikçi', jsonb_build_array(
    jsonb_build_object('malzeme_id', s, 'miktar', 12000, 'tutar_kdv_haric', 480, 'kdv_orani', 0),
    jsonb_build_object('malzeme_id', k, 'miktar', 1000, 'tutar_kdv_haric', 1000, 'kdv_orani', 0)), '{"genel":1480}', '[]');
  perform giris_kaydet('sayim', bugun() - 4, null, jsonb_build_array(
    jsonb_build_object('malzeme_id', s, 'miktar', 27000), jsonb_build_object('malzeme_id', k, 'miktar', 2720)));
  perform fatura_kaydet(bugun() - 3, 'Ekran Tedarikçi', jsonb_build_array(
    jsonb_build_object('malzeme_id', s, 'miktar', 6000, 'tutar_kdv_haric', 240, 'kdv_orani', 0)), '{"genel":240}', '[]');
  perform giris_kaydet('satis', bugun() - 2, null, jsonb_build_array(jsonb_build_object('urun_id', l, 'miktar', 30)));
  perform giris_kaydet('fire', bugun() - 1, 'Döküldü', jsonb_build_array(jsonb_build_object('malzeme_id', s, 'miktar', 500)));
  -- İptal edilen giriş hiçbir hesaba girmez.
  perform giris_iptal(giris_kaydet('fire', bugun() - 1, 'Yanlış', jsonb_build_array(jsonb_build_object('malzeme_id', s, 'miktar', 9000))));

  r := stok_durumu();
  assert (r ->> 'kullanim_gun')::int = 11, format('kullanım günü yanlış: %s', r ->> 'kullanim_gun');
  select value into x from jsonb_array_elements(r -> 'malzemeler') where value ->> 'malzeme_id' = s::text;
  assert (x ->> 'sayim_tarih')::date = bugun() - 4 and (x ->> 'sayilan')::numeric = 27000, 'Süt son sayım yanlış';
  assert (x ->> 'gelen')::numeric = 6000 and (x ->> 'satis')::numeric = 6000 and (x ->> 'fire')::numeric = 500, 'Süt hareketleri yanlış';
  assert (x ->> 'simdi')::numeric = 26500 and (x ->> 'deger_tl')::numeric = 1060, format('Süt şu an yanlış: %s', x);
  assert (x ->> 'yeter_gun')::int = 34, format('Süt kaç gün yeter yanlış: %s', x ->> 'yeter_gun');
  select value into x from jsonb_array_elements(r -> 'malzemeler') where value ->> 'malzeme_id' = k::text;
  assert (x ->> 'simdi')::numeric = 2180 and (x ->> 'deger_tl')::numeric = 2180 and (x ->> 'yeter_gun')::int = 33,
    format('Kahve şu an yanlış: %s', x);
  select value into x from jsonb_array_elements(r -> 'malzemeler') where value ->> 'malzeme_id' = b::text;
  assert x ->> 'simdi' is null and x ->> 'yeter_gun' is null, 'Sayılmamış malzemede tahmin olmamalı';
  assert (r -> 'malzemeler' -> 2 ->> 'malzeme_id') = b::text, 'Sayılmamış malzeme sonda olmalı';
  assert (r -> 'malzemeler' -> 0 ->> 'malzeme_id') = k::text, 'En az gün yeten malzeme başta olmalı';

  t := acik_trendi();
  assert jsonb_array_length(t) = 1, format('Bir dönem bekleniyordu: %s', t);
  assert (t -> 0 ->> 'acik_tl')::numeric = -220 and (t -> 0 ->> 'fazla_tl')::numeric = 0, format('Dönem açığı yanlış: %s', t -> 0);
  assert (t -> 0 ->> 'baslangic')::date = bugun() - 10 and (t -> 0 ->> 'bitis')::date = bugun() - 4, 'Dönem tarihleri yanlış';
  assert t -> 0 -> 'en_cok_acik' -> 0 ->> 'malzeme_id' = s::text and t -> 0 -> 'en_cok_acik' -> 1 ->> 'malzeme_id' = k::text
     and jsonb_array_length(t -> 0 -> 'en_cok_acik') = 2, 'En çok açık sırası yanlış';
  -- Özet ile rapor aynı rakamı göstermeli.
  assert (stok_farki((t -> 0 ->> 'sayim_id')::uuid) ->> 'toplam_acik_tl')::numeric = -220, 'Rapor ile trend farklı';
end $$;

-- Bekleyen fatura uyarısı yalnız kendi dönemindeki raporda çıkar (sql/13).
reset role;
insert into public.belgeler (mekan_id, tur, kaynak, istek_id, tedarikci, belge_tarihi, genel_toplam, durum, giren, giren_ad)
select id, 'fatura', 'ocr', gen_random_uuid(), 'Sonraki Hafta', public.bugun() - 2, 100, 'bekliyor', 'ffffffff-0000-0000-0000-000000000001', 'Ekran Patron'
from public.mekanlar where ad = 'Ekran Test Kafe';
set role authenticated;
do $$ declare s uuid; begin
  select id into s from girisler where tur = 'sayim' and tarih = bugun() - 4;
  assert jsonb_array_length(stok_farki(s) -> 'uyarilar') = 0, 'Sonraki haftanın faturası eski raporda uyarı veriyor';
  assert (eksik_belge_ozeti()).bekleyen_fatura = 1, 'Özet bekleyen faturayı göstermeli';
end $$;
reset role;
insert into public.belgeler (mekan_id, tur, kaynak, istek_id, tedarikci, belge_tarihi, genel_toplam, durum, giren, giren_ad)
select id, 'fatura', 'ocr', gen_random_uuid(), 'Bu Hafta', public.bugun() - 6, 100, 'bekliyor', 'ffffffff-0000-0000-0000-000000000001', 'Ekran Patron'
from public.mekanlar where ad = 'Ekran Test Kafe';
set role authenticated;
do $$ declare s uuid; r jsonb; begin
  select id into s from girisler where tur = 'sayim' and tarih = bugun() - 4;
  r := stok_farki(s) -> 'uyarilar';
  assert jsonb_array_length(r) = 1 and r ->> 0 like '1 fatura eşleştirme bekliyor%', format('Dönemdeki fatura uyarısı yok: %s', r);
end $$;

-- Barista göremez (fiyat ve açık patrona özel).
select pg_temp.ol('ffffffff-0000-0000-0000-000000000002', 'ekranbarista@example.invalid');
select public.mekana_katil(:'ekran_kod', 'Ekran Barista');
select pg_temp.hata_bekle('select public.stok_durumu()', 'yalnızca patron');
select pg_temp.hata_bekle('select public.acik_trendi()', 'yalnızca patron');

-- Başka mekanın patronu bu mekanın malzemelerini göremez (çok kiracılı izolasyon).
select pg_temp.ol('11111111-1111-1111-1111-111111111111', 'patronA@x.com');
do $$ begin
  assert not exists (select 1 from jsonb_array_elements(stok_durumu() -> 'malzemeler') x where x ->> 'ad' like 'Ekran %'),
    'Başka mekanın stoğu görünüyor';
  assert not exists (select 1 from jsonb_array_elements(acik_trendi()) t, jsonb_array_elements(t -> 'en_cok_acik') x
                     where x ->> 'ad' like 'Ekran %'), 'Başka mekanın açığı görünüyor';
end $$;

-- Giriş yapmamış (anon) çalıştıramaz.
reset role;
set role anon;
select pg_temp.hata_bekle('select public.stok_durumu()', 'permission denied');
reset role;
