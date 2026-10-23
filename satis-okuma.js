// Offline sales report import. No AI, no network; prices never determine consumption.
export const normalize = s => String(s ?? '').normalize('NFKC').toLocaleLowerCase('tr-TR').replace(/ı/g,'i').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim();
export function csvRows(text) {
 text=String(text).replace(/^\uFEFF/,'');
 const first=text.split(/\r?\n/).find(s=>s.trim())||'';
 const separator=[';', '\t', ','].sort((a,b)=>first.split(b).length-first.split(a).length)[0];
 const rows=[];let row=[],cell='',quoted=false,closed=false;
 for(let i=0;i<text.length;i++){
  const ch=text[i];
  if(quoted){if(ch==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=ch;continue;}
  if(ch==='"'){if(cell||closed)throw Error('CSV tırnak yapısı bozuk.');quoted=true;}
  else if(ch===separator){row.push(cell);cell='';closed=false;}
  else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))rows.push(row);row=[];cell='';closed=false;}
  else {if(closed&&!/\s/.test(ch))throw Error('CSV tırnak yapısı bozuk.');cell+=ch;}
 }
 if(quoted)throw Error('CSV tırnağı kapanmamış.');
 row.push(cell);if(row.some(x=>x.trim()))rows.push(row);
 if(rows.length>10001)throw Error('Raporda en fazla 10000 satır olabilir.');
 return rows;
}
export function matchSales(rows,products){
 const names=['urun adi','urun','product','product name','item','item name'];
 const quantities=['adet','miktar','quantity','qty','satis adedi'];
 let header=-1,ni=-1,qi=-1;
 for(let i=0;i<Math.min(rows.length,20);i++){
  const r=rows[i].map(normalize), n=r.map((v,j)=>names.includes(v)?j:-1).filter(j=>j>=0),q=r.map((v,j)=>quantities.includes(v)?j:-1).filter(j=>j>=0);
  if(n.length&&q.length){if(n.length!==1||q.length!==1)throw Error('Ürün ve adet sütunları belirsiz.');header=i;ni=n[0];qi=q[0];break;}
 }
 if(header<0)throw Error('Ürün adı ve adet sütunları bulunamadı.');
 const totals=new Map(),unmatched=[];
 for(let i=header+1;i<rows.length;i++){
  const r=rows[i];if(!r.some(v=>String(v??'').trim()))continue;
  const raw=String(r[ni]??'').trim();if(['toplam','genel toplam','grand total','total'].includes(normalize(raw)))continue;
  const value=String(r[qi]??'').trim();
  if(!raw||!/^\d+(?:[.,]0{1,2})?$/.test(value))throw Error(`${i+1}. satırın ürün adı veya adedi geçersiz.`);
  const amount=Number(value.replace(',','.'));if(!Number.isSafeInteger(amount)||amount<0||amount>100000)throw Error(`${i+1}. satırın adedi geçersiz.`);
  if(!amount)continue;
  const key=normalize(raw).replace(/\s*\(ikram\)\s*$/,'').trim();
  const found=products.filter(p=>p.aktif!==false&&normalize(p.ad)===key);
  if(found.length!==1){unmatched.push({name:raw,quantity:amount,row:i+1});continue;}
  const id=found[0].id;const sum=(totals.get(id)||0)+amount;if(sum>100000)throw Error('Bir ürün için toplam adet 100000 sınırını aşıyor.');totals.set(id,sum);
 }
 if(!totals.size&&!unmatched.length)throw Error('Raporda tüketim adedi bulunamadı.');
 return {matched:[...totals].map(([urun_id,miktar])=>({urun_id,miktar})),unmatched};
}
// Bounded ZIP/OpenXML reader: one visible worksheet, no formula evaluation or external links.
export async function xlsxRows(buffer,Parser=globalThis.DOMParser){
 const data=new Uint8Array(buffer),v=new DataView(data.buffer,data.byteOffset,data.byteLength),decoder=new TextDecoder();
 if(data.length>5*1024*1024)throw Error('Dosya en fazla 5 MB olabilir.');
 let end=-1;for(let p=data.length-22;p>=Math.max(0,data.length-65557);p--)if(v.getUint32(p,true)===0x06054b50){end=p;break;}
 if(end<0)throw Error('Excel dosyası okunamadı. XLSX veya CSV kullan.');
 const count=v.getUint16(end+10,true);if(count>1000)throw Error('Excel dosyası çok karmaşık.');
 const entries=new Map();let p=v.getUint32(end+16,true),total=0;
 for(let i=0;i<count;i++){
  if(v.getUint32(p,true)!==0x02014b50)throw Error('Excel arşivi bozuk.');
  const flags=v.getUint16(p+8,true),method=v.getUint16(p+10,true),size=v.getUint32(p+20,true),raw=v.getUint32(p+24,true),nl=v.getUint16(p+28,true),el=v.getUint16(p+30,true),cl=v.getUint16(p+32,true),offset=v.getUint32(p+42,true);
  const name=decoder.decode(data.slice(p+46,p+46+nl));total+=raw;
  if(flags&1||raw>10*1024*1024||total>20*1024*1024||entries.has(name))throw Error('Şifreli veya çok büyük Excel dosyası.');
  entries.set(name,{method,size,raw,offset});p+=46+nl+el+cl;
 }
 const read=async name=>{
  const e=entries.get(name);if(!e)throw Error('Excel sayfası bulunamadı.');
  const o=e.offset;if(v.getUint32(o,true)!==0x04034b50)throw Error('Excel arşivi bozuk.');
  const start=o+30+v.getUint16(o+26,true)+v.getUint16(o+28,true);if(start+e.size>data.length)throw Error('Excel arşivi eksik.');
  let bytes=data.slice(start,start+e.size);
  if(e.method===8){const reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();const chunks=[];let length=0;for(;;){const r=await reader.read();if(r.done)break;length+=r.value.length;if(length>e.raw||length>10*1024*1024){await reader.cancel();throw Error('Excel açılımı çok büyük.');}chunks.push(r.value);}bytes=new Uint8Array(length);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}}
  else if(e.method!==0)throw Error('Desteklenmeyen Excel sıkıştırması.');
  if(bytes.length!==e.raw)throw Error('Excel arşivi eksik.');
  const xml=decoder.decode(bytes);if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('Desteklenmeyen Excel XML.');
  const doc=new Parser().parseFromString(xml,'application/xml');if(doc.getElementsByTagName('parsererror').length)throw Error('Excel XML bozuk.');return doc;
 };
 const elements=(doc,tag)=>Array.from(doc.getElementsByTagNameNS('*',tag));
 const workbook=await read('xl/workbook.xml');const sheets=elements(workbook,'sheet').filter(s=>!s.getAttribute('state')||s.getAttribute('state')==='visible');
 if(sheets.length!==1)throw Error('Excel raporunda tek görünür sayfa olmalı; diğerlerini ayrı CSV olarak gönder.');
 const rels=await read('xl/_rels/workbook.xml.rels');const rid=sheets[0].getAttribute('r:id');const relation=elements(rels,'Relationship').find(r=>r.getAttribute('Id')===rid);
 if(!relation||relation.getAttribute('TargetMode')==='External')throw Error('Excel sayfa bağlantısı geçersiz.');
 const target=relation.getAttribute('Target');if(target.includes('..')||target.includes('\\'))throw Error('Excel sayfa yolu geçersiz.');
 const path=target.startsWith('/')?target.slice(1):'xl/'+target;
 const shared=entries.has('xl/sharedStrings.xml')?elements(await read('xl/sharedStrings.xml'),'si').map(s=>elements(s,'t').map(t=>t.textContent).join('')):[];
 const sheet=await read(path),result=[];
 for(const row of elements(sheet,'row')){
  const values=[];
  for(const cell of elements(row,'c')){
   if(elements(cell,'f').length)throw Error('Formüllü Excel yerine değerleri içeren CSV gönder.');
   const address=/^([A-Z]+)\d+$/.exec(cell.getAttribute('r'));if(!address)throw Error('Excel hücresi geçersiz.');
   const index=[...address[1]].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1;if(index>1000)throw Error('Excel çok geniş.');
   const raw=elements(cell,'v')[0]?.textContent??'';const type=cell.getAttribute('t');
   values[index]=type==='s'?shared[Number(raw)]:type==='inlineStr'?elements(cell,'t').map(t=>t.textContent).join(''):raw;
   if(values[index]==null)throw Error('Excel metin referansı geçersiz.');
  }
  result.push(Array.from({length:values.length},(_,i)=>values[i]??''));if(result.length>10001)throw Error('Excel çok uzun.');
 }
 return result;
}
export async function readSalesFile(file,products,Parser){
 const extension=file.name.toLowerCase().split('.').pop();
 if(file.size>5*1024*1024)throw Error('Dosya en fazla 5 MB olabilir.');
 const rows=extension==='xlsx'?await xlsxRows(await file.arrayBuffer(),Parser):['csv','txt','tsv'].includes(extension)?csvRows(await file.text()):null;
 if(!rows)throw Error('XLSX veya CSV dosyası seç.');
 return matchSales(rows,products);
}


export function salesFileKind(file, fallback) { return /\.xlsx$/i.test(file.name) ? 'xlsx' : fallback(file); }
