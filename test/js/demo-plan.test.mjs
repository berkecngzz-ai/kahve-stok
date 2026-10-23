import {test} from 'node:test';import assert from 'node:assert/strict';
import {demoPlan} from '../../scripts/demo-plan.mjs';
test('demo veri planı dört hafta ve beş sayım içerir; betik veya DB çalıştırılmaz',()=>{
 const events=demoPlan();assert.equal(events.filter(e=>e.type==='fatura').length,4);assert.equal(events.filter(e=>e.type==='satis').length,28);assert.equal(events.filter(e=>e.type==='fire').length,28);
 const counts=events.filter(e=>e.type==='sayim');assert.deepEqual(counts.map(e=>e.day),[0,7,14,21,28]);
 // Elle: haftada kahve +5000-3780-70=+1150; süt +40000-28000-700=+11300; bardak +300-210=+90.
 assert.deepEqual(counts.map(e=>e.items),[
 {coffee:10000,milk:40000,cup:300},{coffee:11150,milk:51300,cup:390},{coffee:12300,milk:62600,cup:480},{coffee:13450,milk:61900,cup:570},{coffee:14600,milk:73200,cup:660}]);
 assert.deepEqual(counts.slice(1).map((e,i)=>e.items.milk-counts[i].items.milk-11300),[0,0,-12000,0]);
 assert.equal(12000/1000*42,504);assert.ok(events.every(e=>Object.values(e.items).every(n=>n>=0)));
});
