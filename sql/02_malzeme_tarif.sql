-- Adım 2: Malzemeler, ürünler ve ürün tarifleri
-- 01_giris_mekan.sql'den SONRA çalıştırılır.
-- Supabase panelinde: SQL Editor → New query → bu dosyanın tamamını yapıştır → Run.

-- ---------- Tablolar ----------

-- Birim: g, ml veya adet. Tarifler bu birimle yazılır (18 g kahve, 200 ml süt).
-- Fiyat: g için 1 kg'ın, ml için 1 litrenin, adet için 1 adedin TL fiyatı.
-- Malzeme silinmez, pasife alınır (geçmiş kayıtlar bozulmasın diye).
create table public.malzemeler (
  id         uuid primary key default gen_random_uuid(),
  mekan_id   uuid not null default public.benim_mekanim() references public.mekanlar(id) on delete cascade,
  ad         text not null check (length(trim(ad)) between 1 and 60),
  birim      text not null check (birim in ('g', 'ml', 'adet')),
  fiyat      numeric(12,2) not null default 0 check (fiyat >= 0 and fiyat < 10000000),
  aktif      boolean not null default true,
  olusturma  timestamptz not null default now(),
  unique (id, mekan_id)
);
create unique index malzemeler_ad_uniq on public.malzemeler(mekan_id, lower(trim(ad)));

-- Ürün silinmez, pasife alınır.
create table public.urunler (
  id         uuid primary key default gen_random_uuid(),
  mekan_id   uuid not null default public.benim_mekanim() references public.mekanlar(id) on delete cascade,
  ad         text not null check (length(trim(ad)) between 1 and 60),
  aktif      boolean not null default true,
  olusturma  timestamptz not null default now(),
  unique (id, mekan_id)
);
create unique index urunler_ad_uniq on public.urunler(mekan_id, lower(trim(ad)));

-- Bir ürünün içine hangi malzemeden ne kadar girdiği.
-- Ürün ve malzeme aynı mekana ait olmak ZORUNDA (iki sütunlu bağlantılar bunu garanti eder).
create table public.tarif_kalemleri (
  urun_id     uuid not null,
  malzeme_id  uuid not null,
  mekan_id    uuid not null default public.benim_mekanim(),
  miktar      numeric(12,3) not null check (miktar > 0 and miktar < 100000),
  primary key (urun_id, malzeme_id),
  foreign key (urun_id, mekan_id) references public.urunler(id, mekan_id) on delete cascade,
  foreign key (malzeme_id, mekan_id) references public.malzemeler(id, mekan_id)
);
create index tarif_kalemleri_mekan_idx on public.tarif_kalemleri(mekan_id);
create index tarif_kalemleri_malzeme_idx on public.tarif_kalemleri(malzeme_id, mekan_id);

-- ---------- İzolasyon (Row Level Security) ----------
-- Herkes yalnızca kendi mekanını görür. Ekleme/değiştirme yalnızca patron.

alter table public.malzemeler      enable row level security;
alter table public.urunler         enable row level security;
alter table public.tarif_kalemleri enable row level security;

create policy malzeme_gor on public.malzemeler for select to authenticated
  using (mekan_id = public.benim_mekanim());
create policy malzeme_ekle on public.malzemeler for insert to authenticated
  with check (mekan_id = public.benim_mekanim() and public.patron_muyum());
create policy malzeme_degistir on public.malzemeler for update to authenticated
  using (mekan_id = public.benim_mekanim() and public.patron_muyum())
  with check (mekan_id = public.benim_mekanim());

create policy urun_gor on public.urunler for select to authenticated
  using (mekan_id = public.benim_mekanim());
create policy urun_ekle on public.urunler for insert to authenticated
  with check (mekan_id = public.benim_mekanim() and public.patron_muyum());
create policy urun_degistir on public.urunler for update to authenticated
  using (mekan_id = public.benim_mekanim() and public.patron_muyum())
  with check (mekan_id = public.benim_mekanim());

create policy tarif_gor on public.tarif_kalemleri for select to authenticated
  using (mekan_id = public.benim_mekanim());
create policy tarif_ekle on public.tarif_kalemleri for insert to authenticated
  with check (mekan_id = public.benim_mekanim() and public.patron_muyum());
create policy tarif_sil on public.tarif_kalemleri for delete to authenticated
  using (mekan_id = public.benim_mekanim() and public.patron_muyum());

-- Yetkiler: giriş yapmamış kişi hiçbir şey göremez. Silme yok (pasife alma var).
-- Birim sonradan değiştirilemez (18 g'lık tarif bir anda 18 ml olmasın diye).
revoke all on public.malzemeler, public.urunler, public.tarif_kalemleri from anon, authenticated;
grant select, insert on public.malzemeler, public.urunler to authenticated;
grant update (ad, fiyat, aktif) on public.malzemeler to authenticated;
grant update (ad, aktif) on public.urunler to authenticated;
grant select, insert, delete on public.tarif_kalemleri to authenticated;

-- Adım 1 tablolarında da toplu silme (truncate) yetkisini kapat.
revoke truncate on public.mekanlar, public.uyeler from anon, authenticated;

-- ---------- İşlemler ----------

-- Ürünü tarifiyle birlikte tek seferde kaydeder (yeni ürün: p_id = null).
-- p_kalemler örneği: [{"malzeme_id": "...", "miktar": 18}, ...]
-- Giriş yapan kişinin yetkileriyle çalışır; yukarıdaki mekan kuralları burada da geçerli.
create or replace function public.urun_kaydet(p_id uuid, p_ad text, p_kalemler jsonb) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid;
  v_adet int;
begin
  if not patron_muyum() then raise exception 'Bu işlemi yalnızca patron yapabilir.'; end if;
  if coalesce(trim(p_ad), '') = '' then raise exception 'Ürün adı boş olamaz.'; end if;
  if length(trim(p_ad)) > 60 then raise exception 'Ürün adı en fazla 60 karakter olabilir.'; end if;
  if jsonb_typeof(p_kalemler) is distinct from 'array' or jsonb_array_length(p_kalemler) = 0 then
    raise exception 'Tarife en az bir malzeme ekle.';
  end if;
  if jsonb_array_length(p_kalemler) > 50 then raise exception 'Bir tarifte en fazla 50 malzeme olabilir.'; end if;

  -- Her kalem: bu mekana ait bir malzeme ve 0'dan büyük bir miktar olmalı.
  if exists (
    select 1 from jsonb_array_elements(p_kalemler) k
    where coalesce(case when jsonb_typeof(k -> 'miktar') = 'number'
                        then (k ->> 'miktar')::numeric end, 0) not between 0.001 and 99999.999
  ) then
    raise exception 'Tarifteki miktarlar 0''dan büyük bir sayı olmalı.';
  end if;
  select count(distinct m.id) into v_adet
    from jsonb_array_elements(p_kalemler) k
    join malzemeler m on m.id::text = k ->> 'malzeme_id' and m.mekan_id = benim_mekanim();
  if v_adet <> jsonb_array_length(p_kalemler) then
    raise exception 'Tarifte geçersiz ya da iki kez yazılmış bir malzeme var.';
  end if;

  begin
    if p_id is null then
      insert into urunler (ad) values (trim(p_ad)) returning id into v_id;
    else
      update urunler set ad = trim(p_ad)
        where id = p_id and mekan_id = benim_mekanim() returning id into v_id;
      if v_id is null then raise exception 'Ürün bulunamadı.'; end if;
    end if;
  exception when unique_violation then
    raise exception 'Bu adla bir ürün zaten var.';
  end;

  delete from tarif_kalemleri where urun_id = v_id;
  insert into tarif_kalemleri (urun_id, malzeme_id, miktar)
    select v_id, (k ->> 'malzeme_id')::uuid, round((k ->> 'miktar')::numeric, 3)
    from jsonb_array_elements(p_kalemler) k;
  return v_id;
end $$;

revoke all on function public.urun_kaydet(uuid, text, jsonb) from public, anon;
grant execute on function public.urun_kaydet(uuid, text, jsonb) to authenticated;
