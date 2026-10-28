import test from 'node:test';
import assert from 'node:assert/strict';
import {setupServices,providerSignInURL} from './services.mjs';

test('OAuth destinations use exact provider hosts and HTTPS',()=>{
 for(const [provider,host] of Object.entries({gmail:'accounts.google.com',notion:'api.notion.com',instagram:'www.facebook.com',facebook:'www.facebook.com'})){
  assert.equal(providerSignInURL(provider,`https://${host}/authorize`),`https://${host}/authorize`);
  for(const url of [`http://${host}/`, `https://${host}.evil.test/`, `https://attacker@${host}/`, `https://${host}:444/`, 'https://example.com/'])assert.throws(()=>providerSignInURL(provider,url));
 }
 assert.throws(()=>providerSignInURL('gmail','https://www.facebook.com/'));
});

function fixture(){
 class Element{
  constructor(){this.children=[];this.dataset={};this.classList={add(){},toggle(){}};this.hidden=false;this.disabled=false;this.textContent='';this.value='';}
  append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);}}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}
  setAttribute(key,value){this[key]=value;}
  closest(){return this.row||this.parent?.closest();}
  querySelector(){return new Element();}
  focus(){}
 }
 const nodes=new Map(),buttons=['calendar','gmail','notion','instagram','facebook','search'].map(key=>{const button=new Element();button.dataset.service=key;button.row=new Element();button.row.row=button.row;button.row.append(button);return button;});
 globalThis.document={createElement:()=>new Element(),querySelector(selector){if(selector.startsWith('[data-service='))return buttons.find(button=>selector.includes(`"${button.dataset.service}"`));if(!nodes.has(selector))nodes.set(selector,new Element());return nodes.get(selector);},querySelectorAll:()=>buttons};
 const events={};globalThis.window={addEventListener:(name,fn)=>events[name]=fn,open:()=>({location:{},close(){}})};
 const flush=()=>new Promise(resolve=>setImmediate(resolve));
 return {nodes,buttons,events,flush,controls:()=>nodes.get('#service-detail').children[0]};
}

test('social account selection works before connected and no fake social toggles appear',async()=>{
 const f=fixture(),calls=[];let view;
 view=setupServices(()=>{}, {api:async(path,options)=>{calls.push([path,options]);return {accounts:[{id:'ig-1',name:'My business'}]};},refresh:async()=>view.update('disconnected','live',true,true,{instagram:'connected',socialAccounts:{instagram:{id:'ig-1',name:'My business'}}})});
 view.update('disconnected','live',true,true,{instagram:'disconnected'});
 for(const button of f.buttons)assert.equal(button.row.children.length,button.dataset.service==='calendar'?2:1);
 f.buttons.find(b=>b.dataset.service==='instagram').onclick();await f.flush();
 const controls=f.controls(),choices=controls.children[5];
 assert.equal(choices.children[0].textContent,'My business');
 choices.children[0].onclick();await f.flush();
 assert.ok(calls.some(([path,options])=>path.endsWith('/instagram/account')&&options.body.id==='ig-1'));
 assert.equal(f.nodes.get('#service-status').textContent,'connected');
 assert.equal(controls.children[2].textContent,'Selected account: My business');
});

test('navigation preserves busy state and keeps request errors with their provider',async()=>{
 const f=fixture();let fail;
 const view=setupServices(()=>{}, {api:()=>new Promise((_,reject)=>{fail=reject;}),refresh:async()=>{}});
 f.buttons.find(b=>b.dataset.service==='instagram').onclick();
 f.buttons.find(b=>b.dataset.service==='gmail').onclick();
 assert.equal(f.controls().children[0].disabled,true);
 fail(Error('Instagram access was denied'));await f.flush();
 assert.equal(f.controls().children[0].disabled,false);
 assert.equal(f.controls().children[6].textContent,'');
 view.setBusy(true);assert.equal(f.controls().children[0].disabled,true);
 view.setBusy(false);assert.equal(f.controls().children[0].disabled,false);
});
