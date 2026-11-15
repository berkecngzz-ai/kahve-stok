-- 40'ı geri alır: satış satırı anahtarından tarih çıkar (sql/26 hâli). Aynı fiş no + ürün iki farklı günde varsa eski
-- biçimde çakışır: bu durumda işlem durur (o satırlar ayrı günlerin gerçek satışlarıdır; geri almak onları siler gibi davranır).
begin;
create or replace function public.satis_raporu_isle_v26(p_belge uuid, p_satirlar jsonb, p_eslesmeler jsonb default '[]')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b belgeler;
  k jsonb;
  v_kurulum boolean := kurulumcu_muyum();
  v_ad_k text; v_urun uuid; v_tarih date; v_zaman timestamp; v_fis text; v_tur text; v_adet int; v_tutar numeric;
  v_anahtar text; v_grup text; v_ad text;
  v_eklenen int := 0; v_mukerrer int := 0;
  v_gunler date[] := '{}';
  v_gun date;
  v_giren_ad text := coalesce((select ad from uyeler where user_id = auth.uid()), 'Kurulum');
begin
  select * into b from belgeler where id = p_belge for update;
  if not found or b.tur <> 'satis_raporu' or (not v_kurulum and b.mekan_id is distinct from benim_mekanim()) then
    raise exception 'Satış raporu bulunamadı.';
  end if;
  if not v_kurulum and not patron_muyum() then raise exception 'Satış raporunu yalnız patron işleyebilir.'; end if;
  if b.iptal_zamani is not null then raise exception 'Bu rapor iptal edilmiş.'; end if;
  if b.durum <> 'bekliyor' then raise exception 'Bu rapor zaten işlenmiş.'; end if;
  if jsonb_typeof(p_satirlar) is distinct from 'array' or jsonb_array_length(p_satirlar) = 0 then
    raise exception 'Raporda satış satırı yok.';
  end if;
  if jsonb_array_length(p_satirlar) > 20000 then raise exception 'Bir raporda en fazla 20.000 satır olabilir.'; end if;
  if p_eslesmeler is not null and jsonb_typeof(p_eslesmeler) is distinct from 'array' then raise exception 'Geçersiz eşleşme.'; end if;

  for k in select value from jsonb_array_elements(p_satirlar) loop
    if jsonb_typeof(k) is distinct from 'object' then raise exception 'Geçersiz satır.'; end if;
    begin v_tarih := (k ->> 'tarih')::date; exception when others then v_tarih := null; end;
    if v_tarih is null or v_tarih > bugun() or v_tarih < bugun() - 366 then
      raise exception 'Satırlardan birinin tarihi geçersiz (bugünden ileri ya da bir yıldan eski olamaz).';
    end if;
    begin v_zaman := nullif(k ->> 'zaman', '')::timestamp; exception when others then v_zaman := null; end;
    if v_zaman is not null and v_zaman::date <> v_tarih then raise exception 'Satırlardan birinin saati ile tarihi uyuşmuyor.'; end if;
    v_fis := nullif(left(trim(coalesce(k ->> 'fis_no', '')), 60), '');
    v_ad := left(trim(coalesce(k ->> 'ad', '')), 200);
    v_ad_k := left(lower(trim(coalesce(k ->> 'ad_anahtar', ''))), 200);
    if v_ad = '' or v_ad_k = '' then raise exception 'Satırlardan birinin ürün adı boş.'; end if;
    v_tur := coalesce(k ->> 'tur', 'satis');
    if v_tur not in ('satis', 'iptal', 'iade') then raise exception 'Geçersiz satır türü.'; end if;
    v_adet := case when jsonb_typeof(k -> 'adet') = 'number' and (k ->> 'adet')::numeric = trunc((k ->> 'adet')::numeric)
                   and (k ->> 'adet')::numeric between 1 and 100000 then (k ->> 'adet')::int end;
    if v_adet is null then raise exception 'Adetler 1 ile 100.000 arasında tam sayı olmalı (%).', v_ad; end if;
    v_tutar := case when jsonb_typeof(k -> 'tutar') = 'number' then round((k ->> 'tutar')::numeric, 2) end;
    v_urun := null;
    if k ->> 'urun_id' is not null then
      select id into v_urun from urunler where id::text = k ->> 'urun_id' and mekan_id = b.mekan_id;
      if v_urun is null then raise exception 'Satırlarda bu mekana ait olmayan bir ürün var.'; end if;
    end if;
    v_grup := case when v_fis is not null then 'F|' || v_fis
                   when v_zaman is not null then 'Z|' || to_char(v_zaman, 'YYYY-MM-DD HH24:MI:SS')
                   else 'T|' || v_tarih end || '|' || v_ad_k;
    v_anahtar := case when v_fis is not null then v_grup || '|' || v_tur
                      else v_grup || '|' || v_adet || '|' || coalesce(v_tutar::text, '') || '|' || v_tur end;
    insert into satis_satirlari (mekan_id, belge_id, anahtar, grup, fis_no, zaman, tarih, ad, ad_anahtar, urun_id, adet, tutar, tur)
      values (b.mekan_id, b.id, v_anahtar, v_grup, v_fis, v_zaman, v_tarih, v_ad, v_ad_k, v_urun, v_adet, v_tutar, v_tur)
      on conflict (mekan_id, anahtar) do nothing;
    if found then
      v_eklenen := v_eklenen + 1;
      if not v_tarih = any(v_gunler) then v_gunler := v_gunler || v_tarih; end if;
    else
      v_mukerrer := v_mukerrer + 1;
    end if;
  end loop;

  foreach v_gun in array v_gunler loop
    perform satis_gunu_yenile(b.mekan_id, v_gun, auth.uid(), v_giren_ad);
  end loop;

  for k in select value from jsonb_array_elements(coalesce(p_eslesmeler, '[]')) loop
    if jsonb_typeof(k) is distinct from 'object' then raise exception 'Geçersiz eşleşme.'; end if;
    v_ad_k := left(lower(trim(coalesce(k ->> 'ad', ''))), 200);
    if v_ad_k = '' then raise exception 'Geçersiz eşleşme.'; end if;
    v_urun := null;
    if k ->> 'urun_id' is not null then
      select id into v_urun from urunler where id::text = k ->> 'urun_id' and mekan_id = b.mekan_id;
      if v_urun is null then raise exception 'Eşleşmede bu mekana ait olmayan bir ürün var.'; end if;
    end if;
    insert into satis_eslesmeleri (mekan_id, ad_anahtar, urun_id) values (b.mekan_id, v_ad_k, v_urun)
      on conflict (mekan_id, ad_anahtar) do update set urun_id = excluded.urun_id, guncelleme = now();
  end loop;

  update belgeler set durum = 'tamam' where id = p_belge;
  return jsonb_build_object('eklenen', v_eklenen, 'mukerrer', v_mukerrer,
    'gunler', (select coalesce(jsonb_agg(d order by d), '[]') from unnest(v_gunler) d),
    'tarifsiz', coalesce((select jsonb_agg(distinct u.ad) from satis_satirlari s join urunler u on u.id = s.urun_id
                          where s.belge_id = p_belge and s.tur = 'satis'
                            and not exists (select 1 from tarif_surumleri t where t.urun_id = s.urun_id)), '[]'));
end $$;
update public.satis_satirlari
   set grup = 'F|' || fis_no || '|' || ad_anahtar,
       anahtar = 'F|' || fis_no || '|' || ad_anahtar || '|' || tur
 where fis_no is not null and anahtar = 'F|' || to_char(tarih, 'YYYY-MM-DD') || '|' || fis_no || '|' || ad_anahtar || '|' || tur;
revoke all on function public.satis_raporu_isle_v26(uuid, jsonb, jsonb) from public, anon, authenticated;
commit;
