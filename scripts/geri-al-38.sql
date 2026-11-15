-- 38'i geri alır: acik_trendi sql/26, sayim_talebi/sayim_iste sql/37 hâli. Ayar kolonları kalır (zararsız).
begin;
drop function if exists public.mekan_ayar_kaydet(int, numeric, numeric);
drop function if exists public.mekan_ayarlari();
drop function if exists public.sayim_talebi_gordum();
create or replace function public.sayim_talebi() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('zaman', t.olusturma, 'isteyen_ad', t.isteyen_ad)
  from sayim_talepleri t
  where t.mekan_id = benim_mekanim()
    and not exists (select 1 from girisler g where g.mekan_id = t.mekan_id and g.tur = 'sayim' and g.iptal_zamani is null
                      and g.olusturma > t.olusturma
                      and (select count(*) from malzeme_hareketleri h where h.giris_id = g.id) >= 2)
  order by t.olusturma desc limit 1
$$;
create or replace function public.sayim_iste() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_mekan uuid := benim_mekanim(); v jsonb;
begin
  if v_mekan is null or not patron_muyum() then raise exception 'Sayımı yalnız patron isteyebilir.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('sayim_iste' || v_mekan::text, 0));
  v := sayim_talebi();
  if v is not null then return v; end if;
  insert into sayim_talepleri (mekan_id, isteyen, isteyen_ad)
    values (v_mekan, auth.uid(), coalesce((select ad from uyeler where user_id = auth.uid()), 'Patron'));
  return sayim_talebi();
end $$;
commit;
-- acik_trendi'nin eski hâli için sql/26_dogru_hesap.sql'deki tanımı yeniden çalıştır (ek alanlar zararsızdır).
