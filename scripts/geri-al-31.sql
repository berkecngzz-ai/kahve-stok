-- 31'i geri alır: belge_kaydet yeniden sql/28 hâli (düzeltilmiş satırlar stokta kalır).
begin;
drop function public.belge_kaydet(jsonb);
alter function public.belge_kaydet_v28(jsonb) rename to belge_kaydet;
grant execute on function public.belge_kaydet(jsonb) to authenticated;
drop function if exists public.fatura_okuma_duzelt(uuid);
commit;
