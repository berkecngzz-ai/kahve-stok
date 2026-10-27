-- 33'ü geri alır: belge_kaydet yeniden sql/31 hâli (içerik izi kontrolü kalkar).
begin;
drop function public.belge_kaydet(jsonb);
alter function public.belge_kaydet_v31(jsonb) rename to belge_kaydet;
grant execute on function public.belge_kaydet(jsonb) to authenticated;
drop function if exists public.fatura_tutar_izi(numeric[]);
commit;
