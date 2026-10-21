-- Canlı veri düzeltmesi — 2026-10-21 denetimi (YALNIZ Andromeda corp., bir kez; kullanıcı onayıyla çalıştırılır).
-- Yedek: Desktop\kahve-stok-yedek\2026-10-21_duzeltme-oncesi (tüm tablolar JSON).
-- Her adım beklenen eski değeri kontrol eder; veri beklenenden farklıysa HİÇBİR şey değişmez (hepsi tek işlem).
-- Deneme: sondaki "commit" yerine "rollback" ile çalıştır.
begin;
do $$
declare
  v_mekan constant uuid := 'fea07dae-cfae-444d-a044-9c5e155cdc56';
  v_soda  constant uuid := 'cb2a9b78-2c52-4631-8249-09b20954fe1f';
  v_vanil constant uuid := '347b2449-1d09-4d36-9d66-09bff1ad6a38';
  v_seker_surubu constant uuid := 'ae50b092-ba62-4451-85c5-6bfa01378ffe';
  n int;
begin
  -- A) Girişi iptal edilmiş ama belgesi açık kalmış 3 fatura (Örnek Süt, 13 Ekim, Marmara) → belge de iptal.
  --    Böylece aynı faturalar düzeltilip yeniden yüklenebilir. İptal eden/zaman girişinkiyle aynı yazılır.
  update belgeler b set iptal_eden = g.iptal_eden, iptal_eden_ad = g.iptal_eden_ad, iptal_zamani = g.iptal_zamani
    from girisler g
    where g.id = b.giris_id and b.mekan_id = v_mekan and g.iptal_zamani is not null and b.iptal_zamani is null;
  get diagnostics n = row_count;
  if n <> 3 then raise exception 'A: 3 belge bekleniyordu, % bulundu', n; end if;

  -- B1) Vanilya şurubu satırları yanlışlıkla "Şeker şurubu"na bağlı → "Vanilya şurubu 700 ml", 1 şişe = 700 ml.
  update eslestirme_defteri set malzeme_id = v_vanil, carpan = 700, kaynak = 'kurulum', guncelleme = now()
    where id in (49, 174) and mekan_id = v_mekan and malzeme_id = v_seker_surubu and carpan = 700;
  get diagnostics n = row_count;
  if n <> 2 then raise exception 'B1: 2 vanilya kaydı bekleniyordu, % bulundu', n; end if;

  -- B2) Kararı yanlış/eskimiş 5 kayıt defterden kaldırılır → bu satırlar bir sonraki faturada kurulum kuyruğuna düşer,
  --     kurulum fiyat kontrolüyle yeniden karar verir:
  --     "Kolombiya Filtre Kahve 250G" → Espresso'ya 1000 g (4 kat fazla, üstelik filtre kahve);
  --     Marmara'nın UHT süt, toz şeker 5 kg, karton bardak 50'li, dome kapak 100'lü satırları "takip dışı"
  --     (bu malzemeler sonradan açıldı; böyle kalırsa Marmara'dan gelen mal stoğa hiç girmez).
  delete from eslestirme_defteri
    where id in (8, 175, 176, 177, 178) and mekan_id = v_mekan
      and ((id = 8 and sonuc = 'malzeme' and carpan = 1000) or (id <> 8 and sonuc = 'takip_disi'));
  get diagnostics n = row_count;
  if n <> 5 then raise exception 'B2: 5 kayıt bekleniyordu, % bulundu', n; end if;

  -- B3) "SODA SADE 200ML" (birim ml): 1 okunan birim = 1 şişe = 200 ml (önce 1 ml).
  update eslestirme_defteri set carpan = 200, kaynak = 'kurulum', guncelleme = now()
    where id = 186 and mekan_id = v_mekan and malzeme_id = v_soda and carpan = 1;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'B3: soda kaydı bekleniyordu, % bulundu', n; end if;

  -- C) Metro faturasındaki soda satırı: 24 ml → 24 şişe × 200 ml = 4.800 ml; fiyat 14.500 → 72,50 ₺/litre.
  update belge_satirlari set carpan = 200, stok_miktari = 4800
    where id = 357 and mekan_id = v_mekan and malzeme_id = v_soda and stok_miktari = 24;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'C1: belge satırı bekleniyordu, % bulundu', n; end if;
  update giris_kalemleri set miktar = 4800
    where id = 128 and mekan_id = v_mekan and malzeme_id = v_soda and miktar = 24;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'C2: giriş satırı bekleniyordu, % bulundu', n; end if;
  update malzeme_hareketleri set miktar = 4800
    where giris_id = '0c13d796-f44b-490f-a888-83fd744134e7' and malzeme_id = v_soda and miktar = 24;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'C3: stok hareketi bekleniyordu, % bulundu', n; end if;
  update fiyat_gecmisi set fiyat = 72.50, fiyat_haric = 72.5
    where id = 202 and mekan_id = v_mekan and malzeme_id = v_soda and fiyat = 14500;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'C4: fiyat kaydı bekleniyordu, % bulundu', n; end if;
  perform fiyat_yenile(v_soda);
  if (select fiyat from malzemeler where id = v_soda) <> 72.50 then raise exception 'C5: soda fiyatı 72,50 olmadı'; end if;
end $$;
-- Sonuç (kontrol için)
select 'belge iptal' ne, count(*)::text deger from belgeler b join girisler g on g.id = b.giris_id
  where g.iptal_zamani is not null and b.iptal_zamani is null
union all select 'soda fiyat', fiyat::text from malzemeler where id = 'cb2a9b78-2c52-4631-8249-09b20954fe1f'
union all select 'defter satır', count(*)::text from eslestirme_defteri where mekan_id = 'fea07dae-cfae-444d-a044-9c5e155cdc56';
commit;
