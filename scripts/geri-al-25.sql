-- 25'i geri alır: satış yine elle de girilebilir, patron raporu işleyemez (kurulum işler).
-- Tablo satis_eslesmeleri ve depo izinleri kalır (zararsız).
begin;
CREATE OR REPLACE FUNCTION public.giris_kaydet(p_tur text, p_tarih date, p_aciklama text, p_kalemler jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_tur = 'fatura' then
    raise exception 'Fatura ekranı güncellendi. Sayfayı yenileyip tekrar dene.';
  end if;
  return giris_kaydet_v1(p_tur, p_tarih, p_aciklama, p_kalemler);
end $function$
;
CREATE OR REPLACE FUNCTION public.kurulum_satis_raporu_isle(p_belge uuid, p_tarih date, p_kalemler jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  b belgeler;
  v_id uuid;
  v_onceki girisler;
  k jsonb;
  v_urun uuid;
  v_miktar numeric;
begin
  if not kurulumcu_muyum() then raise exception 'Bu işlem yalnızca kurulum hesabına açık.'; end if;
  select * into b from belgeler where id = p_belge for update;
  if not found or b.tur <> 'satis_raporu' then raise exception 'Satış raporu bulunamadı.'; end if;
  if b.iptal_zamani is not null then raise exception 'Bu rapor iptal edilmiş.'; end if;
  if b.durum <> 'bekliyor' then raise exception 'Bu rapor zaten işlenmiş.'; end if;
  if p_tarih is null then raise exception 'Raporun tarihini seç.'; end if;
  if p_tarih > bugun() then raise exception 'Tarih bugünden ileri olamaz.'; end if;
  if p_tarih < bugun() - 366 then raise exception 'Tarih en fazla bir yıl geriye gidebilir.'; end if;
  if jsonb_typeof(p_kalemler) is distinct from 'array' or jsonb_array_length(p_kalemler) = 0 then
    raise exception 'En az bir ürünün adedini yaz.';
  end if;
  if jsonb_array_length(p_kalemler) > 300 then raise exception 'Bir raporda en fazla 300 satır olabilir.'; end if;

  select * into v_onceki from girisler
    where mekan_id = b.mekan_id and tur = 'satis' and tarih = p_tarih and iptal_zamani is null limit 1;
  if found then
    raise exception 'Bu mekana % için satış zaten girilmiş (%). Çift sayılmasın diye kaydedilmedi; önce o kaydı patron iptal etmeli.',
      to_char(p_tarih, 'DD.MM.YYYY'), v_onceki.giren_ad;
  end if;

  insert into girisler (mekan_id, tur, tarih, aciklama, giren, giren_ad)
    values (b.mekan_id, 'satis', p_tarih, 'Satış raporu', auth.uid(),
            coalesce((select ad from uyeler where user_id = auth.uid()), 'Kurulum'))
    returning id into v_id;

  for k in select value from jsonb_array_elements(p_kalemler) loop
    if jsonb_typeof(k) is distinct from 'object' then raise exception 'Geçersiz satır.'; end if;
    select id into v_urun from urunler where id::text = k ->> 'urun_id' and mekan_id = b.mekan_id;
    if v_urun is null then raise exception 'Satırlarda bu mekana ait olmayan bir ürün var.'; end if;
    v_miktar := case when jsonb_typeof(k -> 'miktar') = 'number' then (k ->> 'miktar')::numeric end;
    if v_miktar is null or v_miktar <> trunc(v_miktar) or v_miktar not between 1 and 100000 then
      raise exception 'Ürün adetleri 1 ile 100.000 arasında tam sayı olmalı.';
    end if;
    insert into giris_kalemleri (giris_id, mekan_id, urun_id, miktar) values (v_id, b.mekan_id, v_urun, v_miktar);
  end loop;
  if exists (select 1 from giris_kalemleri where giris_id = v_id group by urun_id having count(*) > 1) then
    raise exception 'Aynı ürün iki satırda var. Tek satırda topla.';
  end if;

  insert into malzeme_hareketleri (giris_id, mekan_id, malzeme_id, miktar)
    select v_id, b.mekan_id, t.malzeme_id, sum(t.miktar * gk.miktar)
    from giris_kalemleri gk join tarif_kalemleri t on t.urun_id = gk.urun_id
    where gk.giris_id = v_id
    group by t.malzeme_id;

  update belgeler set durum = 'tamam', giris_id = v_id where id = p_belge;
  return v_id;
end $function$
;
drop function if exists public.satis_raporu_isle(uuid, date, jsonb, jsonb);
commit;
