-- 28: AI'nın satır birim fiyatı tutarsızsa (ör. "4 koli × 12 L" satırını "48 lt" okuyup birim fiyatı koli başına bırakması)
-- satır yalnız bu yüzden kontrole düşmez — ŞU ÜÇÜ birlikte doğruysa stoğa girer (2026-10-27):
--   (1) fatura toplamı tutuyor (satır tutarları genel toplamı veriyor), (2) barista sayıp faturadaki miktarı doğruladı
--   (teslimat tam ya da okuma hatası düzeltildi), (3) satır tutarından çıkan birim maliyet olağan (satir_olagandisi).
-- Biri tutmazsa satır eskisi gibi kontrolde bekler. belge_kaydet (sql/23) aynen çalışır; sonrasında bu kontrol yapılır.
-- Geri alma: scripts/geri-al-28.sql
alter function public.belge_kaydet(jsonb) rename to belge_kaydet_v23;

create or replace function public.belge_kaydet(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  b belgeler;
  s belge_satirlari;
  v_sebep text;
begin
  r := belge_kaydet_v23(p);
  select * into b from belgeler where id = (r ->> 'id')::uuid;
  if b.tur <> 'fatura' or not coalesce(b.toplam_tutuyor, false) or coalesce((r ->> 'tekrar')::boolean, false) then return r; end if;
  for s in select * from belge_satirlari
           where belge_id = b.id and durum = 'bekliyor' and bekleme_sebebi = 'tutar' and sayim = 'sayildi'
             and teslimat in ('tam', 'okuma_hatasi') and malzeme_id is not null and carpan > 0 and stok_miktari > 0
           order by sira loop
    v_sebep := satir_olagandisi(b.mekan_id, s.malzeme_id, round(s.miktar * s.carpan, 3),
                                satir_dahil_tutar(s.tutar_dahil, s.tutar_haric, s.kdv_orani),
                                case when satir_dahil_tutar(s.tutar_dahil, s.tutar_haric, s.kdv_orani) is not null then 0 end);
    if v_sebep is null then
      update belge_satirlari set durum = 'stokta', bekleme_sebebi = null where id = s.id;
      perform belge_satiri_stokla(s.id);
    end if;
  end loop;
  perform belge_durumu_yenile(b.id);
  return r || jsonb_build_object(
    'durum', (select durum from belgeler where id = b.id),
    'stoklanan', (select count(*) from belge_satirlari where belge_id = b.id and durum = 'stokta'),
    'bekleyen', (select count(*) from belge_satirlari where belge_id = b.id and durum = 'bekliyor'));
end $$;

revoke all on function public.belge_kaydet_v23(jsonb) from public, anon, authenticated;
revoke all on function public.belge_kaydet(jsonb) from public, anon;
grant execute on function public.belge_kaydet(jsonb) to authenticated;
