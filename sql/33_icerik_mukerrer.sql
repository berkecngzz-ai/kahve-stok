-- 33_icerik_mukerrer.sql: aynı fatura başka dosya türüyle (PDF ↔ fotoğraf) ikinci kez stoğa girmez.
-- Sorun (canlı test, 2026-10-28): aynı faturanın PDF'i ve fotoğrafı ayrı fatura sayıldı, ikisi de stoğa girdi.
-- Mükerrer kontrolü yalnız başlık alanlarına bakıyordu (dosya özeti, ETTN, tedarikçi+numara, tedarikçi+tarih+toplam);
-- PDF okuyucu numarayı kesik, tedarikçiyi boş okuyunca hiçbiri tutmadı.
-- Çözüm: başlıktan bağımsız İÇERİK izi. Aynı mekânda, iptal edilmemiş, aynı fatura tarihli (tarih okunamadıysa aynı yükleme
-- günü), aynı genel toplamlı ve satır tutarları (KDV dahil, kuruşa yuvarlı) birebir aynı bir fatura varsa "daha önce
-- yüklenmiş olabilir" denir; uygulama "Aynı fatura mı?" diye sorar (ayni_olabilir_onay ile farklıysa kaydedilir).
-- Miktar ize girmez: tutar faturanın makine verisidir, miktar ise okumada en çok bozulan alandır.
begin;

-- Satır tutarlarının izi: KDV dahil tutar, kuruşa yuvarlı, sıralı
create or replace function public.fatura_tutar_izi(p_tutarlar numeric[]) returns text
language sql immutable as $$
  select string_agg(to_char(t, 'FM999999999990.00'), '|' order by t) from unnest(p_tutarlar) t
$$;

alter function public.belge_kaydet(jsonb) rename to belge_kaydet_v31;
create or replace function public.belge_kaydet(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_mekan uuid := benim_mekanim();
  v_tarih date;
  v_genel numeric;
  v_iz text;
  v_onceki belgeler;
begin
  if p ->> 'tur' = 'fatura' and not coalesce((p ->> 'ayni_olabilir_onay')::boolean, false) and v_mekan is not null
     and jsonb_typeof(p -> 'satirlar') = 'array' and jsonb_array_length(p -> 'satirlar') > 0 then
    begin v_tarih := (p ->> 'tarih')::date; exception when others then v_tarih := null; end;
    if v_tarih > bugun() or v_tarih < bugun() - 400 then v_tarih := null; end if;
    v_genel := case when jsonb_typeof(p -> 'toplamlar' -> 'genel') = 'number' then round((p -> 'toplamlar' ->> 'genel')::numeric, 2) end;
    select fatura_tutar_izi(array_agg(round(satir_dahil_tutar(
             case when jsonb_typeof(k -> 'tutar_dahil') = 'number' then (k ->> 'tutar_dahil')::numeric end,
             case when jsonb_typeof(k -> 'tutar_haric') = 'number' then (k ->> 'tutar_haric')::numeric end,
             case when jsonb_typeof(k -> 'kdv_orani') = 'number' then (k ->> 'kdv_orani')::numeric end), 2)))
      into v_iz from jsonb_array_elements(p -> 'satirlar') k;
    -- Tutarı okunamayan satır varsa iz güvenilmez (null): içerik kontrolü atlanır, başlık kontrolleri yine çalışır.
    if v_genel is not null and v_iz is not null
       and (select bool_and(satir_dahil_tutar(
              case when jsonb_typeof(k -> 'tutar_dahil') = 'number' then (k ->> 'tutar_dahil')::numeric end,
              case when jsonb_typeof(k -> 'tutar_haric') = 'number' then (k ->> 'tutar_haric')::numeric end,
              case when jsonb_typeof(k -> 'kdv_orani') = 'number' then (k ->> 'kdv_orani')::numeric end) is not null)
            from jsonb_array_elements(p -> 'satirlar') k) then
      select b.* into v_onceki from belgeler b
        where b.mekan_id = v_mekan and b.tur = 'fatura' and b.iptal_zamani is null and b.genel_toplam = v_genel
          and coalesce(b.belge_tarihi, (b.olusturma at time zone 'Europe/Istanbul')::date) = coalesce(v_tarih, bugun())
          and (select fatura_tutar_izi(array_agg(round(satir_dahil_tutar(s.tutar_dahil, s.tutar_haric, s.kdv_orani), 2)))
               from belge_satirlari s where s.belge_id = b.id) = v_iz
        order by b.olusturma desc limit 1;
      if found then
        raise exception 'Bu fatura daha önce yüklenmiş olabilir (% tarihinde, %).',
          to_char(v_onceki.olusturma at time zone 'Europe/Istanbul', 'DD.MM.YYYY'), v_onceki.giren_ad;
      end if;
    end if;
  end if;
  return belge_kaydet_v31(p);
end $$;

revoke all on function public.belge_kaydet_v31(jsonb), public.fatura_tutar_izi(numeric[]) from public, anon, authenticated;
revoke all on function public.belge_kaydet(jsonb) from public, anon;
grant execute on function public.belge_kaydet(jsonb) to authenticated;

commit;
