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
test('kesir, bozuk, belirsiz sütun, taşma ve bozuk CSV kaydedilmez; boş adet atlanır, iade stoğu artırmaz',()=>{
 for(const q of ['1,5','NaN','100001','1,250','abc'])assert.throws(()=>matchSales([['Ürün','Adet'],['Latte',q]],products));
 assert.throws(()=>matchSales([['Ürün','Adet'],['Latte','']],products),/bulunamadı/);
 const ia=matchSales([['Ürün','Adet'],['Latte','10'],['Latte','-2'],['Americano','-1']],products);
 assert.deepEqual(ia.matched,[{urun_id:'0',miktar:10}]);assert.deepEqual(ia.counts,{satis:10,iptal:0,iade:3});
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
test('kasa programlarının başlıkları: Stok Adı / Satış Miktarı; kod, grup, fiyat sütunları aday değil; özet satırları atlanır',()=>{
 const p=[{id:'1',ad:'Latte'}];
 assert.deepEqual(matchSales([['Stok Kodu','Stok Adı','Satış Miktarı','Tutar'],['L01','Latte','12','840'],['','ARA TOPLAM:','12','840'],['','Genel Toplam (TL)','12','840']],p
  ).matched,[{urun_id:'1',miktar:12}]);
 assert.deepEqual(matchSales([['Ürün Kodu','Ürün Adı','Ürün Grubu','Adet','Birim Fiyatı'],['1','Latte','Sıcak','3','70']],p).matched,[{urun_id:'1',miktar:3}]);
 assert.deepEqual(matchSales([['Item Description','Qty Sold','Price'],['Latte','4','0']],p).matched,[{urun_id:'1',miktar:4}]);
 // "Toplama" gibi toplamla başlamayan ürün adı atlanmaz; birebir bilinen başlık (Satış Adedi) benzerine (İade Adedi) üstün
 assert.equal(matchSales([['Ürün','Adet'],['Toplama Kahve','2']],p).unmatched.length,1);
 assert.deepEqual(matchSales([['Ürün Adı','Satış Adedi','İade Adedi'],['Latte','3','1']],p).matched,[{urun_id:'1',miktar:3}]);
 assert.throws(()=>matchSales([['Ürün Adı','Satılan Adet','Satış Miktarı'],['Latte','3','3']],p),/belirsiz/);
});

import {parseQty,htmlRows,salesKey,KurulumIsler} from '../../satis-okuma.js';
test('kasa adetleri: TR binlik, sıfır ondalık, birim yazısı, iade',()=>{
 assert.deepEqual(['12','12,00','12.00','1.250','1.250,00','12 adet','-3','',' '].map(parseQty),[12,12,12,1250,1250,12,-3,null,null]);
 assert.ok(Number.isNaN(parseQty('1,5')));assert.ok(Number.isNaN(parseQty('x12')));
});
test('POS raporu: kategori başlıkları, "Toplam Adet" sütunu, hafıza ve öneri',()=>{
 const p=[{id:'L',ad:'Latte'},{id:'K',ad:'Karamel Latte'},{id:'A',ad:'Americano'},{id:'P',ad:'Pasif',aktif:false}];
 const rows=[['Rapor: 17-24 Ekim'],['Ürün Adı','Toplam Adet','Tutar'],['SICAK KAHVELER','',''],['LATTE BÜYÜK','12','1.200,00'],
  ['Karamel Latte (B)','3',''],['Su 0.5','40',''],['Americano','7',''],['Latte büyük','2',''],['GENEL TOPLAM','64','']];
 const r=matchSales(rows,p,new Map([['su 0.5',null]]));
 assert.deepEqual(r.matched,[{urun_id:'A',miktar:7}]);
 assert.deepEqual(r.unmatched.map(x=>[x.key,x.quantity,x.suggestion]),[['latte buyuk',14,'L'],['karamel latte (b)',3,'K']]);
 assert.deepEqual(r.ignored.map(x=>[x.key,x.quantity]),[['su 0.5',40]]);
 // Hatırlanan eşleşme bir dahaki raporda sorulmaz; pasif ürüne giden hafıza yok sayılır
 const r2=matchSales(rows,p,new Map([['su 0.5',null],['latte buyuk','L'],['karamel latte (b)','P']]));
 assert.deepEqual(r2.matched,[{urun_id:'L',miktar:14},{urun_id:'A',miktar:7}]);
 assert.deepEqual(r2.unmatched.map(x=>x.key),['karamel latte (b)']);
 // Eşit uzunlukta iki öneri: uydurulmaz
 assert.equal(matchSales([['Ürün','Adet'],['Latte Americano','1']],p).unmatched[0].suggestion,null);
 assert.equal(salesKey('  LATTE (İkram) '),'latte');
});
test('HTML tablo olarak verilen "Excel" raporu okunur',()=>{
 const rows=htmlRows('<html><table border=1><tr><th>Ürün</th><th>Adet</th></tr><tr><td><b>Latte</b> &amp; Süt</td><td>5</td></tr></table></html>');
 assert.deepEqual(rows,[['Ürün','Adet'],['Latte & Süt','5']]);
 assert.throws(()=>htmlRows('<p>yok</p>'),/tablo/);
});
test('dosya içeriğine göre okuma: XLSX, HTML-xls, Windows-1254 CSV; fotoğraf/PDF/ikili xls kuruluma',async()=>{
 const dosya=(name,bytes)=>({name,size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length)});
 const p=[{id:'U',ad:'Ürün Ç'}];
 const cp1254=new Uint8Array([0xDC,0x72,0xFC,0x6E,0x3B,0x41,0x64,0x65,0x74,0x0A,0xDC,0x72,0xFC,0x6E,0x20,0xC7,0x3B,0x34]);   // "Ürün;Adet / Ürün Ç;4"
 assert.deepEqual((await readSalesFile(dosya('r.csv',cp1254),p)).matched,[{urun_id:'U',miktar:4}]);
 const html=new TextEncoder().encode('<table><tr><td>Ürün</td><td>Adet</td></tr><tr><td>Ürün Ç</td><td>2</td></tr></table>');
 assert.deepEqual((await readSalesFile(dosya('r.xls',html),p)).matched,[{urun_id:'U',miktar:2}]);
 await assert.rejects(()=>readSalesFile(dosya('r.xls',new Uint8Array([0xD0,0xCF,0x11,0xE0,0,0])),p),KurulumIsler);
 await assert.rejects(()=>readSalesFile(dosya('r.pdf',new Uint8Array([37,80])),p),KurulumIsler);
 await assert.rejects(()=>readSalesFile(dosya('r.jpg',new Uint8Array([255,216])),p),KurulumIsler);
 const xlsx=readFileSync(new URL('./ornekler/05_satis_raporu_haftalik.xlsx',import.meta.url));
 const r=await readSalesFile(dosya('kasa.xlsx',new Uint8Array(xlsx)),products,DOMParser);
 assert.equal(r.matched.reduce((a,b)=>a+b.miktar,0),537);
});
test('öneri yalnız boy / sıcaklık farkında; tarifi farklı türev önerilmez; takip dışı ürün sonradan menüye eklenince sayılır',()=>{
 const p=[{id:'L',ad:'Latte'},{id:'E',ad:'Espresso'},{id:'K',ad:'Karamel Latte'}];
 const r=matchSales([['Ürün','Adet'],['Ice Latte','8'],['Latte Büyük','3'],['Chai Latte','2'],['Double Espresso','4'],['Ice Karamel Latte','1'],['San Sebastian Cheesecake','5']],p);
 assert.deepEqual(Object.fromEntries(r.unmatched.map(x=>[x.name,x.suggestion])),
  {'Ice Latte':'L','Latte Büyük':'L','Chai Latte':null,'Double Espresso':null,'Ice Karamel Latte':'K','San Sebastian Cheesecake':null});
 const hafiza=new Map([['san sebastian cheesecake',null]]);
 assert.deepEqual(matchSales([['Ürün','Adet'],['San Sebastian Cheesecake','5']],p,hafiza).ignored.map(x=>x.quantity),[5]);
 const yeni=[...p,{id:'S',ad:'San Sebastian Cheesecake'}];
 assert.deepEqual(matchSales([['Ürün','Adet'],['San Sebastian Cheesecake','5']],yeni,hafiza).matched,[{urun_id:'S',miktar:5}]);
});
test('örnek kasa raporları (4 biçim) aynı toplamı verir',async()=>{
 const menu=['Espresso','Americano','Latte','Cappuccino','Flat White','Karamel Latte','Vanilya Latte','Mocha','Filtre Kahve','Çay','Sıcak Çikolata'].map((ad,i)=>({id:'u'+i,ad}));
 const toplamlar=[];
 for(const f of ['1-bulut-adisyon_urun-satis.xlsx','2-muhasebe-erp_satis.csv','3-masaustu-pos_urun-satis.xls','4-yabanci-pos_item-sales.csv']){
  const b=readFileSync(new URL('../../ornek-kasa-raporlari/'+f,import.meta.url));
  const r=await readSalesFile({name:f,size:b.length,arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.length)},menu,DOMParser);
  toplamlar.push([...r.matched.map(x=>x.miktar),...r.unmatched.map(x=>x.quantity)].reduce((a,c)=>a+c,0));
  assert.ok(r.unmatched.some(x=>/san sebastian/.test(x.key)&&x.suggestion===null),f+': San Sebastian takip dışı olmalı');
 }
 assert.deepEqual(toplamlar,[1848,1848,1848,1848]);   // iade satırları (−3) stoğa etki etmez
});
test('menüde yazım hatası olan ürün sessizce atlanmaz, öneri olarak gelir; farklı ürünler karışmaz',()=>{
 const p=[{id:'C',ad:'cappucino'},{id:'L',ad:'Latte'},{id:'M',ad:'Matcha'}];
 const r=matchSales([['Ürün','Adet'],['Cappuccino','91'],['Mocha','4'],['Chai Latte','2'],['Lattee','3']],p);
 assert.deepEqual(Object.fromEntries(r.unmatched.map(x=>[x.name,x.suggestion])),{Cappuccino:'C',Mocha:null,'Chai Latte':null,Lattee:'L'});
});

test('satır bazında: fiş, tarih/saat, durum; aynı fişin aynı ürünü birleşir; satışsız iptal 0; Excel tarih/saat sayıları',()=>{
 const p=[{id:'L',ad:'Latte'},{id:'E',ad:'Espresso'}];
 const r=matchSales([['Fiş No','Tarih','Saat','Ürün','Adet','Tutar','Durum'],
  ['A1','03.10.2026','14:22','Latte','2','330,00','Satış'],['A1','03.10.2026','14:22','Latte','1','165,00','Satış'],
  ['A2','03.10.2026','15:00','Latte','1','165,00','İptal'],['A3','04.10.2026','09:10','Espresso','1','110','İade'],
  ['','','','SICAK İÇECEKLER','',''],['A4','2026-10-04','09:15','Latte','1','165','Satış']],p);
 assert.deepEqual(r.matched,[{urun_id:'L',miktar:4}]);
 assert.deepEqual(r.period,['2026-10-03','2026-10-04']);
 assert.equal(r.lines.length,4);
 assert.deepEqual(r.lines[0],{tarih:'2026-10-03',zaman:'2026-10-03 14:22:00',fis_no:'A1',ad:'Latte',ad_anahtar:'latte',adet:3,tutar:495,tur:'satis',urun_id:'L'});
 assert.equal(r.lines.find(l=>l.fis_no==='A3').tur,'iade');
 const x=matchSales([['Tarih Saat','Ürün','Adet'],['46313.6','Latte','2']],p);
 assert.equal(x.lines[0].zaman,'2026-10-18 14:24:00');
 assert.throws(()=>matchSales([['Tarih','Ürün','Adet'],['31-31-2026','Latte','1']],p),/tarihi okunamadı/);
});
