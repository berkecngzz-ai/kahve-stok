-- 27: Ürün firesi (ör. dökülen Latte) fire GÜNÜNDE geçerli reçete sürümüyle malzemeye çevrilir (2026-10-26).
-- Önceden güncel reçete (tarif_kalemleri) kullanılıyordu: reçete değiştikten sonra eski tarihli fire yanlış düşerdi.
-- Yalnız bu satır değişti; işlevin geri kalanı canlıdaki giris_kaydet_v1 ile aynıdır. Geri alma: scripts/geri-al-27.sql
CREATE OR REPLACE FUNCTION public.giris_kaydet_v1(p_tur text, p_tarih date, p_aciklama text, p_kalemler jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$

declare

  v_mekan  uuid := benim_mekanim();

  v_ad     text;

  v_id     uuid;

  k        jsonb;

  v_mal    uuid;

  v_urun   uuid;

  v_birim  text;

  v_miktar numeric;

  v_tutar  numeric;

begin

  if v_mekan is null then raise exception 'Önce bir mekana katılmalısın.'; end if;

  select ad into v_ad from uyeler where user_id = auth.uid();

  if p_tur is null or p_tur not in ('fatura', 'satis', 'fire', 'sayim') then

    raise exception 'Geçersiz giriş türü.';

  end if;

  if p_tarih is null then raise exception 'Tarih seç.'; end if;

  if p_tarih > bugun() then raise exception 'Tarih bugünden ileri olamaz.'; end if;

  if p_tarih < bugun() - 366 then raise exception 'Tarih en fazla bir yıl geriye gidebilir.'; end if;

  p_aciklama := nullif(trim(p_aciklama), '');

  if length(p_aciklama) > 200 then raise exception 'Açıklama en fazla 200 karakter olabilir.'; end if;

  if p_tur = 'fire' and p_aciklama is null then raise exception 'Fire sebebini seç.'; end if;

  if jsonb_typeof(p_kalemler) is distinct from 'array' or jsonb_array_length(p_kalemler) = 0 then

    raise exception 'En az bir satır gir.';

  end if;

  if jsonb_array_length(p_kalemler) > 300 then raise exception 'Bir girişte en fazla 300 satır olabilir.'; end if;



  insert into girisler (mekan_id, tur, tarih, aciklama, giren, giren_ad)

    values (v_mekan, p_tur, p_tarih, p_aciklama, auth.uid(), coalesce(v_ad, '?'))

    returning id into v_id;



  for k in select value from jsonb_array_elements(p_kalemler) loop

    if jsonb_typeof(k) is distinct from 'object' then raise exception 'Geçersiz satır.'; end if;

    v_mal := null; v_urun := null; v_birim := null;

    if p_tur <> 'satis' then

      select id, birim into v_mal, v_birim from malzemeler

        where id::text = k ->> 'malzeme_id' and mekan_id = v_mekan;

    end if;

    if p_tur in ('satis', 'fire') then

      select id into v_urun from urunler where id::text = k ->> 'urun_id' and mekan_id = v_mekan;

    end if;

    if (v_mal is null) = (v_urun is null) or (k ? 'malzeme_id') <> (v_mal is not null)

       or (k ? 'urun_id') <> (v_urun is not null) then

      raise exception 'Satırlarda geçersiz bir malzeme ya da ürün var.';

    end if;



    v_miktar := case when jsonb_typeof(k -> 'miktar') = 'number' then (k ->> 'miktar')::numeric end;

    if v_urun is not null then

      if v_miktar is null or v_miktar <> trunc(v_miktar) or v_miktar not between 1 and 100000 then

        raise exception 'Ürün adetleri 1 ile 100.000 arasında tam sayı olmalı.';

      end if;

    elsif p_tur = 'sayim' then

      if v_miktar is null or v_miktar < 0 or v_miktar >= 10000000000 then

        raise exception 'Sayım miktarları 0 ya da daha büyük bir sayı olmalı.';

      end if;

    elsif v_miktar is null or v_miktar < 0.001 or v_miktar >= 10000000000 then

      raise exception 'Miktarlar 0''dan büyük bir sayı olmalı.';

    end if;



    v_tutar := null;

    if p_tur = 'fatura' then

      v_tutar := case when jsonb_typeof(k -> 'tutar') = 'number' then (k ->> 'tutar')::numeric end;

      if v_tutar is null or v_tutar < 0 or v_tutar >= 1000000000 then

        raise exception 'Fatura tutarları 0 ya da daha büyük bir sayı olmalı.';

      end if;

      if v_tutar / v_miktar * (case v_birim when 'adet' then 1 else 1000 end) >= 10000000 then

        raise exception 'Bir satırın birim fiyatı çok yüksek çıkıyor. Miktarı ve tutarı kontrol et.';

      end if;

    end if;



    insert into giris_kalemleri (giris_id, mekan_id, malzeme_id, urun_id, miktar, tutar)

      values (v_id, v_mekan, v_mal, v_urun, round(v_miktar, 3), round(v_tutar, 2));

  end loop;



  if exists (select 1 from giris_kalemleri where giris_id = v_id

             group by coalesce(malzeme_id, urun_id) having count(*) > 1) then

    raise exception 'Aynı malzeme ya da ürün iki satırda var. Tek satırda topla.';

  end if;



  -- Malzemelere etkisi (ürünler GİRİŞ GÜNÜNDE geçerli tarif sürümüyle malzemeye çevrilir; sql/27).

  insert into malzeme_hareketleri (giris_id, mekan_id, malzeme_id, miktar)

    select v_id, v_mekan, x.malzeme_id, sum(x.miktar)

    from (

      select gk.malzeme_id, gk.miktar from giris_kalemleri gk

        where gk.giris_id = v_id and gk.malzeme_id is not null

      union all

      select t.malzeme_id, t.miktar * gk.miktar from giris_kalemleri gk

        cross join lateral tarif_gecerli(gk.urun_id, p_tarih) t

        where gk.giris_id = v_id and gk.urun_id is not null

    ) x

    group by x.malzeme_id;



  -- Faturadaki fiyatlar geçmişe yazılır; güncel fiyat en yeni tarihli kayda göre ayarlanır.

  if p_tur = 'fatura' then

    insert into fiyat_gecmisi (mekan_id, malzeme_id, fiyat, tarih, kaynak, giris_id, degistiren, degistiren_ad)

      select v_mekan, gk.malzeme_id,

             round(gk.tutar / gk.miktar * (case m.birim when 'adet' then 1 else 1000 end), 2),

             p_tarih, 'fatura', v_id, auth.uid(), v_ad

      from giris_kalemleri gk join malzemeler m on m.id = gk.malzeme_id

      where gk.giris_id = v_id and gk.tutar > 0;

    perform fiyat_yenile(malzeme_id) from giris_kalemleri where giris_id = v_id and tutar > 0;

  end if;



  return v_id;

end $function$;
