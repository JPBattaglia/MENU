import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
globalThis.crypto ??= webcrypto;
const api = {
  ...(await import('./src/worker.js')),
  ...(await import('./src/producers/menu-qr/draft-step.js')),
  ...(await import('./src/producers/menu-qr/qr-step.js')),
};
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

test('deployed runner selection and dry-run preview remain read-only after the checkout merge', async () => {
  const reads = [], writes = [];
  const runId = '22222222-2222-4222-8222-222222222222';
  const env = { PRODUCTION_RUNNER_SECRET: 'test-runner-placeholder', DB: { prepare(sql) {
    let args = [];
    return { bind(...values) { args = values; return this; }, async first() {
      reads.push({ sql, args });
      return { workflow_step_id: 'test-step', step_key: 'QUALITY_CHECK', step_status: 'QUEUED', workflow_run_id: runId, workflow_key: 'MENU_QR_V1', workflow_status: 'QUEUED', project_id: 'test-project' };
    }, async run() { writes.push(sql); throw new Error('Dry run must not write'); } };
  } } };
  const response = await api.default.fetch(new Request('https://menu-made.com/api/production/run-next', {
    method: 'POST', headers: { Authorization: 'Bearer test-runner-placeholder' },
    body: JSON.stringify({ workflow_run_id: runId, step_key: 'QUALITY_CHECK', dry_run: true })
  }), env, {});
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.dry_run, true);
  assert.equal(result.processed, false);
  assert.equal(result.selected_step.key, 'QUALITY_CHECK');
  // The trailing pair is the scheduled runner's created-after cutoff; HTTP requests never set it.
  assert.deepEqual(reads[0].args.slice(0, 6), [runId, runId, 'QUALITY_CHECK', 'QUALITY_CHECK', null, null]);
  // Then the owner switches (src/lib/switches.js): nothing paused -> 0 and an empty list.
  assert.deepEqual(reads[0].args.slice(6, 8), [0, '[]']);
  assert.match(reads[0].args[8], /^\d{4}-\d{2}-\d{2}T/);
  assert.match(reads[0].sql, /ws\.step_key NOT IN \('QUALITY_CHECK', 'PACKAGE_DELIVERABLES'\) OR wr\.workflow_key = 'MENU_QR_V1'/);
  assert.equal(writes.length, 0);
});

test('runner selection still requires authorization and rejects invalid selection before querying', async () => {
  const env = { PRODUCTION_RUNNER_SECRET: 'test-runner-placeholder', DB: { prepare() { throw new Error('Must not query'); } } };
  const make = (selection, authorized = true) => new Request('https://menu-made.com/api/production/run-next', {
    method: 'POST', headers: authorized ? { Authorization: 'Bearer test-runner-placeholder' } : {}, body: JSON.stringify(selection)
  });
  assert.equal((await api.default.fetch(make({ dry_run: true }, false), env, {})).status, 401);
  for (const selection of [{ unexpected: true }, { dry_run: 'yes' }, { workflow_run_id: 'invalid' }, { step_key: 'PUBLISH' }, []]) {
    assert.equal((await api.default.fetch(make(selection), env, {})).status, 400);
  }
});
