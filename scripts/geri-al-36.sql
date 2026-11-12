-- 36'yı geri alır: belge_kaydet sql/35, giris_iptal sql/26, kaydi_geri_al sql/05 hâli. Kaydedilmiş irsaliyeler stokta kalır;
-- mahsup kayıtları silinir (sonradan gelen fatura stoğu yeniden ekler — geri almadan önce açık irsaliye olmadığını kontrol et).
begin;
drop function public.belge_kaydet(jsonb);
alter function public.belge_kaydet_v35(jsonb) rename to belge_kaydet;
drop function public.giris_iptal(uuid);
alter function public.giris_iptal_v26(uuid) rename to giris_iptal;
drop function public.kaydi_geri_al(text, uuid);
alter function public.kaydi_geri_al_v05(text, uuid) rename to kaydi_geri_al;
drop function public.irsaliye_mahsup_et(uuid);
drop function public.irsaliye_acik_miktar(bigint);
drop table public.irsaliye_mahsuplari;
revoke all on function public.belge_kaydet(jsonb), public.giris_iptal(uuid), public.kaydi_geri_al(text, uuid) from public, anon;
grant execute on function public.belge_kaydet(jsonb), public.giris_iptal(uuid), public.kaydi_geri_al(text, uuid) to authenticated;
commit;
