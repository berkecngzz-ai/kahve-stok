-- 37: Patron "Sayım iste" der → baristanın ana ekranında sayım görevi çıkar. İstekten SONRA yapılan ilk geniş sayım
-- (2+ malzeme) isteği kendiliğinden kapatır; ayrıca kapatma yok. Geri alma: scripts/geri-al-37.sql
create table if not exists public.sayim_talepleri (
  id          bigint generated always as identity primary key,
  mekan_id    uuid not null references public.mekanlar(id) on delete cascade,
  isteyen     uuid not null,
  isteyen_ad  text not null,
  olusturma   timestamptz not null default now()
);
create index if not exists sayim_talepleri_mekan_idx on public.sayim_talepleri(mekan_id, olusturma desc);
alter table public.sayim_talepleri enable row level security;
drop policy if exists sayim_talebi_gor on public.sayim_talepleri;
create policy sayim_talebi_gor on public.sayim_talepleri for select to authenticated
  using (mekan_id = public.benim_mekanim());
revoke all on public.sayim_talepleri from anon, authenticated;
grant select on public.sayim_talepleri to authenticated;

-- Açık istek: son istek, son geniş sayımdan (kayıt zamanı) sonra yapılmışsa. Yoksa null.
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

-- Patron sayım ister. Açık istek varsa yenisi açılmaz (çift dokunma), açık olan döner.
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

revoke all on function public.sayim_talebi(), public.sayim_iste() from public, anon;
grant execute on function public.sayim_talebi(), public.sayim_iste() to authenticated;
