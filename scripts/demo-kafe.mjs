// HAZIRLANDI; bu çalışma sırasında ÇALIŞTIRILMADI.
// Yalnız bellek içi PGlite. Ağ, Supabase CLI, OpenAI veya canlı bağlantı içermez.
// İleride çalıştırma: node scripts/demo-kafe.mjs
// Sonuç yalnız proje/demo-output içinde yeni bir JSON'a yazılır; var olan dosya ezilmez.
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {veritabani} from '../test/sql-calistir.mjs';
import {demoPlan} from './demo-plan.mjs';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const chain=['test/supabase_taklit.sql','sql/01_giris_mekan.sql','sql/02_malzeme_tarif.sql','sql/03_girisler.sql','sql/04_fatura_belge_kdv.sql','sql/05_belge_okuma_kurulum.sql','sql/06_ai_okuma.sql','sql/09_olagandisi_miktar.sql','sql/10_sifir_fiyat.sql','sql/11_acik_yetkiler.sql','sql/12_stok_duzeltmeleri.sql','sql/13_rapor_uyarilari.sql','sql/14_fatura_patron_yetkisi.sql','sql/15_satis_excel_dosya.sql'];
const db=await veritabani(chain,{sessiz:true});
try{
 const uid='de000000-0000-0000-0000-000000000001';
 await db.query('insert into auth.users(id,email) values($1,$2)',[uid,'demo@example.invalid']);
 await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.email',$2,false)",[uid,'demo@example.invalid']);
 await db.exec("set role authenticated; select public.mekan_olustur('Demo Kafe','Demo Patron');");
 await db.exec("reset role; update public.mekanlar set demo=true where ad='Demo Kafe'; set role authenticated;");
 const ids={};
 for(const [key,ad,birim,fiyat] of [['coffee','Demo Kahve','g',650],['milk','Demo Süt','ml',42],['cup','Demo Bardak','adet',2]]){
  ids[key]=(await db.query('insert into malzemeler(ad,birim,fiyat) values($1,$2,$3) returning id',[ad,birim,fiyat])).rows[0].id;
 }
 for(const [key,ad,recipe] of [['latte','Demo Latte',{coffee:18,milk:200,cup:1}],['espresso','Demo Espresso',{coffee:18,cup:1}]]){
  ids[key]=(await db.query('select urun_kaydet(null,$1,$2::jsonb) id',[ad,JSON.stringify(Object.entries(recipe).map(([k,miktar])=>({malzeme_id:ids[k],miktar})))])).rows[0].id;
 }
 const reports=[];
 for(const event of demoPlan()){
  const items=Object.entries(event.items).map(([key,miktar])=>event.type==='satis'?{urun_id:ids[key],miktar}:{malzeme_id:ids[key],miktar});
  if(event.type==='fatura'){
   const prices={coffee:.65,milk:.042,cup:2};
   items.forEach((item,i)=>{item.tutar_kdv_haric=Math.round(item.miktar*prices[Object.keys(event.items)[i]]*100)/100;item.kdv_orani=0;});
   await db.query("select fatura_kaydet(bugun()-28+$1::int,'Demo Tedarikçi',$2::jsonb,$3::jsonb,'[]'::jsonb)",[event.day,JSON.stringify(items),JSON.stringify({genel:5530})]);
  }else{
   const id=(await db.query("select giris_kaydet($1,bugun()-28+$2::int,'Kurgusal demo',$3::jsonb) id",[event.type,event.day,JSON.stringify(items)])).rows[0].id;
   if(event.type==='sayim'&&event.day){
    const report=(await db.query('select stok_farki($1) report',[id])).rows[0].report;
    const expected=event.day===21?-504:0;
    if(Number(report.toplam_acik_tl)!==expected||Number(report.toplam_fazla_tl)!==0)throw Error('Demo rapor kontrolü başarısız');
    reports.push({week:event.day/7,report});
   }
  }
 }
 await db.exec('reset role');
 const data={};for(const table of ['mekanlar','uyeler','malzemeler','urunler','tarif_kalemleri','girisler','giris_kalemleri','malzeme_hareketleri','fiyat_gecmisi'])data[table]=(await db.query(`select * from public.${table}`)).rows;
 const directory=join(root,'demo-output');await mkdir(directory,{recursive:true});
 await writeFile(join(directory,'demo-kafe.json'),JSON.stringify({fictional:true,reports,data},null,2),{encoding:'utf8',flag:'wx'});
 console.log('Yerel demo hazır: demo-output/demo-kafe.json');
}finally{await db.close();}
