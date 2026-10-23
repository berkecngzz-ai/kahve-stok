import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {csvRows,matchSales,readSalesFile} from '../../satis-okuma.js';
const names=['Latte','Cappuccino','Flat White','Americano','Karamel Latte','Vanilya Latte','Filtre Kahve'];
const products=names.map((ad,i)=>({ad,id:String(i)}));
test('gerçek haftalık fixture: ikram fiyatı sıfır olsa da 148 Latte, 537 toplam',()=>{
 const r=matchSales(csvRows(readFileSync(new URL('./ornekler/05_satis_raporu_haftalik.csv',import.meta.url),'utf8')),products);
 assert.deepEqual(r.unmatched,[]);assert.deepEqual(r.matched.map(x=>x.miktar),[148,88,51,120,37,29,64]);assert.equal(r.matched.reduce((a,b)=>a+b.miktar,0),537);
});
test('eşleşmeyen, pasif ve belirsiz ad kuruluma kalır; türev ad uydurulmaz',()=>{
 const r=matchSales([['Ürün','Adet'],['Latte',2],['Karamel Latte',3],['Sütlü Latte',4]],[{id:'1',ad:'Latte'},{id:'2',ad:'LATTE'},{id:'3',ad:'Karamel Latte',aktif:false}]);assert.equal(r.matched.length,0);assert.equal(r.unmatched.length,3);
});
test('BOM, tırnaklı virgül, satır sonu, farklı sütun sırası, toplam satırı',()=>{
 const rows=csvRows('\uFEFFAdet,Ürün Adı,Tutar\r\n2,"Latte",0\r\n3,"Özel, Kahve",0\r\n5,TOPLAM,0');
 assert.equal(matchSales(rows,[...products,{id:'extra',ad:'Özel, Kahve'}]).matched.length,2);
 assert.deepEqual(csvRows('Ürün;Adet\n"Çift ""espresso""";2')[1],['Çift "espresso"','2']);
});
test('kesir, negatif, eksik, belirsiz sütun, taşma ve bozuk CSV kaydedilmez',()=>{
 for(const q of ['-1','1,5','','NaN','100001','1.000'])assert.throws(()=>matchSales([['Ürün','Adet'],['Latte',q]],products));
 assert.throws(()=>matchSales([['Ürün','Adet','Quantity'],['Latte',1,1]],products));
 assert.throws(()=>csvRows('Ürün;Adet\n"Latte;3'));
 assert.throws(()=>matchSales([['Ürün','Adet'],['Latte',100000],['Latte (İKRAM)',1]],products));
});
test('fiyat sütunu olmadan da adedi okur; sıfır adet atlanır; kesir olmayan ondalık kabul',()=>{
 assert.deepEqual(matchSales([['Product name','Qty'],['LATTE (İKRAM)','2,00'],['Latte',0]],products).matched,[{urun_id:'0',miktar:2}]);
});
test('dosya türü ve boyut sınırı',async()=>{
 await assert.rejects(()=>readSalesFile({name:'r.xls',size:20},products));await assert.rejects(()=>readSalesFile({name:'r.csv',size:6000000},products));
});
import {DOMParser} from '@xmldom/xmldom';
import {xlsxRows} from '../../satis-okuma.js';
test('gerçek XLSX, Unicode, sıkıştırılmış XML, hücre miktarları',async()=>{
 const data=readFileSync(new URL('./ornekler/05_satis_raporu_haftalik.xlsx',import.meta.url));
 const rows=await xlsxRows(data,DOMParser);
 assert.deepEqual(matchSales(rows,products).matched.map(x=>x.miktar),[148,88,51,120,37,29,64]);
});
test('bozuk Excel reddedilir',async()=>{await assert.rejects(()=>xlsxRows(new Uint8Array(32),DOMParser));});

import {salesFileKind} from '../../satis-okuma.js';
import {dosyaTuru} from '../../okuma.js';
test('XLSX MIME içindeki xml sözcüğü dosya uzantısını XML yapmaz',()=>{
 assert.equal(salesFileKind({name:'rapor.xlsx',type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'},dosyaTuru),'xlsx');
 assert.equal(salesFileKind({name:'r.jpg',type:'image/jpeg'},dosyaTuru),'foto');
});
