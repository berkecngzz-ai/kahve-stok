-- 14 günlük senaryo; beklenen sonuçlar rapordan türetilmez.
-- Kahve: 10000+10000-3780-140=16080; sayılan15980 => -100g=-65TL.
-- Süt:100000+80000-28000-1400=150600; sayılan146600 => -4000ml=-168TL.
-- Bardak:300+200-210=290; sayılan295 => +5adet=+10TL.
reset role;
insert into auth.users values ('eeeeeeee-0000-0000-0000-000000000001','scenario@example.invalid');
set role authenticated;
select pg_temp.ol('eeeeeeee-0000-0000-0000-000000000001','scenario@example.invalid');
select public.mekan_olustur('İki Haftalık Test Kafe','Test Patron');
do $$
declare c uuid; m uuid; b uuid; l uuid; e uuid; d int; r jsonb; x jsonb;
begin
 insert into malzemeler(ad,birim,fiyat) values('Senaryo Kahve','g',650) returning id into c;
 insert into malzemeler(ad,birim,fiyat) values('Senaryo Süt','ml',42) returning id into m;
 insert into malzemeler(ad,birim,fiyat) values('Senaryo Bardak','adet',2) returning id into b;
 l:=urun_kaydet(null,'Senaryo Latte',jsonb_build_array(jsonb_build_object('malzeme_id',c,'miktar',18),jsonb_build_object('malzeme_id',m,'miktar',200),jsonb_build_object('malzeme_id',b,'miktar',1)));
 e:=urun_kaydet(null,'Senaryo Espresso',jsonb_build_array(jsonb_build_object('malzeme_id',c,'miktar',18),jsonb_build_object('malzeme_id',b,'miktar',1)));
 perform giris_kaydet('sayim',bugun()-14,null,jsonb_build_array(jsonb_build_object('malzeme_id',c,'miktar',10000),jsonb_build_object('malzeme_id',m,'miktar',100000),jsonb_build_object('malzeme_id',b,'miktar',300)));
 for d in 0..13 loop
  if d in (3,10) then
   perform fatura_kaydet(bugun()-d,'Yerel Tedarikçi',jsonb_build_array(jsonb_build_object('malzeme_id',c,'miktar',5000,'tutar_kdv_haric',3250,'kdv_orani',0),jsonb_build_object('malzeme_id',m,'miktar',40000,'tutar_kdv_haric',1680,'kdv_orani',0),jsonb_build_object('malzeme_id',b,'miktar',100,'tutar_kdv_haric',200,'kdv_orani',0)),'{"genel":5130}','[]');
  end if;
  perform giris_kaydet('satis',bugun()-d,null,jsonb_build_array(jsonb_build_object('urun_id',l,'miktar',10),jsonb_build_object('urun_id',e,'miktar',5)));
  perform giris_kaydet('fire',bugun()-d,'Günlük dökülme',jsonb_build_array(jsonb_build_object('malzeme_id',c,'miktar',10),jsonb_build_object('malzeme_id',m,'miktar',100)));
 end loop;
 perform giris_kaydet('sayim',bugun(),null,jsonb_build_array(jsonb_build_object('malzeme_id',c,'miktar',15980),jsonb_build_object('malzeme_id',m,'miktar',146600),jsonb_build_object('malzeme_id',b,'miktar',295)));
 r:=stok_farki();
 select value into x from jsonb_array_elements(r->'satirlar') where value->>'malzeme_id'=c::text;
 assert (x->>'gelen')::numeric=10000 and (x->>'satis')::numeric=3780 and (x->>'fire')::numeric=140 and (x->>'beklenen')::numeric=16080 and (x->>'fark')::numeric=-100 and (x->>'fark_tl')::numeric=-65,'Kahve hesabı yanlış';
 select value into x from jsonb_array_elements(r->'satirlar') where value->>'malzeme_id'=m::text;
 assert (x->>'gelen')::numeric=80000 and (x->>'satis')::numeric=28000 and (x->>'fire')::numeric=1400 and (x->>'beklenen')::numeric=150600 and (x->>'fark')::numeric=-4000 and (x->>'fark_tl')::numeric=-168,'Süt hesabı yanlış';
 select value into x from jsonb_array_elements(r->'satirlar') where value->>'malzeme_id'=b::text;
 assert (x->>'beklenen')::numeric=290 and (x->>'fark')::numeric=5 and (x->>'fark_tl')::numeric=10,'Bardak hesabı yanlış';
 assert (r->>'toplam_acik_tl')::numeric=-233 and (r->>'toplam_fazla_tl')::numeric=10,'Toplam yanlış';
 assert jsonb_array_length(r->'sayimlar')=2 and jsonb_array_length(r->'uyarilar')=0,'Dönem yanlış';
 assert position('fazla olduğundan büyük' in pg_get_functiondef('public.stok_farki(uuid)'::regprocedure))>0,'Fatura uyarısının yönü düzeltilmedi';
end $$;
reset role;
