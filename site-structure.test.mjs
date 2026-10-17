import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('.',import.meta.url));
const pages=readdirSync(root).filter(name=>name.endsWith('.html'));
const read=name=>readFileSync(resolve(root,name),'utf8');
const attrs=tag=>Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map(m=>[m[1],m[2]]));

test('all pages share one stylesheet, a main landmark and a working first skip link',()=>{
 for(const page of pages){
  const source=read(page);
  assert.doesNotMatch(source,/<style\b|\sstyle\s*=/i,page);
  const css=[...source.matchAll(/<link\b[^>]*>/g)].map(m=>attrs(m[0])).filter(a=>a.rel==='stylesheet'&&!a.href.startsWith('http'));
  assert.equal(css.length,1,page);assert.equal(css[0].href.split('?')[0],'main.css',page);
  assert.equal((source.match(/<main\b/g)||[]).length,1,page);
  if(source.includes('class="footer"')&&!page.startsWith('checkout'))assert.equal((source.match(/class="footer-links"/g)||[]).length,1,page+' shared footer navigation');
  const main=attrs(source.match(/<main\b[^>]*>/)[0]);
  assert(main.id,page);assert.equal(main.tabindex,'-1',page);
  const skip=source.match(/<a\b[^>]*class="site-skip"[^>]*>/);
  assert(skip,page);assert.equal(attrs(skip[0]).href,'#'+main.id,page);
 }
});

test('shared mobile navigation uses a native disclosure button and controlled menu',()=>{
 for(const page of pages){
  const source=read(page);if(!source.includes('class="header"'))continue;
  assert.doesNotMatch(source,/navToggle|class="nav-toggle"/,page);
  const button=source.match(/<button\b[^>]*class="gear-burger"[^>]*>/);assert(button,page);
  const a=attrs(button[0]);assert.equal(a.type,'button',page);assert.equal(a['aria-controls'],'primaryNav',page);assert.equal(a['aria-expanded'],'false',page);
  assert.match(source,/<nav\b[^>]*id="primaryNav"/,page);assert.match(source,/src="site-nav\.js\?/,page);
 }
});

test('public pages have canonical addresses and branded sharing metadata; payment utilities stay unindexed',()=>{
 for(const page of pages){
  const source=read(page);
  if(page.startsWith('checkout')){assert.match(source,/<meta name="robots" content="noindex,follow">/,page);continue;}
  const expected='https://menu-made.com/'+(page==='index.html'?'':page.replace(/\.html$/,''));
  const canonical=[...source.matchAll(/<link\b[^>]*>/g)].map(m=>attrs(m[0])).filter(a=>a.rel==='canonical');
  assert.equal(canonical.length,1,page);assert.equal(canonical[0].href,expected,page);
  const metas=[...source.matchAll(/<meta\b[^>]*>/g)].map(m=>attrs(m[0]));
  assert.equal(metas.find(a=>a.property==='og:url')?.content,expected,page);
  assert.equal(metas.find(a=>a.property==='og:image')?.content,'https://menu-made.com/assets/social-preview.png',page);
  assert.equal(metas.find(a=>a.name==='twitter:card')?.content,'summary_large_image',page);
 }
});

test('local page links, assets and section targets exist',()=>{
 for(const page of pages){
  for(const m of read(page).matchAll(/<(?:a|img|script|link)\b[^>]*>/g)){
   const a=attrs(m[0]),url=a.href||a.src;
   if(!url||/^(?:https?:|mailto:|tel:|data:|javascript:|\/api\/)/.test(url))continue;
   const [pathname,fragment]=url.split('#');
   let target=decodeURIComponent(pathname.split('?')[0]||page);
   if(target==='/')target='index.html';else target=target.replace(/^\//,'');
   if(!target.includes('.')&&!existsSync(resolve(root,target)))target+='.html';
   assert(existsSync(resolve(root,target)),`${page}: missing ${target}`);
   if(fragment&&target.endsWith('.html'))assert(new RegExp('\\bid=["\\\']'+fragment+'["\\\']').test(read(target)),`${page}: missing ${target}#${fragment}`);
  }
 }
});

test('sitemap contains every public page once and excludes payment utilities',()=>{
 const urls=[...read('sitemap.xml').matchAll(/<loc>(.*?)<\/loc>/g)].map(m=>m[1]);
 const expected=pages.filter(p=>!p.startsWith('checkout')).map(p=>'https://menu-made.com/'+(p==='index.html'?'':p.replace(/\.html$/,''))).sort();
 assert.deepEqual([...urls].sort(),expected);assert.equal(new Set(urls).size,urls.length);
 assert.match(read('robots.txt'),/Sitemap: https:\/\/menu-made\.com\/sitemap\.xml/);
});
