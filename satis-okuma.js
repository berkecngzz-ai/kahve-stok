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
// Sütun başlığı puanı: birebir bilinen ad 3, bilinen kelimeyi içeren ad 2 (kasa programları "Satış Miktarı",
// "Stok Adı", "Ürün Açıklaması" gibi yazar). Kod/tutar/fiyat sütunları aday olmaz. En yüksek puan tek olmalı.
const NAME_EXACT=['urun adi','urun','product','product name','item','item name'];
const QTY_EXACT=['adet','miktar','quantity','qty','satis adedi'];
const nameScore=v=>NAME_EXACT.includes(v)?3:/\b(kod|kodu|code|id|no|barkod|barcode|grup|grubu|group|kategori|category)\b/.test(v)?0
 :/\b(urun|product|item|stok|menu)\b/.test(v)&&/\b(adi|ad|name|aciklama|aciklamasi|tanim|tanimi)\b|^(urun|product|item)\b/.test(v)?2:0;
const qtyScore=v=>QTY_EXACT.includes(v)?3:/\b(tutar|fiyat|fiyati|price|amount|ciro|kdv|tax|iade|return|tl|try)\b/.test(v)?0
 :/\b(adet|adedi|miktar|miktari|quantity|qty|satilan)\b/.test(v)?2:0;
function bestColumn(cells,score){
 const p=cells.map(score),max=Math.max(0,...p);if(!max)return -1;
 const all=p.flatMap((x,j)=>x===max?[j]:[]);if(all.length!==1)throw Error('Ürün ve adet sütunları belirsiz.');return all[0];
}
// "TOPLAM", "Ara Toplam", "GENEL TOPLAM:", "Total (TL)" gibi özet satırları ürün değildir.
const isTotalRow=v=>/^(ara |genel |gun |grand |sub)?(toplam|total|subtotal)\b/.test(v);
// Kasa raporundaki adet: "12", "12,00", "1.250" (TR binlik), "1.250,00", "12 adet", "-2" (iade). Boş → null; bozuk → NaN.
export function parseQty(v){
 let s=String(v??'').trim().replace(/\s*(adet|ad|pcs|pc|x)\.?$/i,'').replace(/\s/g,'');
 if(!s)return null;
 const neg=s.startsWith('-');if(neg)s=s.slice(1);
 let n;
 if(/^\d+$/.test(s))n=Number(s);
 else if(/^\d{1,3}(\.\d{3})+(,0+)?$/.test(s))n=Number(s.replace(/,0+$/,'').replace(/\./g,''));
 else if(/^\d+[.,]0{1,3}$/.test(s))n=Number(s.split(/[.,]/)[0]);
 else return NaN;
 return neg?-n:n;
}
// Kasa adının anahtarı (hafıza ve eşleşme): küçük harf, aksansız, "(ikram)" eki atılır.
export const salesKey=raw=>normalize(raw).replace(/\s*\(ikram\)\s*$/,'').trim().slice(0,200);
const tokens=v=>v.split(/[^a-z0-9]+/).filter(Boolean);
// Eşleşmeyen kasa adına öneri: ürün adının bütün kelimeleri kasa adında geçiyor VE fark yalnız boy / sıcaklık
// ("latte buyuk", "ice latte", "karamel latte (b)" → ilgili ürün). "Chai Latte", "Double Espresso" önerilmez (tarif farklı).
const BOY=new Set(['buyuk','kucuk','orta','b','k','o','l','m','s','xl','large','small','medium','regular','grande','tall','venti',
 'boy','ice','iced','buzlu','soguk','sicak','hot','cold']);
function suggest(key,active){
 const kt=tokens(key),ks=new Set(kt);let best=null,bestLen=0,tie=false;
 for(const p of active){
  const pt=tokens(normalize(p.ad));if(!pt.length||!pt.every(t=>ks.has(t)))continue;
  if(!kt.every(t=>pt.includes(t)||BOY.has(t)))continue;
  if(pt.length>bestLen){best=p;bestLen=pt.length;tie=false;}else if(pt.length===bestLen)tie=true;
 }
 return best&&!tie?best.id:null;
}
// memory: Map(kasa anahtarı → urun_id | null). null: "tarifi yok, stoktan düşme" (atlanır, ignored'a yazılır).
// Boş adetli satır (kategori başlığı) atlanır; iade (eksi) aynı ürünün toplamından düşer.
export function matchSales(rows,products,memory=new Map()){
 let header=-1,ni=-1,qi=-1;
 for(let i=0;i<Math.min(rows.length,20);i++){
  const r=rows[i].map(normalize),n=bestColumn(r,nameScore),q=bestColumn(r,qtyScore);
  if(n>=0&&q>=0&&n!==q){header=i;ni=n;qi=q;break;}
 }
 if(header<0)throw Error('Ürün adı ve adet sütunları bulunamadı.');
 const active=products.filter(p=>p.aktif!==false),activeIds=new Set(active.map(p=>p.id));
 const totals=new Map(),unmatched=new Map(),ignored=new Map();
 const add=(map,k,v,amount)=>{const x=map.get(k)||{...v,quantity:0};x.quantity+=amount;map.set(k,x);};
 for(let i=header+1;i<rows.length;i++){
  const r=rows[i];if(!r.some(v=>String(v??'').trim()))continue;
  const raw=String(r[ni]??'').trim();if(!raw||isTotalRow(normalize(raw)))continue;
  const amount=parseQty(r[qi]);
  if(amount===null)continue;
  if(!Number.isSafeInteger(amount))throw Error(`${i+1}. satırın adedi okunamadı ("${String(r[qi]).trim()}").`);
  if(Math.abs(amount)>100000)throw Error(`${i+1}. satırın adedi geçersiz.`);
  if(!amount)continue;
  const key=salesKey(raw);
  // Sıra: hatırlanan ürün → menüde birebir aynı ad → hatırlanan "takip edilmiyor" → seçim. (Takip dışı bırakılan ürün
  // sonradan menüye aynı adla eklenirse kendiliğinden sayılmaya başlar.)
  let id=memory.get(key);
  if(id&&!activeIds.has(id))id=undefined;
  if(!id){const found=active.filter(p=>normalize(p.ad)===key);id=found.length===1?found[0].id:undefined;}
  if(!id&&memory.get(key)===null){add(ignored,key,{name:raw,key},amount);continue;}
  if(!id){add(unmatched,key,{name:raw,key,row:i+1,suggestion:suggest(key,active)},amount);continue;}
  const sum=(totals.get(id)||0)+amount;if(sum>100000)throw Error('Bir ürün için toplam adet 100000 sınırını aşıyor.');totals.set(id,sum);
 }
 const matched=[...totals].filter(([,m])=>m>0).map(([urun_id,miktar])=>({urun_id,miktar}));
 const un=[...unmatched.values()].filter(x=>x.quantity>0);
 if(!matched.length&&!un.length&&!ignored.size)throw Error('Raporda satış adedi bulunamadı.');
 return {matched,unmatched:un,ignored:[...ignored.values()]};
}
// Bazı kasa programları "Excel" diye HTML tablo verir (.xls / .htm). Hücre metinleri satır satır.
export function htmlRows(text){
 const decode=t=>t.replace(/<br\s*\/?>/gi,' ').replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
  .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&amp;/g,'&').trim();
 const rows=[];
 for(const tr of String(text).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
  rows.push([...tr[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c=>decode(c[1])));
  if(rows.length>10001)throw Error('Raporda en fazla 10000 satır olabilir.');
 }
 if(!rows.length)throw Error('Raporda tablo bulunamadı.');
 return rows;
}
// Cihazda okunamayan rapor (fotoğraf, PDF, eski ikili .xls): kurulum ekibi işler.
export class KurulumIsler extends Error{}
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
export async function readSalesFile(file,products,Parser,memory){
 const extension=file.name.toLowerCase().split('.').pop();
 if(file.size>5*1024*1024)throw Error('Dosya en fazla 5 MB olabilir.');
 if(!['xlsx','xls','csv','txt','tsv','htm','html'].includes(extension))throw new KurulumIsler('Bu rapor türü cihazda okunamaz.');
 const buffer=await file.arrayBuffer(),head=new Uint8Array(buffer.slice(0,4));
 let rows;
 if(head[0]===0x50&&head[1]===0x4b)rows=await xlsxRows(buffer,Parser);                      // XLSX (zip)
 else if(head[0]===0xd0&&head[1]===0xcf)throw new KurulumIsler('Eski Excel (.xls) biçimi cihazda okunamaz.');
 else{
  // Türk kasa programları CSV'yi çoğu zaman Windows-1254 ile yazar; UTF-8 değilse ona göre çözülür.
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(buffer);}catch{text=new TextDecoder('windows-1254').decode(buffer);}
  rows=/<table\b/i.test(text)?htmlRows(text):csvRows(text);
 }
 return matchSales(rows,products,memory);
}


export function salesFileKind(file, fallback) { return /\.xlsx$/i.test(file.name) ? 'xlsx' : fallback(file); }
