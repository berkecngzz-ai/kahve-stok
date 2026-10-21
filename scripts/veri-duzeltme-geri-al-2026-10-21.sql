-- GERİ DÖNÜŞ: scripts/veri-duzeltme-2026-10-21.sql'in yaptığını tam olarak eski hâline getirir.
-- Değerler yedekten: Desktop\kahve-stok-yedek\2026-10-21_canliya-alma-oncesi. Tek işlem; satırlar düzeltme sonrası
-- beklenen hâlde değilse hiçbir şey değişmez.
begin;
do $$
declare
  v_mekan constant uuid := 'fea07dae-cfae-444d-a044-9c5e155cdc56';
  v_soda  constant uuid := 'cb2a9b78-2c52-4631-8249-09b20954fe1f';
  v_seker_surubu constant uuid := 'ae50b092-ba62-4451-85c5-6bfa01378ffe';
  n int;
begin
  -- A) 3 belge yeniden açık (iptal bilgisi silinir; girişleri iptal kalır — eski durum)
  update belgeler set iptal_eden = null, iptal_eden_ad = null, iptal_zamani = null
    where mekan_id = v_mekan and iptal_zamani is not null
      and id in ('a35f09f1-6f91-4bd8-a2a8-2e01dd5c0aec', '0d635048-ba7e-48e3-8740-797a243211fb', 'e034a826-a9ff-4a72-aab2-8a7f407b1292');
  get diagnostics n = row_count;
  if n <> 3 then raise exception 'A: 3 belge bekleniyordu, % bulundu', n; end if;

  -- B1) Vanilya kayıtları eski hâline (Şeker şurubu)
  update eslestirme_defteri set malzeme_id = v_seker_surubu, carpan = 700, kaynak = 'kurulum',
         guncelleme = '2026-10-20T05:19:04.783936+00:00' where id = 49 and mekan_id = v_mekan;
  get diagnostics n = row_count; if n <> 1 then raise exception 'B1a: % satır', n; end if;
  update eslestirme_defteri set malzeme_id = v_seker_surubu, carpan = 700, kaynak = 'barista',
         guncelleme = '2026-10-21T02:36:08.335699+00:00' where id = 174 and mekan_id = v_mekan;
  get diagnostics n = row_count; if n <> 1 then raise exception 'B1b: % satır', n; end if;

  -- B2) Silinen 5 kayıt aynı kimlikleriyle geri
  insert into eslestirme_defteri (id, mekan_id, tedarikci_anahtar, metin_anahtar, birim, sonuc, malzeme_id, carpan, kaynak, guncelleme)
    overriding system value values
    (8,   v_mekan, '2222222222', 'kolombiya filtre kahve 250g', 'adet', 'malzeme', '33482a46-6985-4221-bcd0-c64ccb2b2de8', 1000, 'kurulum', '2026-10-20T03:51:25.906032+00:00'),
    (175, v_mekan, '4820193756', 'uht tam yagli sut 1 l 12 li koli', 'lt', 'takip_disi', null, null, 'kurulum', '2026-10-21T02:36:58.600184+00:00'),
    (176, v_mekan, '4820193756', 'beyaz toz seker 5 kg', 'diger', 'takip_disi', null, null, 'kurulum', '2026-10-21T02:37:04.799479+00:00'),
    (177, v_mekan, '4820193756', 'karton bardak 12 oz 50 li', 'diger', 'takip_disi', null, null, 'kurulum', '2026-10-21T02:37:09.249879+00:00'),
    (178, v_mekan, '4820193756', 'dome kapak 12 oz 100 lu', 'diger', 'takip_disi', null, null, 'kurulum', '2026-10-21T02:37:15.106572+00:00');

  -- B3) Soda çarpanı 1
  update eslestirme_defteri set carpan = 1, kaynak = 'kurulum', guncelleme = '2026-10-21T02:53:38.099325+00:00'
    where id = 186 and mekan_id = v_mekan and carpan = 200;
  get diagnostics n = row_count; if n <> 1 then raise exception 'B3: % satır', n; end if;

  -- C) Soda satırı 24 ml / 14.500 ₺
  update belge_satirlari set carpan = 1, stok_miktari = 24 where id = 357 and mekan_id = v_mekan and stok_miktari = 4800;
  get diagnostics n = row_count; if n <> 1 then raise exception 'C1: % satır', n; end if;
  update giris_kalemleri set miktar = 24 where id = 128 and mekan_id = v_mekan and miktar = 4800;
  get diagnostics n = row_count; if n <> 1 then raise exception 'C2: % satır', n; end if;
  update malzeme_hareketleri set miktar = 24
    where giris_id = '0c13d796-f44b-490f-a888-83fd744134e7' and malzeme_id = v_soda and miktar = 4800;
  get diagnostics n = row_count; if n <> 1 then raise exception 'C3: % satır', n; end if;
  update fiyat_gecmisi set fiyat = 14500, fiyat_haric = 14500 where id = 202 and mekan_id = v_mekan and fiyat = 72.50;
  get diagnostics n = row_count; if n <> 1 then raise exception 'C4: % satır', n; end if;
  perform fiyat_yenile(v_soda);
  if (select fiyat from malzemeler where id = v_soda) <> 14500 then raise exception 'C5: soda fiyatı geri dönmedi'; end if;
end $$;
commit;
