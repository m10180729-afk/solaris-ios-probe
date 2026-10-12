import {test} from 'node:test';
import assert from 'node:assert/strict';
import {API} from '../shared/api.mjs';
import {authCallbackFailure} from '../shared/authflow.mjs';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

test('linked identity failure explains the conflict without accepting or moving an account',async()=>{
 const records=new Map(),api=new API({url:'https://fixture.supabase.co',key:'sb_publishable_fixture'},{native:true,async call(command,args){if(command==='platform')return{platform:'ios'};if(command==='vaultSet')records.set(args.key,args.value);if(command==='vaultGet')return records.get(args.key);return true;}},{});
 api.session={user:{id:'current'},access_token:'fixture',expires_at:Date.now()/1000+3600};
 const {pending:f}=await api.authFlow.prepare('google-link');let exchanges=0;api.auth=async()=>{exchanges++;};
 await assert.rejects(api.authReturn(f.base+'?solaris_state='+f.state+'&error=oauth_callback_error&error_code=identity_already_exists'),e=>e.code==='identity_already_exists'&&/자동으로 합쳐지지/.test(e.message));
 assert.equal(exchanges,0);assert.equal(api.session.user.id,'current');assert.equal(api.authFlow.pending.state,f.state);
});
test('unknown provider descriptions and error codes are never displayed as credentials',()=>{
 const error=authCallbackFailure('fixture-private-token-or-email');assert.equal(error.code,'oauth_callback_error');assert(!error.message.includes('fixture-private'));
});

const raw=await readFile(new URL('../windows-native/SolarisNativeHost/AuthBrowser.cs',import.meta.url),'utf8');
const script=raw.match(/FragmentRelayScript = """\r?\n([\s\S]*?)\r?\n    """\.Replace/)[1].replace(/^    /gm,'').replace(/\r\n/g,'\n');
for(const [fragment,expected] of [['#error=server_error&error_code=identity_already_exists&error_description=fixture-secret','identity_already_exists'],['#access_token=fixture-secret&refresh_token=fixture-refresh','unsupported_implicit_response'],['#error=server_error&error_code=fixture-secret','oauth_callback_error'],['','callback_code_missing']]){
 test('Windows loopback relays only safe failure: '+expected,()=>{
  const calls=[],location={search:'?solaris_state=fixture-state',hash:fragment,pathname:'/auth/callback',replace:value=>calls.push(value)};
  vm.runInNewContext(script,{URLSearchParams,location,history:{replaceState:(_data,_title,value)=>calls.push(value)}});
  assert.equal(calls.length,2);assert.equal(calls[0],calls[1]);const returned=new URL(calls[1],'http://127.0.0.1:43854');
  assert.equal(returned.searchParams.get('solaris_state'),'fixture-state');assert.equal(returned.searchParams.get('error_code'),expected);
  assert.deepEqual([...returned.searchParams.keys()].sort(),['error','error_code','solaris_state']);assert(!returned.href.includes('fixture-secret'));
 });
}
