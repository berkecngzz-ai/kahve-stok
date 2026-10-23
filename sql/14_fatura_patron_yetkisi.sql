-- Canlıya uygulanmadı. Mevcut işlevin girişine sunucu rol kontrolü eklenir.
create or replace function public.fatura_kaydet(p_tarih date, p_tedarikci text, p_kalemler jsonb,
                                                p_toplamlar jsonb, p_belgeler jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_mekan    uuid := benim_mekanim();
  v_ad       text;
  v_id       uuid;
  k          jsonb;
  v_mal      uuid;
  v_birim    text;
  v_stokdisi boolean;
  v_metin    text;
  v_miktar   numeric;
  v_haric    numeric;
  v_oran     numeric;
  v_genel    numeric;
  v_thar     numeric;
  v_tkdv     numeric;
  v_indirim  numeric;
  v_sum_har  numeric;
  v_sum_dah  numeric;
  v_oranlar  int;
  v_pay      numeric;
  v_yol      text;
begin
  if not coalesce(patron_muyum(), false) then raise exception 'Fatura elle girişini yalnızca patron yapabilir.'; end if;
  if v_mekan is null then raise exception 'Önce bir mekana katılmalısın.'; end if;
  select ad into v_ad from uyeler where user_id = auth.uid();
  if p_tarih is null then raise exception 'Tarih seç.'; end if;
  if p_tarih > bugun() then raise exception 'Tarih bugünden ileri olamaz.'; end if;
  if p_tarih < bugun() - 366 then raise exception 'Tarih en fazla bir yıl geriye gidebilir.'; end if;
  p_tedarikci := nullif(trim(p_tedarikci), '');
  if length(p_tedarikci) > 200 then raise exception 'Tedarikçi adı en fazla 200 karakter olabilir.'; end if;
  if jsonb_typeof(p_kalemler) is distinct from 'array' or jsonb_array_length(p_kalemler) = 0 then
    raise exception 'En az bir satır gir.';
  end if;
  if jsonb_array_length(p_kalemler) > 300 then raise exception 'Bir faturada en fazla 300 satır olabilir.'; end if;

  -- Alt toplamlar
  if jsonb_typeof(p_toplamlar) is distinct from 'object' then raise exception 'Faturanın genel toplamını yaz.'; end if;
  v_genel   := case when jsonb_typeof(p_toplamlar -> 'genel') = 'number' then (p_toplamlar ->> 'genel')::numeric end;
  v_thar    := case when jsonb_typeof(p_toplamlar -> 'kdv_haric') = 'number' then (p_toplamlar ->> 'kdv_haric')::numeric end;
  v_tkdv    := case when jsonb_typeof(p_toplamlar -> 'kdv') = 'number' then (p_toplamlar ->> 'kdv')::numeric end;
  v_indirim := coalesce(case when jsonb_typeof(p_toplamlar -> 'indirim') = 'number'
                             then (p_toplamlar ->> 'indirim')::numeric end, 0);
  if v_genel is null or v_genel < 0 or v_genel >= 1000000000 then raise exception 'Faturanın genel toplamını yaz.'; end if;
  if v_thar < 0 or v_thar >= 1000000000 or v_tkdv < 0 or v_tkdv >= 1000000000
     or v_indirim < 0 or v_indirim >= 1000000000 then
    raise exception 'Fatura alt toplamları 0 ya da daha büyük bir sayı olmalı.';
  end if;

  insert into girisler (mekan_id, tur, tarih, aciklama, giren, giren_ad,
                        belge_genel_toplam, belge_kdv_haric_toplam, belge_kdv_toplam, belge_indirim)
    values (v_mekan, 'fatura', p_tarih, p_tedarikci, auth.uid(), coalesce(v_ad, '?'),
            round(v_genel, 2), round(v_thar, 2), round(v_tkdv, 2), round(v_indirim, 2))
    returning id into v_id;

  for k in select value from jsonb_array_elements(p_kalemler) loop
    if jsonb_typeof(k) is distinct from 'object' then raise exception 'Geçersiz satır.'; end if;
    v_stokdisi := coalesce(case when jsonb_typeof(k -> 'stok_disi') = 'boolean'
                                then (k ->> 'stok_disi')::boolean end, false);
    v_mal := null; v_birim := null; v_metin := null;
    if v_stokdisi then
      v_metin := nullif(trim(k ->> 'satir_metni'), '');
      if v_metin is null or length(v_metin) > 200 or k ? 'malzeme_id' then
        raise exception 'Stoğa eklenmeyen satırlara ne olduğunu yaz (örn. Deterjan).';
      end if;
      v_miktar := 0;
    else
      select id, birim into v_mal, v_birim from malzemeler
        where id::text = k ->> 'malzeme_id' and mekan_id = v_mekan;
      if v_mal is null then raise exception 'Satırlarda geçersiz bir malzeme var.'; end if;
      v_metin := nullif(trim(k ->> 'satir_metni'), '');
      if length(v_metin) > 200 then v_metin := left(v_metin, 200); end if;
      v_miktar := case when jsonb_typeof(k -> 'miktar') = 'number' then (k ->> 'miktar')::numeric end;
      if v_miktar is null or v_miktar < 0.001 or v_miktar >= 10000000000 then
        raise exception 'Miktarlar 0''dan büyük bir sayı olmalı.';
      end if;
    end if;

    v_haric := case when jsonb_typeof(k -> 'tutar_kdv_haric') = 'number' then (k ->> 'tutar_kdv_haric')::numeric end;
    v_oran  := case when jsonb_typeof(k -> 'kdv_orani') = 'number' then (k ->> 'kdv_orani')::numeric end;
    if v_haric is null or v_haric < 0 or v_haric >= 1000000000 then
      raise exception 'Satır tutarları (KDV hariç) 0 ya da daha büyük bir sayı olmalı.';
    end if;
    if v_oran is null or v_oran < 0 or v_oran > 100 then raise exception 'Her satır için KDV oranını seç.'; end if;
    if not v_stokdisi and v_haric / v_miktar * (case v_birim when 'adet' then 1 else 1000 end) >= 10000000 then
      raise exception 'Bir satırın birim fiyatı çok yüksek çıkıyor. Miktarı ve tutarı kontrol et.';
    end if;

    insert into giris_kalemleri (giris_id, mekan_id, malzeme_id, miktar, tutar, tutar_kdv_haric, kdv_orani,
                                 stok_disi, satir_metni, uyarilar)
      values (v_id, v_mekan, v_mal, round(v_miktar, 3), round(round(v_haric, 2) * (1 + v_oran / 100), 2),
              round(v_haric, 2), v_oran, v_stokdisi, v_metin,
              (select array_agg(left(x, 40)) from jsonb_array_elements_text(
                 case when jsonb_typeof(k -> 'uyarilar') = 'array' then k -> 'uyarilar' else '[]' end) x));
  end loop;

  if exists (select 1 from giris_kalemleri where giris_id = v_id and not stok_disi
             group by malzeme_id having count(*) > 1) then
    raise exception 'Aynı malzeme iki satırda var. Tek satırda topla.';
  end if;

  -- TOPLAM KONTROLÜ. Kuruş yuvarlamaları için pay: 1 TL (çok satırlı faturada satır başına 1 kuruş, hangisi büyükse);
  -- KDV toplamında oran başına bu kadar.
  select sum(tutar_kdv_haric), sum(tutar), count(distinct kdv_orani), greatest(1, 0.01 * count(*))
    into v_sum_har, v_sum_dah, v_oranlar, v_pay
    from giris_kalemleri where giris_id = v_id;
  if abs(v_sum_dah - v_indirim - v_genel) > v_pay then
    raise exception 'Satırların toplamı (% TL) faturanın genel toplamı (% TL) ile tutmuyor. Fark: % TL. Eksik ya da yanlış bir satır olabilir.',
      replace(to_char(v_sum_dah - v_indirim, 'FM999999999990.00'), '.', ','), replace(to_char(v_genel, 'FM999999999990.00'), '.', ','),
      replace(to_char(abs(v_sum_dah - v_indirim - v_genel), 'FM999999999990.00'), '.', ',');
  end if;
  if v_thar is not null and abs(v_sum_har - v_thar) > v_pay then
    raise exception 'Satırların KDV hariç toplamı (% TL) faturadaki KDV hariç toplam (% TL) ile tutmuyor.',
      replace(to_char(v_sum_har, 'FM999999999990.00'), '.', ','), replace(to_char(v_thar, 'FM999999999990.00'), '.', ',');
  end if;
  if v_tkdv is not null and abs((v_sum_dah - v_sum_har) - v_tkdv) > v_pay * v_oranlar then
    raise exception 'Satırlardan hesaplanan KDV (% TL) faturadaki KDV toplamı (% TL) ile tutmuyor. KDV oranlarını kontrol et.',
      replace(to_char(v_sum_dah - v_sum_har, 'FM999999999990.00'), '.', ','), replace(to_char(v_tkdv, 'FM999999999990.00'), '.', ',');
  end if;
  if v_thar is not null and v_tkdv is not null and abs(v_thar + v_tkdv - v_indirim - v_genel) > v_pay then
    raise exception 'Faturadaki alt toplamlar birbirini tutmuyor (KDV hariç + KDV − indirim ≠ genel toplam). Rakamları kontrol et.';
  end if;

  -- Belgeler: bu mekanın klasöründe, gerçekten yüklenmiş ve başka faturaya bağlanmamış olmalı.
  if p_belgeler is not null and jsonb_typeof(p_belgeler) <> 'null' then
    if jsonb_typeof(p_belgeler) <> 'array' then raise exception 'Geçersiz belge listesi.'; end if;
    if jsonb_array_length(p_belgeler) > 5 then raise exception 'Bir faturaya en fazla 5 belge eklenebilir.'; end if;
    for v_yol in select value from jsonb_array_elements_text(p_belgeler) loop
      if split_part(v_yol, '/', 1) <> v_mekan::text
         or not exists (select 1 from storage.objects o where o.bucket_id = 'fatura-belgeleri' and o.name = v_yol) then
        raise exception 'Belge bulunamadı. Fotoğrafı tekrar ekle.';
      end if;
      if exists (select 1 from giris_belgeleri where yol = v_yol) then
        raise exception 'Bu belge başka bir faturaya bağlı.';
      end if;
      insert into giris_belgeleri (giris_id, mekan_id, yol, tur)
        values (v_id, v_mekan, v_yol, case when lower(v_yol) like '%.pdf' then 'pdf' else 'foto' end);
    end loop;
  end if;

  -- Stoğa etkisi (stok dışı satırlar hariç)
  insert into malzeme_hareketleri (giris_id, mekan_id, malzeme_id, miktar)
    select v_id, v_mekan, malzeme_id, miktar from giris_kalemleri
    where giris_id = v_id and not stok_disi;

  -- Fiyat geçmişi: KDV hariç birim fiyat + oran; KDV dahil fiyat bunlardan hesaplanır.
  insert into fiyat_gecmisi (mekan_id, malzeme_id, fiyat, fiyat_haric, kdv_orani, tarih, kaynak, giris_id,
                             degistiren, degistiren_ad)
    select v_mekan, gk.malzeme_id, round(x.haric * (1 + gk.kdv_orani / 100), 2), x.haric, gk.kdv_orani,
           p_tarih, 'fatura', v_id, auth.uid(), v_ad
    from giris_kalemleri gk
    join malzemeler m on m.id = gk.malzeme_id
    cross join lateral (select round(gk.tutar_kdv_haric / gk.miktar
                                     * (case m.birim when 'adet' then 1 else 1000 end), 4) as haric) x
    where gk.giris_id = v_id and not gk.stok_disi and gk.tutar_kdv_haric > 0;
  perform fiyat_yenile(malzeme_id) from giris_kalemleri
    where giris_id = v_id and not stok_disi and tutar_kdv_haric > 0;

  return v_id;
end $$;
revoke all on function public.fatura_kaydet(date,text,jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.fatura_kaydet(date,text,jsonb,jsonb,jsonb) to authenticated;
