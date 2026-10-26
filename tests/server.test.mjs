import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));

async function start(env){
 const proc=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});
 let logs='';proc.stdout.on('data',b=>logs+=b);proc.stderr.on('data',b=>logs+=b);
 const url=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{proc.kill();reject(new Error('Server startup timeout'));},10000);
  const onData=()=>{const m=logs.match(/running at http:\/\/localhost:(\d+)/);if(m){clearTimeout(timer);proc.stdout.off('data',onData);resolve('http://127.0.0.1:'+m[1]);}};
  proc.stdout.on('data',onData);proc.once('exit',code=>{clearTimeout(timer);reject(new Error('Server exited '+code+': '+logs));});
 });return {proc,url};
}
async function stop(proc){if(proc.exitCode!==null)return;await new Promise(resolve=>{proc.once('exit',resolve);proc.kill();});}
test('authenticated demo, fictional seed, protected APIs and traversal boundary',async()=>{
 const temp=await mkdtemp(path.join(os.tmpdir(),'invoice-portfolio-test-'));
 const fixture=path.join(root,'public-review-fixture');
 await mkdir(fixture);await writeFile(path.join(fixture,'marker.txt'),'synthetic traversal fixture');
 let server;
 try{
  server=await start({HOST:'127.0.0.1',PORT:'0',ADMIN_USER:'demo',ADMIN_PASSWORD:'test-only-password',DATABASE_PATH:path.join(temp,'test.sqlite')});
  assert.equal((await fetch(server.url+'/')).status,401);
  assert.equal((await fetch(server.url+'/api/documents')).status,401);
  const headers={authorization:'Basic '+Buffer.from('demo:test-only-password').toString('base64')};
  assert.equal((await fetch(server.url+'/',{headers})).status,200);
  const data=await (await fetch(server.url+'/api/documents',{headers})).json();
  assert.equal(data.documents.length,1);
  const detail=await (await fetch(server.url+'/api/documents/'+data.documents[0].id,{headers})).json();
  assert.equal(detail.document.customer.email,'customer@example.com');
  assert.equal(detail.document.customer.taxId,'');
  assert.equal((await fetch(server.url+'/api/documents/fake.json')).status,401);
  assert.equal((await fetch(server.url+'/%2e%2e%2fpublic-review-fixture/marker.txt')).status,403);
  assert.equal((await fetch(server.url+'/api/documents/'+data.documents[0].id+'?public=1')).status,200);
 }finally{if(server)await stop(server.proc);await rm(temp,{recursive:true,force:true});await rm(fixture,{recursive:true,force:true});}
});
test('rejects nonlocal unauthenticated binding and incomplete credentials',async()=>{
 for(const config of [{HOST:'0.0.0.0',ADMIN_USER:'',ADMIN_PASSWORD:''},{HOST:'127.0.0.1',ADMIN_USER:'demo',ADMIN_PASSWORD:''}]){
  const proc=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,PORT:'0',...config},stdio:'ignore'});
  const code=await new Promise(resolve=>proc.once('exit',resolve));assert.notEqual(code,0);
 }
});
