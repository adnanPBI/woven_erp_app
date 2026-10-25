'use strict';
const assert=require('assert/strict'),{assertNoUnreviewedTriggers}=require('../lib/sync_write_safety');
const database='weavonpq_weaving_main';
function ctx(grants,triggers=[]){let reads=0;return {sync:{},contract:{profiles:[{tables:[{name:'parent'},{name:'detail'}]}]},pool:{async query(sql){if(sql==='SELECT DATABASE() db')return [[{db:database}]];if(sql==='SHOW GRANTS')return [grants.map(s=>({grant:s}))];if(sql.includes('information_schema.TRIGGERS')){reads++;return [triggers];}throw Error('Unexpected query');}},get triggerReads(){return reads;}};}
(async()=>{
 const escaped=ctx(['GRANT USAGE ON *.* TO fixture','GRANT ALL PRIVILEGES ON `weavonpq\\_weaving\\_main`.* TO fixture']);await assertNoUnreviewedTriggers(escaped);assert.equal(escaped.triggerReads,1);
 await assertNoUnreviewedTriggers(ctx(['GRANT TRIGGER ON `weavonpq\\_weaving\\_main`.`parent` TO fixture','GRANT TRIGGER ON `weavonpq\\_weaving\\_main`.`detail` TO fixture']));
 await assert.rejects(()=>assertNoUnreviewedTriggers(ctx(['GRANT ALL PRIVILEGES ON `weavonpq\\_weaving\\_main`.* TO fixture'],[{name:'unknown_trigger',target:'parent'}])),e=>e.code==='SYNC_TRIGGER_REVIEW_REQUIRED');
 for(const grant of ['GRANT SELECT ON `weavonpq\\_weaving\\_main`.* TO fixture','GRANT ALL PRIVILEGES ON `weavonpqXweavingXmain`.* TO fixture','GRANT ALL PRIVILEGES ON `weavonpq%`.* TO fixture','GRANT TRIGGER ON `weavonpq\\_weaving\\_main`.`parent` TO fixture'])await assert.rejects(()=>assertNoUnreviewedTriggers(ctx([grant])),e=>e.code==='SYNC_TRIGGER_VISIBILITY');
 console.log('PASS: escaped database grant literals, complete table visibility, stale scopes, missing grants and actual trigger refusal');
})().catch(e=>{console.error(e.stack);process.exitCode=1});
