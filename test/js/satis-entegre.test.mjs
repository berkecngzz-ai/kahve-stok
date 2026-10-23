import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {veritabani} from '../sql-calistir.mjs';
import {csvRows,matchSales} from '../../satis-okuma.js';
const chain=['test/supabase_taklit.sql','sql/01_giris_mekan.sql','sql/02_malzeme_tarif.sql','sql/03_girisler.sql','sql/04_fatura_belge_kdv.sql','sql/05_belge_okuma_kurulum.sql','sql/06_ai_okuma.sql','sql/09_olagandisi_miktar.sql','sql/10_sifir_fiyat.sql','sql/11_acik_yetkiler.sql','sql/12_stok_duzeltmeleri.sql','sql/13_rapor_uyarilari.sql','sql/14_fatura_patron_yetkisi.sql','sql/15_satis_excel_dosya.sql'];
test('CSV → ürün eşleştirme → kurulum RPC → tarifle gerçek tüketim; tekrar kayıt engeli',async()=>{
 const db=await veritabani(chain,{sessiz:true});
 try{
  const owner='fa000000-0000-0000-0000-000000000001',setup='fa000000-0000-0000-0000-000000000002';
  await db.query('insert into auth.users(id,email) values($1,$2),($3,$4)',[owner,'owner@example.invalid',setup,'setup@example.invalid']);
  await db.query('insert into kurulum_hesaplari(user_id) values($1)',[setup]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
  await db.exec("set role authenticated;select mekan_olustur('CSV Test Kafe','Patron');");
  const materials={};for(const [key,unit] of [['coffee','g'],['milk','ml'],['cup','adet']])materials[key]=(await db.query('insert into malzemeler(ad,birim) values($1,$2) returning id',[key,unit])).rows[0].id;
  const products=[];
  for(const [ad,coffee,milk] of [['Latte',18,200],['Cappuccino',18,150],['Flat White',18,120],['Americano',18,0],['Karamel Latte',18,200],['Vanilya Latte',18,200],['Filtre Kahve',20,0]]){
   const recipe=[{malzeme_id:materials.coffee,miktar:coffee},{malzeme_id:materials.cup,miktar:1}];if(milk)recipe.push({malzeme_id:materials.milk,miktar:milk});
   const id=(await db.query('select urun_kaydet(null,$1,$2::jsonb) id',[ad,JSON.stringify(recipe)])).rows[0].id;products.push({id,ad});
  }
  const read=matchSales(csvRows(readFileSync(new URL('./ornekler/05_satis_raporu_haftalik.csv',import.meta.url),'utf8')),products);assert.equal(read.unmatched.length,0);
  const cafe=(await db.query('select benim_mekanim() id')).rows[0].id,path=cafe+'/weekly/report.csv';
  await db.query("insert into storage.objects(bucket_id,name) values('fatura-belgeleri',$1)",[path]);
  const doc=(await db.query('select belge_kaydet($1::jsonb) b',[JSON.stringify({istek_id:'fa000000-0000-0000-0000-000000000003',tur:'satis_raporu',kaynak:'dosya',dosyalar:[path]})])).rows[0].b;
  await assert.rejects(()=>db.query('select kurulum_satis_raporu_isle($1,bugun(),$2::jsonb)',[doc.id,JSON.stringify(read.matched)]),/yalnızca kurulum/);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[setup]);
  const id=(await db.query('select kurulum_satis_raporu_isle($1,bugun(),$2::jsonb) id',[doc.id,JSON.stringify(read.matched)])).rows[0].id;
  await db.exec('reset role');
  const movements=(await db.query('select malzeme_id,miktar from malzeme_hareketleri where giris_id=$1',[id])).rows;
  const amount=key=>Number(movements.find(m=>m.malzeme_id===materials[key]).miktar);
  // Independent totals: coffee 473*18+64*20; milk 148*200+88*150+51*120+37*200+29*200.
  assert.equal(amount('coffee'),9794);assert.equal(amount('milk'),62120);assert.equal(amount('cup'),537);
  assert.equal((await db.query('select durum from belgeler where id=$1',[doc.id])).rows[0].durum,'tamam');
  await db.exec('set role authenticated');
  await assert.rejects(()=>db.query('select kurulum_satis_raporu_isle($1,bugun(),$2::jsonb)',[doc.id,JSON.stringify(read.matched)]),/zaten işlenmiş/);
  await db.exec('reset role');assert.equal((await db.query('select count(*) n from girisler where tur=\'satis\'' )).rows[0].n,1);
 } finally{await db.close();}
});
