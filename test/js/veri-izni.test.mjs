import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
test('veri izni taslağı zorunlu konuları ve doğrulanmamış alanları açıkça kapsar',()=>{
 const text=readFileSync(new URL('../../docs/veri-izni-taslak.md',import.meta.url),'utf8');
 for(const phrase of ['Supabase','OpenAI','malzemelerin adları, kimlikleri ve birimleri','Kurulum ekibi','kalıcı olarak silmez','[SUNUCU BÖLGESİ]','[SİLME TALEBİ İLETİŞİMİ]','[YEDEK SAKLAMA SÜRESİ]','Henüz uygulamada gösterilmez'])assert.ok(text.includes(phrase),phrase);
 assert.ok(text.includes('Vazgeç'));assert.ok(text.includes('Canlı ayarlar incelenmedi'));
});
