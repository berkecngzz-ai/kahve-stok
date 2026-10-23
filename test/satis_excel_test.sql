reset role;
select pg_temp.dogrula((select 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'=any(allowed_mime_types) and 'image/jpeg'=any(allowed_mime_types) and 'text/csv'=any(allowed_mime_types) from storage.buckets where id='fatura-belgeleri'),'Excel veya mevcut dosya izinleri eksik');
