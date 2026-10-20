-- Okuma testi yolunu aç/kapat (silmeden). 07_okuma_testi.sql'den SONRA çalıştırılır.
-- Kapalıyken: okuma_testleri'ne satır eklense de işlev çağrılmaz (tetikleyici kapalı) ve işlev test isteklerini reddeder.
-- Açmak/kapatmak (yalnız CLI / SQL Editor, uygulama kullanıcıları çağıramaz):
--   select public.okuma_testi_ac(true);   -- aç
--   select public.okuma_testi_ac(false);  -- kapat
-- Normalde scripts/okuma-testi.sh bunu kendisi açıp kapatır.

create or replace function public.okuma_testi_ac(p_acik boolean) returns text
language plpgsql security definer set search_path = public as $$
begin
  insert into ic_ayarlar (ad, deger) values ('okuma_testi_acik', case when p_acik then 'evet' else 'hayir' end)
    on conflict (ad) do update set deger = excluded.deger;
  if p_acik then
    alter table okuma_testleri enable trigger okuma_testi_tetik;
  else
    alter table okuma_testleri disable trigger okuma_testi_tetik;
  end if;
  return case when p_acik then 'okuma testi AÇIK' else 'okuma testi KAPALI' end;
end $$;
revoke all on function public.okuma_testi_ac(boolean) from public, anon, authenticated;

select public.okuma_testi_ac(false);
