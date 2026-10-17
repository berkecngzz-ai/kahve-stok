-- Adım 1: Mekanlar, üyeler ve mekan izolasyonu
-- Supabase panelinde: SQL Editor → New query → bu dosyanın tamamını yapıştır → Run.

create extension if not exists pgcrypto with schema extensions;

-- ---------- Tablolar ----------

create table public.mekanlar (
  id          uuid primary key default gen_random_uuid(),
  ad          text not null check (length(trim(ad)) between 1 and 80),
  davet_kodu  text not null unique,
  demo        boolean not null default false,
  olusturma   timestamptz not null default now()
);

-- Bir hesap yalnızca bir mekana bağlı olabilir.
create table public.uyeler (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  mekan_id   uuid not null references public.mekanlar(id) on delete cascade,
  rol        text not null check (rol in ('patron', 'barista')),
  ad         text not null check (length(trim(ad)) between 1 and 60),
  eposta     text,
  olusturma  timestamptz not null default now()
);
create index uyeler_mekan_idx on public.uyeler(mekan_id);

-- ---------- Yardımcı fonksiyonlar ----------

-- Giriş yapan kişinin mekanı (yoksa null). Bütün izolasyon kuralları bunu kullanır.
create or replace function public.benim_mekanim() returns uuid
language sql stable security definer set search_path = public as $$
  select mekan_id from public.uyeler where user_id = auth.uid()
$$;

create or replace function public.patron_muyum() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.uyeler where user_id = auth.uid() and rol = 'patron')
$$;

create or replace function public.yeni_davet_kodu() returns text
language sql volatile set search_path = public as $$
  select upper(encode(extensions.gen_random_bytes(4), 'hex'))
$$;

-- ---------- İzolasyon (Row Level Security) ----------

alter table public.mekanlar enable row level security;
alter table public.uyeler   enable row level security;

create policy mekan_kendi on public.mekanlar
  for select to authenticated using (id = public.benim_mekanim());

create policy uyeler_kendi_mekan on public.uyeler
  for select to authenticated using (mekan_id = public.benim_mekanim());

-- Doğrudan ekleme/değiştirme/silme yok; yalnızca aşağıdaki fonksiyonlarla.
revoke insert, update, delete on public.mekanlar from anon, authenticated;
revoke insert, update, delete on public.uyeler   from anon, authenticated;
revoke all on public.mekanlar, public.uyeler from anon;

-- ---------- İşlemler ----------

create or replace function public.mekan_olustur(p_mekan_ad text, p_ad text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Önce giriş yapmalısın.'; end if;
  if coalesce(trim(p_mekan_ad), '') = '' then raise exception 'Mekan adı boş olamaz.'; end if;
  if coalesce(trim(p_ad), '') = '' then raise exception 'Adın boş olamaz.'; end if;
  if exists (select 1 from uyeler where user_id = auth.uid()) then
    raise exception 'Bu hesap zaten bir mekana bağlı.';
  end if;
  insert into mekanlar (ad, davet_kodu) values (trim(p_mekan_ad), yeni_davet_kodu())
    returning id into v_id;
  insert into uyeler (user_id, mekan_id, rol, ad, eposta)
    values (auth.uid(), v_id, 'patron', trim(p_ad), auth.jwt() ->> 'email');
  return v_id;
end $$;

create or replace function public.mekana_katil(p_kod text, p_ad text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Önce giriş yapmalısın.'; end if;
  if coalesce(trim(p_ad), '') = '' then raise exception 'Adın boş olamaz.'; end if;
  if exists (select 1 from uyeler where user_id = auth.uid()) then
    raise exception 'Bu hesap zaten bir mekana bağlı.';
  end if;
  select id into v_id from mekanlar where davet_kodu = upper(trim(p_kod));
  if v_id is null then raise exception 'Davet kodu geçersiz.'; end if;
  insert into uyeler (user_id, mekan_id, rol, ad, eposta)
    values (auth.uid(), v_id, 'barista', trim(p_ad), auth.jwt() ->> 'email');
  return v_id;
end $$;

create or replace function public.davet_kodu_yenile() returns text
language plpgsql security definer set search_path = public as $$
declare v_kod text;
begin
  if not patron_muyum() then raise exception 'Bu işlemi yalnızca patron yapabilir.'; end if;
  update mekanlar set davet_kodu = yeni_davet_kodu()
    where id = benim_mekanim() returning davet_kodu into v_kod;
  return v_kod;
end $$;

create or replace function public.uye_cikar(p_user_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not patron_muyum() then raise exception 'Bu işlemi yalnızca patron yapabilir.'; end if;
  if p_user_id = auth.uid() then raise exception 'Kendini mekandan çıkaramazsın.'; end if;
  delete from uyeler where user_id = p_user_id and mekan_id = benim_mekanim();
  if not found then raise exception 'Bu kişi senin mekanında değil.'; end if;
end $$;

-- Fonksiyonlar yalnızca giriş yapmış kullanıcılara açık.
revoke all on function public.benim_mekanim(), public.patron_muyum(), public.yeni_davet_kodu(),
  public.mekan_olustur(text, text), public.mekana_katil(text, text),
  public.davet_kodu_yenile(), public.uye_cikar(uuid) from public, anon;
grant execute on function public.benim_mekanim(), public.patron_muyum(),
  public.mekan_olustur(text, text), public.mekana_katil(text, text),
  public.davet_kodu_yenile(), public.uye_cikar(uuid) to authenticated;
