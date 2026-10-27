-- 29'u geri alır: sayım tarihi düzeltme kalkar (geçmişteki 'sayim_tarihi' kayıtları silinmez, kısıt onları kapsar).
begin;
drop function if exists public.sayim_tarihi(uuid, date);
commit;
