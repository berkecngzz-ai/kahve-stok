-- Geri dönüş: sql/23_kdv_sade_eslesme.sql'den önceki işlevler (2026-10-24 canlı yedeğinden alındı).

-- Eklenen sütunlar (belge_satirlari.tutar_dahil / fiyat_kontrol, giris_kalemleri.belge_satir_id) ve genişletilen

-- kısıtlar KALIR: içlerindeki veri silinmesin, eski işlevler onları yok sayar. Tek işlemde çalıştır.

begin;

-- belge_satiri_stokla(p_satir bigint)
CREATE OR REPLACE FUNCTION public.belge_satiri_stokla(p_satir bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s belge_satirlari;
  b belgeler;
  v_birim text;
  v_haric numeric;
  v_fstok numeric;    -- faturadaki miktar, stok biriminde
  v_oran  numeric;    -- gelen / faturadaki
begin
  select * into s from belge_satirlari where id = p_satir for update;
  select * into b from belgeler where id = s.belge_id for update;
  if b.giris_id is null then
    insert into girisler (mekan_id, tur, tarih, aciklama, giren, giren_ad,
                          belge_genel_toplam, belge_kdv_haric_toplam, belge_kdv_toplam, belge_indirim)
      values (b.mekan_id, 'fatura', least(coalesce(b.belge_tarihi, (b.olusturma at time zone 'Europe/Istanbul')::date),
                                         bugun()),
              b.tedarikci, b.giren, b.giren_ad, b.genel_toplam, b.kdv_haric_toplam, b.kdv_toplam, b.indirim)
      returning id into b.giris_id;
    update belgeler set giris_id = b.giris_id where id = b.id;
  end if;

  v_fstok := round(coalesce(s.miktar, 0) * coalesce(s.carpan, 0), 3);
  if v_fstok <= 0 then v_fstok := s.stok_miktari; end if;
  v_oran := case when v_fstok > 0 then s.stok_miktari / v_fstok else 1 end;

  insert into giris_kalemleri (giris_id, mekan_id, malzeme_id, miktar, tutar, tutar_kdv_haric, kdv_orani, satir_metni)
    values (b.giris_id, b.mekan_id, s.malzeme_id, s.stok_miktari,
            case when s.tutar_haric is not null and s.kdv_orani is not null
                 then round(s.tutar_haric * v_oran * (1 + s.kdv_orani / 100), 2) end,
            round(s.tutar_haric * v_oran, 2), s.kdv_orani, left(s.metin, 200));
  insert into malzeme_hareketleri (giris_id, mekan_id, malzeme_id, miktar)
    values (b.giris_id, b.mekan_id, s.malzeme_id, s.stok_miktari)
    on conflict (giris_id, malzeme_id) do update set miktar = malzeme_hareketleri.miktar + excluded.miktar;

  if s.tutar_haric > 0 and s.kdv_orani is not null and v_fstok > 0 then
    select birim into v_birim from malzemeler where id = s.malzeme_id;
    v_haric := round(s.tutar_haric / v_fstok * (case v_birim when 'adet' then 1 else 1000 end), 4);
    if v_haric < 10000000 then
      insert into fiyat_gecmisi (mekan_id, malzeme_id, fiyat, fiyat_haric, kdv_orani, tarih, kaynak, giris_id,
                                 degistiren, degistiren_ad)
        select b.mekan_id, s.malzeme_id, round(v_haric * (1 + s.kdv_orani / 100), 2), v_haric, s.kdv_orani,
               g.tarih, 'fatura', b.giris_id, b.giren, b.giren_ad
        from girisler g where g.id = b.giris_id;
      perform fiyat_yenile(s.malzeme_id);
    end if;
  end if;

  -- Sayılan, faturadakinden farklıysa (yuvarlama payı %0,5) patrona görev.
  if s.gelen_miktar is not null and v_fstok > 0
     and abs(s.stok_miktari - v_fstok) > greatest(0.001, 0.005 * greatest(s.stok_miktari, v_fstok)) then
    insert into teslimat_farklari (mekan_id, belge_id, belge_satir_id, malzeme_id, faturadaki, gelen, fark_tl,
                                   okuma_supheli, barista_notu)
      values (s.mekan_id, s.belge_id, s.id, s.malzeme_id, v_fstok, s.stok_miktari,
              case when s.tutar_haric is not null and s.kdv_orani is not null
                   then round(s.tutar_haric * (1 + s.kdv_orani / 100) / v_fstok * (v_fstok - s.stok_miktari), 2) end,
              coalesce(s.teslimat, '') = 'belirsiz', s.barista_notu)
      on conflict (belge_satir_id) do nothing;
  end if;
end $function$
;

-- belge_kaydet(p jsonb)
CREATE OR REPLACE FUNCTION public.belge_kaydet(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_mekan   uuid := benim_mekanim();
  v_ad      text;
  v_id      uuid;
  v_istek   uuid;
  v_tur     text;
  v_kaynak  text;
  v_ozet    text;
  v_ettn    text;
  v_no      text;
  v_ted     text;
  v_vkn     text;
  v_tedanah text;
  v_tarih   date;
  v_genel   numeric; v_thar numeric; v_tkdv numeric; v_ind numeric;
  v_sum     numeric := 0;
  v_pay     numeric;
  v_tutuyor boolean;
  v_onceki  belgeler;
  k         jsonb;
  v_sira    int := 0;
  v_metin   text; v_manah text; v_miktar numeric; v_birim text; v_bfiyat numeric; v_haric numeric; v_oran numeric;
  v_sinif   text; v_mal uuid; v_carpan numeric; v_aday uuid; v_onay boolean;
  v_durum   text; v_sebep text; v_cozen text; v_stok numeric; v_defter eslestirme_defteri;
  v_satir   bigint;
  v_yol     text;
  v_say_stok int := 0; v_say_bekle int := 0; v_say_disi int := 0;
  v_ai      uuid;
  v_gelen   numeric; v_sayim text; v_teslimat text; v_okunan numeric; v_not text;
  v_fstok   numeric;                       -- faturadaki miktar, stok biriminde
  v_kalemler jsonb := '[]'::jsonb;         -- işlem geçmişi için sayım özeti
begin
  if v_mekan is null then raise exception 'Önce bir mekana katılmalısın.'; end if;
  select ad into v_ad from uyeler where user_id = auth.uid();
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'Geçersiz istek.'; end if;

  begin v_istek := (p ->> 'istek_id')::uuid; exception when others then v_istek := null; end;
  if v_istek is null then raise exception 'Geçersiz istek.'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_mekan::text || v_istek::text, 0));
  select * into v_onceki from belgeler where mekan_id = v_mekan and istek_id = v_istek;
  if found then
    return jsonb_build_object('id', v_onceki.id, 'durum', v_onceki.durum, 'tekrar', true,
      'stoklanan', (select count(*) from belge_satirlari where belge_id = v_onceki.id and durum = 'stokta'),
      'bekleyen', (select count(*) from belge_satirlari where belge_id = v_onceki.id and durum = 'bekliyor'),
      'takip_disi', (select count(*) from belge_satirlari where belge_id = v_onceki.id and durum = 'takip_disi'));
  end if;

  -- AI okuması: bu mekana ait, tamamlanmış ve daha önce başka belgeye bağlanmamış olmalı
  begin v_ai := (p ->> 'ai_okuma_id')::uuid; exception when others then v_ai := null; end;
  if v_ai is not null then
    update ai_okumalari set kullanildi = true
      where id = v_ai and mekan_id = v_mekan and durum = 'tamam' and not kullanildi;
    if not found then v_ai := null; end if;
  end if;

  v_tur := coalesce(p ->> 'tur', 'fatura');
  if v_tur not in ('fatura', 'satis_raporu') then raise exception 'Geçersiz belge türü.'; end if;
  v_kaynak := p ->> 'kaynak';
  if v_kaynak is null or v_kaynak not in ('xml', 'pdf', 'ocr', 'elle', 'dosya', 'ai') then raise exception 'Geçersiz belge kaynağı.'; end if;
  if v_kaynak = 'ai' and v_ai is null then v_kaynak := 'ocr'; end if;
  v_ozet := nullif(lower(p ->> 'dosya_ozeti'), '');
  if v_ozet is not null and v_ozet !~ '^[0-9a-f]{64}$' then v_ozet := null; end if;
  v_ettn := nullif(left(trim(p ->> 'ettn'), 64), '');
  v_no   := nullif(left(upper(trim(p ->> 'fatura_no')), 64), '');
  v_ted  := nullif(left(trim(p ->> 'tedarikci'), 200), '');
  v_vkn  := nullif(regexp_replace(coalesce(p ->> 'tedarikci_vkn', ''), '\D', '', 'g'), '');
  if v_vkn is not null and v_vkn !~ '^[0-9]{10,11}$' then v_vkn := null; end if;
  v_tedanah := coalesce(v_vkn, nullif(metin_anahtari(v_ted), ''), '');
  begin v_tarih := (p ->> 'tarih')::date; exception when others then v_tarih := null; end;
  if v_tarih > bugun() or v_tarih < bugun() - 400 then v_tarih := null; end if;

  select * into v_onceki from belgeler
    where mekan_id = v_mekan and iptal_zamani is null
      and ((v_ozet is not null and dosya_ozeti = v_ozet)
        or (v_ettn is not null and ettn = v_ettn)
        or (v_no is not null and v_tedanah <> '' and tedarikci_anahtar = v_tedanah and fatura_no = v_no))
    limit 1;
  if found then
    raise exception 'Bu belge daha önce yüklenmiş (% tarihinde, %).',
      to_char(v_onceki.olusturma at time zone 'Europe/Istanbul', 'DD.MM.YYYY'), v_onceki.giren_ad;
  end if;

  if v_tur = 'fatura' then
    if jsonb_typeof(p -> 'toplamlar') is distinct from 'object' then raise exception 'Faturanın en altındaki toplamı yaz.'; end if;
    v_genel := case when jsonb_typeof(p -> 'toplamlar' -> 'genel') = 'number' then (p -> 'toplamlar' ->> 'genel')::numeric end;
    v_thar  := case when jsonb_typeof(p -> 'toplamlar' -> 'kdv_haric') = 'number' then (p -> 'toplamlar' ->> 'kdv_haric')::numeric end;
    v_tkdv  := case when jsonb_typeof(p -> 'toplamlar' -> 'kdv') = 'number' then (p -> 'toplamlar' ->> 'kdv')::numeric end;
    v_ind   := coalesce(case when jsonb_typeof(p -> 'toplamlar' -> 'indirim') = 'number' then (p -> 'toplamlar' ->> 'indirim')::numeric end, 0);
    if v_genel is null or v_genel < 0 or v_genel >= 1000000000 then raise exception 'Faturanın en altındaki toplamı yaz.'; end if;
    if coalesce(v_thar, 0) not between 0 and 999999999 or coalesce(v_tkdv, 0) not between 0 and 999999999
       or v_ind not between 0 and 999999999 then
      raise exception 'Fatura toplamları geçersiz.';
    end if;
    if jsonb_typeof(p -> 'satirlar') is distinct from 'array' or jsonb_array_length(p -> 'satirlar') = 0 then
      raise exception 'Faturada okunabilen satır yok. Fotoğrafı tekrar çek.';
    end if;
    if jsonb_array_length(p -> 'satirlar') > 300 then raise exception 'Bir faturada en fazla 300 satır olabilir.'; end if;

    if not coalesce((p ->> 'ayni_olabilir_onay')::boolean, false) then
      select * into v_onceki from belgeler
        where mekan_id = v_mekan and iptal_zamani is null and tur = 'fatura'
          and tedarikci_anahtar = v_tedanah and v_tedanah <> '' and belge_tarihi = v_tarih and genel_toplam = round(v_genel, 2)
        limit 1;
      if found then
        raise exception 'Bu fatura daha önce yüklenmiş olabilir (% tarihinde, %).',
          to_char(v_onceki.olusturma at time zone 'Europe/Istanbul', 'DD.MM.YYYY'), v_onceki.giren_ad;
      end if;
    end if;
  end if;

  insert into belgeler (mekan_id, tur, kaynak, istek_id, dosya_ozeti, ettn, fatura_no, tedarikci, tedarikci_vkn,
                        tedarikci_anahtar, belge_tarihi, genel_toplam, kdv_haric_toplam, kdv_toplam, indirim,
                        okunan, durum, giren, giren_ad, ai_okuma_id)
    values (v_mekan, v_tur, v_kaynak, v_istek, v_ozet, v_ettn, v_no, v_ted, v_vkn, v_tedanah, v_tarih,
            round(v_genel, 2), round(v_thar, 2), round(v_tkdv, 2), round(v_ind, 2),
            case when jsonb_typeof(p -> 'okunan') = 'object' and pg_column_size(p -> 'okunan') < 300000
                 then p -> 'okunan' end,
            'bekliyor', auth.uid(), coalesce(v_ad, '?'), v_ai)
    returning id into v_id;

  if jsonb_typeof(p -> 'dosyalar') = 'array' then
    if jsonb_array_length(p -> 'dosyalar') > 6 then raise exception 'Bir belgeye en fazla 6 dosya eklenebilir.'; end if;
    for v_yol in select value from jsonb_array_elements_text(p -> 'dosyalar') loop
      if split_part(v_yol, '/', 1) <> v_mekan::text
         or not exists (select 1 from storage.objects o where o.bucket_id = 'fatura-belgeleri' and o.name = v_yol) then
        raise exception 'Belge dosyası bulunamadı. Tekrar dene.';
      end if;
      if exists (select 1 from belge_dosyalari where yol = v_yol) or exists (select 1 from giris_belgeleri where yol = v_yol) then
        raise exception 'Bu dosya başka bir belgeye bağlı.';
      end if;
      insert into belge_dosyalari (belge_id, mekan_id, yol, tur)
        values (v_id, v_mekan, v_yol, case when lower(v_yol) like '%.pdf' then 'pdf'
                                            when lower(v_yol) like '%.xml' then 'xml'
                                            when lower(v_yol) ~ '\.(jpg|jpeg|png|webp)$' then 'foto' else 'diger' end);
    end loop;
  end if;

  if v_tur = 'satis_raporu' then
    if not exists (select 1 from belge_dosyalari where belge_id = v_id) then raise exception 'Satış raporunun fotoğrafını ya da dosyasını ekle.'; end if;
    return jsonb_build_object('id', v_id, 'durum', 'bekliyor', 'stoklanan', 0, 'bekleyen', 0, 'takip_disi', 0, 'tekrar', false);
  end if;

  for k in select value from jsonb_array_elements(p -> 'satirlar') loop
    if jsonb_typeof(k) is distinct from 'object' then raise exception 'Geçersiz satır.'; end if;
    v_sira := v_sira + 1;
    v_metin := left(trim(coalesce(k ->> 'metin', '')), 300);
    if v_metin = '' then v_metin := '(okunamadı)'; end if;
    v_manah := coalesce(nullif(metin_anahtari(v_metin), ''), '-');
    v_miktar := case when jsonb_typeof(k -> 'miktar') = 'number' and (k ->> 'miktar')::numeric between 0 and 9999999999
                     then round((k ->> 'miktar')::numeric, 3) end;
    v_birim := case when k ->> 'birim' in ('adet', 'kg', 'g', 'lt', 'ml') then k ->> 'birim' else 'diger' end;
    v_bfiyat := case when jsonb_typeof(k -> 'birim_fiyat') = 'number' and (k ->> 'birim_fiyat')::numeric between 0 and 9999999999
                     then round((k ->> 'birim_fiyat')::numeric, 4) end;
    v_haric := case when jsonb_typeof(k -> 'tutar_haric') = 'number' and (k ->> 'tutar_haric')::numeric between 0 and 999999999
                    then round((k ->> 'tutar_haric')::numeric, 2) end;
    v_oran := case when jsonb_typeof(k -> 'kdv_orani') = 'number' and (k ->> 'kdv_orani')::numeric between 0 and 100
                   then (k ->> 'kdv_orani')::numeric end;
    v_sinif := k ->> 'sinif';
    v_mal := null; v_aday := null; v_carpan := null;
    begin v_mal := (k ->> 'malzeme_id')::uuid; exception when others then v_mal := null; end;
    begin v_aday := (k ->> 'aday_malzeme_id')::uuid; exception when others then v_aday := null; end;
    if v_mal is not null and not exists (select 1 from malzemeler where id = v_mal and mekan_id = v_mekan) then v_mal := null; end if;
    if v_aday is not null and not exists (select 1 from malzemeler where id = v_aday and mekan_id = v_mekan) then v_aday := null; end if;
    v_carpan := case when jsonb_typeof(k -> 'carpan') = 'number' and (k ->> 'carpan')::numeric between 0.000001 and 1000000
                     then (k ->> 'carpan')::numeric end;
    v_onay := coalesce(case when jsonb_typeof(k -> 'barista_onayi') = 'boolean' then (k ->> 'barista_onayi')::boolean end, false);
    -- Kör sayım: baristanın saydığı (belge birimiyle). Sayılmadıysa (dökme/tartılı) stok faturadaki kadar.
    v_gelen := case when jsonb_typeof(k -> 'gelen_miktar') = 'number' and (k ->> 'gelen_miktar')::numeric between 0 and 9999999999
                    then round((k ->> 'gelen_miktar')::numeric, 3) end;
    v_sayim := case when k ->> 'sayim' in ('sayildi', 'sayilmadi') then k ->> 'sayim' end;
    if v_sayim = 'sayilmadi' then v_gelen := null; end if;
    if v_gelen is not null then v_sayim := 'sayildi'; end if;
    v_teslimat := case when k ->> 'teslimat' in ('tam', 'okuma_hatasi', 'teslimat_farki', 'belirsiz') then k ->> 'teslimat' end;
    v_okunan := case when jsonb_typeof(k -> 'okunan_miktar') = 'number' and (k ->> 'okunan_miktar')::numeric between 0 and 9999999999
                     then round((k ->> 'okunan_miktar')::numeric, 3) end;
    v_not := nullif(left(trim(coalesce(k ->> 'barista_notu', '')), 300), '');
    v_sum := v_sum + coalesce(v_haric * (1 + coalesce(v_oran, 0) / 100), 0);

    v_durum := 'bekliyor'; v_sebep := 'eslesme'; v_cozen := null; v_stok := null;
    if v_sinif = 'takip_disi' and exists (
         select 1 from eslestirme_defteri
         where mekan_id = v_mekan and metin_anahtar = v_manah and birim = v_birim and sonuc = 'takip_disi'
           and tedarikci_anahtar in (v_tedanah, '')) then
      v_durum := 'takip_disi'; v_sebep := null; v_cozen := 'otomatik'; v_mal := null;
    elsif v_sinif = 'takip_disi' and v_ai is not null and ai_takip_disi_mi(v_ai, v_mekan, v_sira, v_manah) then
      -- AI (sunucudaki kaydına göre) bu satır için emin olarak "takip dışı" demiş
      v_durum := 'takip_disi'; v_sebep := null; v_cozen := 'ai'; v_mal := null;
    elsif v_sinif = 'takip_disi' then
      v_aday := null; v_mal := null;
    elsif v_sinif = 'eslesti' and v_mal is not null and v_carpan is not null then
      select * into v_defter from eslestirme_defteri
        where mekan_id = v_mekan and metin_anahtar = v_manah and birim = v_birim and sonuc = 'malzeme'
          and tedarikci_anahtar in (v_tedanah, '') and malzeme_id = v_mal and carpan = v_carpan
        order by (tedarikci_anahtar = v_tedanah) desc limit 1;
      if found then
        v_cozen := 'otomatik';
      elsif exists (select 1 from eslestirme_defteri
                    where mekan_id = v_mekan and metin_anahtar = v_manah and birim = v_birim and kaynak = 'kurulum'
                      and tedarikci_anahtar in (v_tedanah, '')) then
        v_cozen := null;
      elsif v_onay then
        v_cozen := 'barista';
        insert into eslestirme_defteri (mekan_id, tedarikci_anahtar, metin_anahtar, birim, sonuc, malzeme_id, carpan, kaynak)
          values (v_mekan, v_tedanah, v_manah, v_birim, 'malzeme', v_mal, v_carpan, 'barista')
          on conflict (mekan_id, tedarikci_anahtar, metin_anahtar, birim) do update
            set sonuc = 'malzeme', malzeme_id = excluded.malzeme_id, carpan = excluded.carpan,
                kaynak = 'barista', guncelleme = now()
            where eslestirme_defteri.kaynak <> 'kurulum';
      end if;
      if v_cozen is not null then
        if v_miktar is null or v_miktar = 0 then
          v_sebep := 'eksik';
        else
          v_fstok := round(v_miktar * v_carpan, 3);
          v_stok := round(coalesce(v_gelen, v_miktar) * v_carpan, 3);     -- stok SAYILAN kadar
          if v_haric is null or v_oran is null then
            v_sebep := 'eksik';
          elsif v_bfiyat is not null and abs(v_miktar * v_bfiyat - v_haric) > greatest(1, v_haric * 0.01) then
            v_sebep := 'tutar';
          else
            v_sebep := satir_olagandisi(v_mekan, v_mal, v_fstok, v_haric, v_oran);
          end if;
        end if;
        if v_sebep is null then v_durum := 'stokta'; end if;
      else
        v_aday := coalesce(v_aday, v_mal); v_mal := null;
      end if;
    else
      v_aday := coalesce(v_aday, v_mal); v_mal := null;
    end if;
    if v_durum = 'bekliyor' and v_sebep = 'eslesme' then v_mal := null; v_stok := null; end if;

    insert into belge_satirlari (belge_id, mekan_id, sira, metin, metin_anahtar, miktar, birim, birim_fiyat, tutar_haric,
                                 kdv_orani, durum, bekleme_sebebi, aday_malzeme_id, malzeme_id, carpan, stok_miktari,
                                 cozen, cozum_zamani, gelen_miktar, sayim, teslimat, okunan_miktar, barista_notu)
      values (v_id, v_mekan, v_sira, v_metin, v_manah, v_miktar, v_birim, v_bfiyat, v_haric, v_oran,
              case when v_durum = 'stokta' then 'bekliyor' else v_durum end,
              case when v_durum = 'stokta' then 'toplam' else v_sebep end,
              v_aday, v_mal, case when v_mal is not null then v_carpan end, v_stok,
              v_cozen, case when v_cozen is not null then now() end, v_gelen, v_sayim, v_teslimat, v_okunan, v_not);
    if v_sayim is not null or v_teslimat is not null then
      v_kalemler := v_kalemler || jsonb_build_object('sira', v_sira, 'metin', left(v_metin, 120), 'faturadaki', v_miktar,
        'gelen', v_gelen, 'sayim', v_sayim, 'teslimat', v_teslimat, 'okunan', v_okunan, 'not', v_not);
    end if;
  end loop;

  v_pay := greatest(1, 0.01 * v_sira);
  v_tutuyor := abs(round(v_sum, 2) - v_ind - v_genel) <= v_pay
               and (v_thar is null or abs((select coalesce(sum(tutar_haric), 0) from belge_satirlari where belge_id = v_id) - v_thar) <= v_pay)
               and not exists (select 1 from belge_satirlari where belge_id = v_id and tutar_haric is null);
  update belgeler set toplam_tutuyor = v_tutuyor where id = v_id;

  if v_tutuyor then
    for v_satir in select id from belge_satirlari
                   where belge_id = v_id and durum = 'bekliyor' and bekleme_sebebi = 'toplam' order by sira loop
      update belge_satirlari set durum = 'stokta', bekleme_sebebi = null where id = v_satir;
      perform belge_satiri_stokla(v_satir);
    end loop;
  end if;

  perform belge_durumu_yenile(v_id);
  perform islem_yaz(v_mekan, 'mal_kabul', (select giris_id from belgeler where id = v_id), v_id,
    jsonb_build_object('tedarikci', v_ted, 'fatura_no', v_no, 'kaynak', v_kaynak, 'toplam_tutuyor', v_tutuyor,
                       'karekod', p -> 'okunan' -> 'karekod_kontrol', 'kalemler', v_kalemler));
  select count(*) filter (where durum = 'stokta'), count(*) filter (where durum = 'bekliyor'),
         count(*) filter (where durum = 'takip_disi')
    into v_say_stok, v_say_bekle, v_say_disi from belge_satirlari where belge_id = v_id;
  return jsonb_build_object('id', v_id, 'durum', (select durum from belgeler where id = v_id), 'tekrar', false,
    'toplam_tutuyor', v_tutuyor, 'stoklanan', v_say_stok, 'bekleyen', v_say_bekle, 'takip_disi', v_say_disi);
end $function$
;

-- kurulum_kuyrugu()
CREATE OR REPLACE FUNCTION public.kurulum_kuyrugu()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not kurulumcu_muyum() then raise exception 'Bu işlem yalnızca kurulum hesabına açık.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'mekan_id', k.id, 'mekan', k.ad,
      'malzemeler', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'ad', m.ad, 'birim', m.birim) order by m.ad), '[]')
                     from malzemeler m where m.mekan_id = k.id and m.aktif),
      'urunler', (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'ad', u.ad) order by u.ad), '[]')
                  from urunler u where u.mekan_id = k.id and u.aktif),
      'belgeler', (select jsonb_agg(jsonb_build_object(
          'id', b.id, 'tur', b.tur, 'kaynak', b.kaynak, 'tedarikci', b.tedarikci, 'tarih', b.belge_tarihi,
          'fatura_no', b.fatura_no, 'genel_toplam', b.genel_toplam, 'kdv_haric_toplam', b.kdv_haric_toplam,
          'indirim', b.indirim, 'toplam_tutuyor', b.toplam_tutuyor, 'giren_ad', b.giren_ad, 'olusturma', b.olusturma,
          'dosyalar', (select coalesce(jsonb_agg(jsonb_build_object('yol', d.yol, 'tur', d.tur)), '[]')
                       from belge_dosyalari d where d.belge_id = b.id),
          'satirlar', (select coalesce(jsonb_agg(jsonb_build_object(
              'id', s.id, 'sira', s.sira, 'metin', s.metin, 'miktar', s.miktar, 'birim', s.birim,
              'birim_fiyat', s.birim_fiyat, 'tutar_haric', s.tutar_haric, 'kdv_orani', s.kdv_orani,
              'durum', s.durum, 'sebep', s.bekleme_sebebi, 'aday_malzeme_id', s.aday_malzeme_id,
              'malzeme_id', s.malzeme_id, 'carpan', s.carpan) order by s.sira), '[]')
            from belge_satirlari s where s.belge_id = b.id)) order by b.olusturma)
        from belgeler b where b.mekan_id = k.id and b.durum = 'bekliyor' and b.iptal_zamani is null)))
    from mekanlar k
    where exists (select 1 from belgeler b where b.mekan_id = k.id and b.durum = 'bekliyor' and b.iptal_zamani is null)
  ), '[]'::jsonb);
end $function$
;

-- kurulum_ai_takip_disi()
CREATE OR REPLACE FUNCTION public.kurulum_ai_takip_disi()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not kurulumcu_muyum() then raise exception 'Bu işlem yalnızca kurulum hesabına açık.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'mekan', k.ad, 'metin', s.metin, 'miktar', s.miktar, 'birim', s.birim,
                                        'tarih', b.olusturma, 'tedarikci', b.tedarikci) order by b.olusturma desc)
    from (select * from belge_satirlari where cozen = 'ai' and durum = 'takip_disi' order by id desc limit 100) s
    join belgeler b on b.id = s.belge_id and b.iptal_zamani is null
    join mekanlar k on k.id = s.mekan_id), '[]'::jsonb);
end $function$
;

-- elle_mal_kabul(p_istek uuid, p_aciklama text, p_kalemler jsonb)
CREATE OR REPLACE FUNCTION public.elle_mal_kabul(p_istek uuid, p_aciklama text, p_kalemler jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_mekan uuid := benim_mekanim();
  v_ad text;
  v_id uuid;
  k jsonb;
  m malzemeler;
  v_miktar numeric;
  v_tutar numeric;
  v_oran numeric;
  v_haric numeric;
  v_birim_fiyat numeric;
  v_uyari text[];
begin
  if v_mekan is null then raise exception 'Önce bir mekana katılmalısın.'; end if;
  if p_istek is null then raise exception 'Geçersiz istek.'; end if;
  if jsonb_typeof(p_kalemler) is distinct from 'array' or jsonb_array_length(p_kalemler) = 0 then
    raise exception 'En az bir malzeme seç.';
  end if;
  if jsonb_array_length(p_kalemler) > 50 then raise exception 'Bir girişte en fazla 50 kalem olabilir.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_mekan::text || p_istek::text, 0));
  select giris_id into v_id from giris_istekleri where mekan_id = v_mekan and istek_id = p_istek;
  if found then return v_id; end if;

  select ad into v_ad from uyeler where user_id = auth.uid();
  insert into girisler (mekan_id, tur, tarih, aciklama, giren, giren_ad)
    values (v_mekan, 'fatura', bugun(),
            left('Elle giriş' || coalesce(' · ' || nullif(trim(p_aciklama), ''), ''), 200), auth.uid(), coalesce(v_ad, '?'))
    returning id into v_id;

  for k in select value from jsonb_array_elements(p_kalemler) loop
    select * into m from malzemeler
      where id = case when k ->> 'malzeme_id' ~ '^[0-9a-fA-F-]{36}$' then (k ->> 'malzeme_id')::uuid end
        and mekan_id = v_mekan and aktif;
    if not found then raise exception 'Malzeme bulunamadı.'; end if;
    v_miktar := case when jsonb_typeof(k -> 'miktar') = 'number' then round((k ->> 'miktar')::numeric, 3) end;
    if v_miktar is null or v_miktar <= 0 or v_miktar >= 10000000 then raise exception '% için miktarı yaz.', m.ad; end if;
    v_tutar := case when jsonb_typeof(k -> 'tutar') = 'number' then round((k ->> 'tutar')::numeric, 2) end;
    if v_tutar is not null and (v_tutar < 0 or v_tutar >= 10000000) then raise exception '% için tutar geçersiz.', m.ad; end if;
    v_oran := coalesce(m.kdv_orani, 0);
    v_haric := case when v_tutar is not null then round(v_tutar / (1 + v_oran / 100), 2) end;
    v_uyari := null;
    -- Kayıtlı fiyattan %30'dan fazla sapan tutar fiyatı değiştirmez; patron kontrol eder.
    if v_tutar > 0 and satir_olagandisi(v_mekan, m.id, v_miktar, v_haric, v_oran) = 'fiyat' then
      v_uyari := array['fiyat_kontrol'];
    end if;
    insert into giris_kalemleri (giris_id, mekan_id, malzeme_id, miktar, tutar, tutar_kdv_haric, kdv_orani, satir_metni, uyarilar)
      values (v_id, v_mekan, m.id, v_miktar, v_tutar, v_haric, case when v_tutar is not null then v_oran end, 'Elle giriş', v_uyari);
    insert into malzeme_hareketleri (giris_id, mekan_id, malzeme_id, miktar)
      values (v_id, v_mekan, m.id, v_miktar)
      on conflict (giris_id, malzeme_id) do update set miktar = malzeme_hareketleri.miktar + excluded.miktar;
    if v_tutar > 0 and v_uyari is null then
      v_birim_fiyat := round(v_haric / v_miktar * (case m.birim when 'adet' then 1 else 1000 end), 4);
      insert into fiyat_gecmisi (mekan_id, malzeme_id, fiyat, fiyat_haric, kdv_orani, tarih, kaynak, giris_id, degistiren, degistiren_ad)
        values (v_mekan, m.id, round(v_birim_fiyat * (1 + v_oran / 100), 2), v_birim_fiyat, v_oran, bugun(), 'fatura', v_id,
                auth.uid(), coalesce(v_ad, '?'));
      perform fiyat_yenile(m.id);
    end if;
  end loop;

  insert into giris_istekleri (mekan_id, istek_id, giris_id) values (v_mekan, p_istek, v_id);
  return v_id;
end $function$
;

-- fiyat_degisimleri()
CREATE OR REPLACE FUNCTION public.fiyat_degisimleri()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_mekan uuid := benim_mekanim();
  v_bugun date := bugun();
  v_satis_var boolean;
begin
  if v_mekan is null or not patron_muyum() then raise exception 'Fiyat bilgisi yalnız patrona açık.'; end if;
  -- Son 28 günde satış raporu yoksa kullanım bilinmez → TL etkisi hesaplanmaz.
  select exists (select 1 from girisler where mekan_id = v_mekan and tur = 'satis' and iptal_zamani is null
                   and tarih > v_bugun - 28) into v_satis_var;
  return coalesce((
    with fiyat as (
      select f.malzeme_id, f.fiyat, f.tarih,
             row_number() over (partition by f.malzeme_id order by f.tarih desc, f.zaman desc, f.id desc) sira
      from fiyat_gecmisi f join girisler g on g.id = f.giris_id
      where f.mekan_id = v_mekan and f.kaynak = 'fatura' and g.iptal_zamani is null
    ),
    ort as (
      select gk.malzeme_id, sum(gk.tutar) tutar, sum(gk.miktar) miktar
      from giris_kalemleri gk join girisler g on g.id = gk.giris_id
      where g.mekan_id = v_mekan and g.tur = 'fatura' and g.iptal_zamani is null and g.tarih > v_bugun - 90
        and gk.malzeme_id is not null and not gk.stok_disi and gk.miktar > 0 and gk.tutar > 0
      group by gk.malzeme_id
    ),
    kullanim as (
      select h.malzeme_id, sum(h.miktar) * 30.0 / 28 aylik
      from malzeme_hareketleri h join girisler g on g.id = h.giris_id
      where g.mekan_id = v_mekan and g.iptal_zamani is null and g.tur in ('satis', 'fire') and g.tarih > v_bugun - 28
      group by h.malzeme_id
    ),
    satir as (
      select m.id, m.ad, m.birim, s.fiyat son, s.tarih son_tarih, o.fiyat onceki, o.tarih onceki_tarih,
             case when a.miktar > 0 then round(a.tutar / a.miktar * (case m.birim when 'adet' then 1 else 1000 end), 2) end ortalama,
             case when v_satis_var then coalesce(k.aylik, 0) end aylik_kullanim
      from malzemeler m
      join fiyat s on s.malzeme_id = m.id and s.sira = 1
      join fiyat o on o.malzeme_id = m.id and o.sira = 2
      left join ort a on a.malzeme_id = m.id
      left join kullanim k on k.malzeme_id = m.id
      where m.mekan_id = v_mekan and m.aktif and o.fiyat > 0
    )
    select jsonb_agg(jsonb_build_object(
             'malzeme_id', id, 'ad', ad, 'birim', birim, 'son', son, 'son_tarih', son_tarih,
             'onceki', onceki, 'onceki_tarih', onceki_tarih, 'ortalama', ortalama,
             'degisim_yuzde', round((son - onceki) / onceki * 100, 1),
             'aylik_kullanim', round(aylik_kullanim, 0),
             'aylik_etki', case when aylik_kullanim is not null
                                then round((son - onceki) * aylik_kullanim / (case birim when 'adet' then 1 else 1000 end), 0) end,
             'uyari', (son - onceki) / onceki > 0.05 and aylik_kullanim is not null
                      and (son - onceki) * aylik_kullanim / (case birim when 'adet' then 1 else 1000 end) > 250)
           order by abs(son - onceki) / onceki desc)
    from satir), '[]'::jsonb);
end $function$
;

-- gunluk_kontrol()
CREATE OR REPLACE FUNCTION public.gunluk_kontrol()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_mekan uuid := benim_mekanim();
  v_bugun date := bugun();
begin
  if v_mekan is null or not patron_muyum() then raise exception 'Bu bilgi yalnız patrona açık.'; end if;
  return jsonb_build_object(
    'bugun', v_bugun,
    'son_sayim', (select max(tarih) from girisler where mekan_id = v_mekan and tur = 'sayim' and iptal_zamani is null),
    'son_satis', (select max(tarih) from girisler where mekan_id = v_mekan and tur = 'satis' and iptal_zamani is null),
    'acik_teslimat', (select count(*) from teslimat_farklari where mekan_id = v_mekan and durum = 'acik'),
    'acik_teslimat_tl', (select coalesce(sum(fark_tl) filter (where fark_tl > 0), 0) from teslimat_farklari
                          where mekan_id = v_mekan and durum = 'acik'),
    -- Son 7 günde elle girilen ve fiyatı patron kontrolü bekleyen kalemler
    'elle_fiyat_kontrol', coalesce((select jsonb_agg(jsonb_build_object('malzeme', m.ad, 'miktar', gk.miktar, 'birim', m.birim,
                                       'tutar', gk.tutar, 'giren_ad', g.giren_ad, 'tarih', g.tarih) order by g.tarih desc)
                            from giris_kalemleri gk join girisler g on g.id = gk.giris_id join malzemeler m on m.id = gk.malzeme_id
                            where g.mekan_id = v_mekan and g.iptal_zamani is null and g.tarih > v_bugun - 7
                              and 'fiyat_kontrol' = any(gk.uyarilar)), '[]'::jsonb),
    'elle_giris_7gun', (select count(*) from girisler where mekan_id = v_mekan and tur = 'fatura' and iptal_zamani is null
                          and tarih > v_bugun - 7 and aciklama like 'Elle giriş%'));
end $function$
;

drop function if exists public.kurulum_satir_bagla(bigint, uuid, numeric, numeric, numeric, boolean, boolean);
drop function if exists public.fiyat_kontrol_coz(bigint, numeric);
drop function if exists public.fiyat_kontrolleri();
drop function if exists public.satir_dahil_tutar(numeric, numeric, numeric);
commit;
