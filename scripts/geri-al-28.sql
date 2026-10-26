-- 28'i geri alır: belge_kaydet yeniden sql/23 hâli.
begin;
drop function public.belge_kaydet(jsonb);
alter function public.belge_kaydet_v23(jsonb) rename to belge_kaydet;
grant execute on function public.belge_kaydet(jsonb) to authenticated;
commit;
