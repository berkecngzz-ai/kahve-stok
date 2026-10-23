-- Yalnız dosya; canlıya uygulanmadı. Mevcut izinleri koruyarak XLSX yüklemeyi açar.
update storage.buckets set allowed_mime_types = array(
 select distinct mime from unnest(allowed_mime_types || array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']) as mime
) where id = 'fatura-belgeleri' and allowed_mime_types is not null;
