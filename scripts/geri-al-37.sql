-- 37'yi geri alır (sayım istekleri silinir; stok verisine dokunmaz).
begin;
drop function if exists public.sayim_iste();
drop function if exists public.sayim_talebi();
drop table if exists public.sayim_talepleri;
commit;
