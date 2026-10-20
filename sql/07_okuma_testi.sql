-- Okuma testi altyapısı: test fotoğraflarını uygulama kullanıcısı olmadan (kurulum/geliştirme) AI ile okutmak.
-- 06_ai_okuma.sql'den SONRA çalıştırılır. (CLI: npx supabase db query --linked -f sql/07_okuma_testi.sql)
--
-- Akış: okuma_testleri tablosuna bir satır eklenir (dosya: fatura-belgeleri kovasında _test/… yolu, model,
-- takip edilen malzeme listesi) → tetikleyici, pg_net ile fatura-oku işlevini SUNUCUDAN çağırır ve gizli bir imza
-- gönderir → işlev imzayı veritabanındakiyle karşılaştırır, dosyayı okur, sonucu bu satıra yazar.
-- İmza yalnızca veritabanında (ic_ayarlar) durur; hiçbir rol okuyamaz, hiçbir dosyada yoktur.
-- Test okumaları mekanların günlük sınırından düşmez; maliyetleri bu tabloda ayrı tutulur.

create extension if not exists pg_net with schema extensions;

create table if not exists public.ic_ayarlar (
  ad     text primary key,
  deger  text not null
);
alter table public.ic_ayarlar enable row level security;
revoke all on public.ic_ayarlar from anon, authenticated;
insert into public.ic_ayarlar (ad, deger)
  values ('okuma_testi_imza', encode(extensions.gen_random_bytes(32), 'hex'))
  on conflict (ad) do nothing;

create table if not exists public.okuma_testleri (
  id           uuid primary key default gen_random_uuid(),
  olusturma    timestamptz not null default now(),
  etiket       text,
  dosya_yolu   text not null,
  model        text not null,
  malzemeler   jsonb not null default '[]',
  durum        text not null default 'bekliyor' check (durum in ('bekliyor', 'tamam', 'hata')),
  sonuc        jsonb,
  giris_token  int,
  cikis_token  int,
  maliyet_usd  numeric(12,6),
  boyut_kb     int,
  ai_ms        int,
  toplam_ms    int,
  hata         text
);
alter table public.okuma_testleri enable row level security;
revoke all on public.okuma_testleri from anon, authenticated;

-- Satır eklenince işlevi sunucudan çağırır (proje adresi ve herkese açık uygulama anahtarı; gizli değildir).
create or replace function public.okuma_testi_tetikle() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform net.http_post(
    url := 'https://urklrolemeacguleadwa.supabase.co/functions/v1/fatura-oku',
    body := jsonb_build_object('okuma_testi', new.id),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'sb_publishable_ZilOyyb3P4WISQaITJAWZA_dcCvy21L',
      'Authorization', 'Bearer sb_publishable_ZilOyyb3P4WISQaITJAWZA_dcCvy21L',
      'x-okuma-testi', (select deger from ic_ayarlar where ad = 'okuma_testi_imza')),
    timeout_milliseconds := 90000);
  return new;
end $$;
revoke all on function public.okuma_testi_tetikle() from public, anon, authenticated;

drop trigger if exists okuma_testi_tetik on public.okuma_testleri;
create trigger okuma_testi_tetik after insert on public.okuma_testleri
  for each row execute function public.okuma_testi_tetikle();

-- İşlev (service_role) imzayı doğrulamak için okur; başka kimse okuyamaz.
grant select on public.ic_ayarlar to service_role;
grant select, update on public.okuma_testleri to service_role;
