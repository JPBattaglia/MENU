import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
globalThis.crypto ??= webcrypto;
const source = await readFile(new URL('./menu-checkout-with-booking.mjs', import.meta.url), 'utf8');
const api = await import('data:text/javascript;base64,' + Buffer.from(source + '\nexport {runGenerateMenuDraftStep,runGenerateQrStep};').toString('base64'));
function fixture({failDeliverable=false,pdf=false}={}) {
  const writes=[], objects=new Map(), existing=new Map();
  const inputs={business_name:{value:'Proof Cafe'},menu_source:{value:'https://example.com/menu'},qr_destination:{value:'https://example.com/published-menu'}};
  const project={id:'proof-project',order_id:'proof-order',customer_id:'proof-customer',business_id:'proof-business',business_name:'Proof Cafe'};
  const DB={prepare(sql){let args=[];return {bind(...v){args=v;return this},async first(){
    if(sql.includes('output_json')) return {output_json:JSON.stringify({inputs})};
    if(sql.includes('FROM projects p')) return project;
    if(sql.includes('FROM deliverables d')) return existing.get(sql.includes("'MENU_DRAFT'")?'MENU_DRAFT':'QR_CODE')||null;
    throw new Error('Unexpected query: '+sql);
  },async run(){writes.push({sql,args});if(failDeliverable && sql.includes('INSERT INTO deliverables'))throw new Error('Simulated database failure');return {meta:{changes:1}}}}}};
  return {env:{DB,ASSETS:{async put(key,bytes){objects.set(key,bytes)},async delete(key){objects.delete(key)}}},writes,objects,existing,pdf};
}
const step={project_id:'proof-project',workflow_run_id:'proof-run',workflow_step_id:'proof-step',workflow_key:'MENU_QR',workflow_version:1};
test('draft and QR persist assets while retaining private draft status',async()=>{
  const f=fixture(), original=globalThis.fetch;
  globalThis.fetch=async()=>new Response('Soup $12\nSalad $9\n<script>unsafe</script>',{headers:{'content-type':'text/plain'}});
  try {
    const draft=await api.runGenerateMenuDraftStep({...step,step_key:'GENERATE_MENU_DRAFT'},f.env);
    const qr=await api.runGenerateQrStep({...step,step_key:'GENERATE_QR'},f.env);
    const html=new TextDecoder().decode(f.objects.get(draft.asset.storage_key));
    assert(html.includes('Soup $12\nSalad $9'));assert(!html.includes('<script>unsafe</script>'));
    assert(new TextDecoder().decode(f.objects.get(qr.asset.storage_key)).includes('<svg'));
    assert.equal(qr.destination_url,'https://example.com/published-menu');
    for(const output of [draft,qr]){assert.equal(output.deliverable.status,'DRAFT');assert.equal(output.deliverable.customer_visible,false);assert.match(output.asset.checksum,/^[a-f0-9]{64}$/)}
    assert.equal(f.objects.size,2);
  } finally {globalThis.fetch=original}
});
test('QR retry reuses persisted deliverable without writing another object',async()=>{
  const f=fixture();f.existing.set('QR_CODE',{deliverable_id:'existing',asset_id:'asset',version:1,storage_key:'existing.svg',mime_type:'image/svg+xml',size_bytes:100,checksum:'saved'});
  const result=await api.runGenerateQrStep({...step,step_key:'GENERATE_QR'},f.env);
  assert.equal(result.reused_existing,true);assert.equal(f.objects.size,0);
  assert(!f.writes.some(w=>w.sql.includes('INSERT INTO deliverables')));
});
test('failed deliverable insertion cleans up newly written asset and database asset row',async()=>{
  const f=fixture({failDeliverable:true});
  await assert.rejects(api.runGenerateQrStep({...step,step_key:'GENERATE_QR'},f.env),/Simulated database failure/);
  assert.equal(f.objects.size,0);assert(f.writes.some(w=>w.sql.includes('DELETE FROM assets')));
  assert(!f.writes.some(w=>w.sql.includes("status = 'SUCCEEDED'")));
});
test('PDF input is blocked without claiming successful generation',async()=>{
  const f=fixture(),original=globalThis.fetch;globalThis.fetch=async()=>new Response('PDF',{headers:{'content-type':'application/pdf'}});
  try{await assert.rejects(api.runGenerateMenuDraftStep({...step,step_key:'GENERATE_MENU_DRAFT'},f.env),/requires document extraction/);assert.equal(f.objects.size,0);assert.equal(f.writes.length,0)}finally{globalThis.fetch=original}
});
