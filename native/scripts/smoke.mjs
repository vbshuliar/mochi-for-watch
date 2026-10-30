#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const folder=await mkdtemp(tmpdir()+'/muse-native-smoke-');
const token='native-fixture-token-not-a-real-secret-0000';
const origin='http://127.0.0.1:18788';
const server=spawn(process.execPath,['dist/server.js'],{cwd:root+'backend',env:{...process.env,HOST:'127.0.0.1',PORT:'18788',APP_MODE:'mock',API_TOKEN:token,ENCRYPTION_KEY:'0'.repeat(64),DATABASE_PATH:folder+'/test.sqlite'},stdio:['ignore','ignore','pipe']});
let bootError='';server.stderr.on('data',chunk=>{bootError+=chunk.toString();});
let ready=false;
try {
 for(let i=0;i<100;i++){
  if(server.exitCode!==null)throw new Error('Fixture backend did not start: '+bootError);
  try {const r=await fetch(origin+'/v1/status',{headers:{Authorization:'Bearer '+token}});if(r.ok&&(await r.json()).mode==='mock'){ready=true;break;}}catch{}
  await new Promise(r=>setTimeout(r,100));
 }
 if(!ready)throw new Error('Fixture backend timed out.');
 const child=spawn('/usr/bin/xcrun',['swift','run','--package-path',root+'native','MochiSmoke'],{env:{...process.env,DEVELOPER_DIR:process.env.DEVELOPER_DIR||'/Applications/Xcode.app/Contents/Developer',MOCHI_SMOKE_ORIGIN:origin,MOCHI_SMOKE_TOKEN:token},stdio:'inherit'});
 const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});
 if(code!==0)throw new Error('Native smoke check failed.');
} finally {
 if(server.exitCode===null){server.kill('SIGTERM');await new Promise(resolve=>server.once('exit',resolve));}
 await rm(folder,{recursive:true,force:true});
}
