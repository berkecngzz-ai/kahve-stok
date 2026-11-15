-- 38: Mekan ayarları (sayım sıklığı, fark eşiği), dönem verisi (kullanılan mal değeri, dönem uzunluğu) ve sayım
-- isteğinin durumu (bekliyor → barista gördü → tamamlandı). Geri alma: scripts/geri-al-38.sql
--
--  · Sayım gecikti = son sayımdan bu yana geçen gün > sayım sıklığı + 2 (hesap ön yüzde, patron-hesap.js).
--  · Fark eşiği: dönemdeki fark ÷ dönemde kullanılan malın TL değeri (yüzde). Az geçmişte (< 4 aynı uzunlukta dönem)
--    durum bu oranla; yeterli geçmişte son 8 dönemin medyanıyla belirlenir (patron-hesap.js: farkDurumu).
--  · Haftalık fark sınırı (TL, varsayılan 500): fark bu sınırı (dönem uzunluğuna göre) aşarsa oran ne olursa olsun sorun.

alter table public.mekanlar add column if not exists sayim_sikligi int not null default 7;
alter table public.mekanlar add column if not exists fark_esigi numeric(4,1) not null default 5;
alter table public.mekanlar add column if not exists fark_siniri_tl numeric(10,2) not null default 500;
alter table public.mekanlar drop constraint if exists mekanlar_sayim_sikligi_check;
alter table public.mekanlar add constraint mekanlar_sayim_sikligi_check check (sayim_sikligi in (7, 14, 30));
alter table public.mekanlar drop constraint if exists mekanlar_fark_esigi_check;
alter table public.mekanlar add constraint mekanlar_fark_esigi_check check (fark_esigi between 1 and 50);
alter table public.mekanlar drop constraint if exists mekanlar_fark_siniri_check;
alter table public.mekanlar add constraint mekanlar_fark_siniri_check check (fark_siniri_tl between 10 and 1000000);

create or replace function public.mekan_ayarlari() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('sayim_sikligi', sayim_sikligi, 'fark_esigi', fark_esigi, 'fark_siniri_tl', fark_siniri_tl)
  from mekanlar where id = benim_mekanim()
$$;

create or replace function public.mekan_ayar_kaydet(p_sayim_sikligi int, p_fark_esigi numeric, p_fark_siniri_tl numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if benim_mekanim() is null or not patron_muyum() then raise exception 'Ayarları yalnız patron değiştirebilir.'; end if;
  if p_sayim_sikligi is null or p_sayim_sikligi not in (7, 14, 30) then raise exception 'Sayım sıklığı haftalık, 2 haftalık ya da aylık olabilir.'; end if;
  if p_fark_esigi is null or p_fark_esigi < 1 or p_fark_esigi > 50 then raise exception 'Fark eşiği %%1 ile %%50 arasında olmalı.'; end if;
  if p_fark_siniri_tl is null or p_fark_siniri_tl < 10 or p_fark_siniri_tl > 1000000 then raise exception 'Haftalık fark sınırı 10 TL ile 1.000.000 TL arasında olmalı.'; end if;
  update mekanlar set sayim_sikligi = p_sayim_sikligi, fark_esigi = round(p_fark_esigi, 1), fark_siniri_tl = round(p_fark_siniri_tl, 2)
    where id = benim_mekanim();
  return mekan_ayarlari();
end $$;

-- Dönem trendi: sql/26'daki işlev + dönem uzunluğu (gün) ve dönemde kullanılan malın TL değeri (satış + fire, fiyatı olanlar).
create or replace function public.acik_trendi(p_adet int default 8) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_mekan uuid := benim_mekanim();
  s record;
  r jsonb;
  v_sonuc jsonb := '[]';
  v_genis_var boolean;
begin
  if v_mekan is null or not patron_muyum() then raise exception 'Açık trendini yalnızca patron görebilir.'; end if;
  v_genis_var := exists (select 1 from girisler g where g.mekan_id = v_mekan and g.tur = 'sayim' and g.iptal_zamani is null
                          and (select count(*) from malzeme_hareketleri h where h.giris_id = g.id) >= 2);
  for s in
    select id from (
      select distinct on (g.tarih) g.id, g.tarih from girisler g
      where g.mekan_id = v_mekan and g.tur = 'sayim' and g.iptal_zamani is null
        and (not v_genis_var or (select count(*) from malzeme_hareketleri h where h.giris_id = g.id) >= 2)
      order by g.tarih desc, g.olusturma desc) x
    order by tarih desc limit least(greatest(coalesce(p_adet, 8), 1), 26)
  loop
    r := stok_farki(s.id);
    continue when r ->> 'baslangic' is null;
    v_sonuc := v_sonuc || jsonb_build_object(
      'sayim_id', s.id, 'baslangic', r -> 'baslangic', 'bitis', r -> 'bitis',
      'gun', (r ->> 'bitis')::date - (r ->> 'baslangic')::date,
      'acik_tl', r -> 'toplam_acik_tl', 'fazla_tl', r -> 'toplam_fazla_tl',
      'kullanilan_tl', coalesce((
        select round(sum((coalesce((x ->> 'satis')::numeric, 0) + coalesce((x ->> 'fire')::numeric, 0))
                         * (x ->> 'fiyat')::numeric / (case x ->> 'birim' when 'adet' then 1 else 1000 end)), 2)
        from jsonb_array_elements(r -> 'satirlar') x
        where x ->> 'durum' = 'tamam' and (x ->> 'fiyat')::numeric > 0), 0),
      'uyarilar', r -> 'uyarilar',
      'en_cok_acik', coalesce((
        select jsonb_agg(x order by (x ->> 'fark_tl')::numeric) from (
          select x from jsonb_array_elements(r -> 'satirlar') x
          where x ->> 'durum' = 'tamam' and (x ->> 'fark_tl')::numeric < 0
          order by (x ->> 'fark_tl')::numeric limit 3) t), '[]'::jsonb));
  end loop;
  return v_sonuc;
end $$;

-- Sayım isteğinin durumu: barista gördüğünde işaretlenir.
alter table public.sayim_talepleri add column if not exists goruldu timestamptz;

-- Son istek ve durumu: 'bekliyor' | 'goruldu' | 'tamamlandi' (istekten sonra ilk geniş sayım; 3 gün gösterilir).
create or replace function public.sayim_talebi() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('zaman', t.olusturma, 'isteyen_ad', t.isteyen_ad, 'goruldu', t.goruldu,
           'durum', case when k.olusturma is not null then 'tamamlandi' when t.goruldu is not null then 'goruldu' else 'bekliyor' end,
           'tamamlandi', k.olusturma)
  from sayim_talepleri t
  left join lateral (
    select g.olusturma from girisler g
    where g.mekan_id = t.mekan_id and g.tur = 'sayim' and g.iptal_zamani is null and g.olusturma > t.olusturma
      and (select count(*) from malzeme_hareketleri h where h.giris_id = g.id) >= 2
    order by g.olusturma limit 1) k on true
  where t.mekan_id = benim_mekanim()
    and (k.olusturma is null or k.olusturma > now() - interval '3 days')
  order by t.olusturma desc limit 1
$$;

-- Açık (tamamlanmamış) istek varsa yenisi açılmaz.
create or replace function public.sayim_iste() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_mekan uuid := benim_mekanim(); v jsonb;
begin
  if v_mekan is null or not patron_muyum() then raise exception 'Sayımı yalnız patron isteyebilir.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('sayim_iste' || v_mekan::text, 0));
  v := sayim_talebi();
  if v is not null and v ->> 'durum' <> 'tamamlandi' then return v; end if;
  insert into sayim_talepleri (mekan_id, isteyen, isteyen_ad)
    values (v_mekan, auth.uid(), coalesce((select ad from uyeler where user_id = auth.uid()), 'Patron'));
  return sayim_talebi();
end $$;

-- Barista görev ekranında isteği gördü.
create or replace function public.sayim_talebi_gordum() returns void
language sql security definer set search_path = public as $$
  update sayim_talepleri t set goruldu = now()
  where t.mekan_id = benim_mekanim() and t.goruldu is null
    and exists (select 1 from uyeler u where u.user_id = auth.uid() and u.rol = 'barista')
$$;

revoke all on function public.mekan_ayarlari(), public.mekan_ayar_kaydet(int, numeric, numeric), public.acik_trendi(int),
  public.sayim_talebi(), public.sayim_iste(), public.sayim_talebi_gordum() from public, anon;
grant execute on function public.mekan_ayarlari(), public.mekan_ayar_kaydet(int, numeric, numeric), public.acik_trendi(int),
  public.sayim_talebi(), public.sayim_iste(), public.sayim_talebi_gordum() to authenticated;
