import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { installTool } from '../scripts/native-tool.mjs';
test('dedicated NPM deploy tool has ONE exact official Wrangler and every transitive integrity',async()=>{
 const root=new URL('../tools/native-publisher/',import.meta.url);
 const pkg=JSON.parse(await readFile(new URL('package.json',root))),lock=JSON.parse(await readFile(new URL('package-lock.json',root)));
 assert.deepEqual(pkg.dependencies,{wrangler:'4.114.0'});assert.deepEqual(lock.packages[''].dependencies,pkg.dependencies);
 assert.equal(lock.packages['node_modules/wrangler'].version,'4.114.0');
 for(const [name,item] of Object.entries(lock.packages))if(name){assert.match(item.integrity,/^sha512-/);assert(item.resolved.startsWith('https://registry.npmjs.org/'));assert(!name.includes('@mdbase-dev'));}
});
test('tool-only frozen ci ignores scripts; fresh TEMP outside app and DISTINCT empty npm configs',async t=>{
 const parent=await mkdtemp(join(tmpdir(),'journal-tool-fixture-'));t.after(()=>rm(parent,{recursive:true,force:true}));
 let seen;
 const path=await installTool(parent,{run:(command,args,options)=>{
  seen={command,args,options};assert.equal(command,'npm');assert(args.includes('ci'));assert(args.includes('--ignore-scripts'));assert(args.includes('--workspaces=false'));
  assert(options.cwd.startsWith(parent+'/journal-tool-'));
  assert.deepEqual(Object.keys(options.env).sort(),['HOME','NPM_CONFIG_CACHE','NPM_CONFIG_UPDATE_NOTIFIER','PATH','TMPDIR'].sort());
  const dir=join(options.cwd,'node_modules/wrangler');mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'package.json'),'{"version":"4.114.0"}');
 }});
 const {args}=seen,user=args[args.indexOf('--userconfig')+1],global=args[args.indexOf('--globalconfig')+1];
 assert.notEqual(user,global);assert.equal(await readFile(user,'utf8'),'');assert.equal(await readFile(global,'utf8'),'');
 assert(path.endsWith('/node_modules/wrangler/bin/wrangler.js'));
});
