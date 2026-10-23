'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {parseEnv}=require('node:util');
const {configuration,pythonExecutable}=require('../scripts/start-platform');
const {configureEnvironment}=require('../scripts/setup');
const env=()=>({DATABASE_URL:'postgresql://example:example@127.0.0.1:5432/example',AUTH_ENCRYPTION_KEY:'a'.repeat(64),PUBLIC_ORIGIN:'http://localhost:3000'});
function temporary(t){const parent=path.resolve(__dirname,'..','test-results');fs.mkdirSync(parent,{recursive:true});const directory=fs.mkdtempSync(path.join(parent,'dft-configuration-'));t.after(()=>{assert.equal(path.dirname(directory),parent);assert.match(path.basename(directory),/^dft-configuration-/);assert.equal(fs.lstatSync(directory).isSymbolicLink(),false);fs.rmSync(directory,{recursive:true,force:true});});return directory;}

test('DFT launcher requires PostgreSQL and persistent encryption configuration, and gives both children one token',()=>{
  const first=configuration(env());assert.match(first.shared.SERVICE_TOKEN,/^[a-f0-9]{64}$/);assert.equal(first.fraudUrl,'http://127.0.0.1:4011');assert.equal(first.shared.FRAUD_SERVICE_URL,first.fraudUrl);
  const configured=configuration({...env(),SERVICE_TOKEN:'persisted-service-token-123456789'});assert.equal(configured.shared.SERVICE_TOKEN,'persisted-service-token-123456789');
  for(const changes of [{DATABASE_URL:''},{DATABASE_URL:'sqlite:bank.db'},{AUTH_ENCRYPTION_KEY:''},{SERVICE_TOKEN:'short'},{PORT:'4011'},{FRAUD_PORT:'0'},{PUBLIC_ORIGIN:'http://localhost:3000/extra'},{FRAUD_SERVICE_URL:'http://127.0.0.1:4011/extra'},{FRAUD_SERVICE_URL:'http://external.example:4011'}])assert.throws(()=>configuration({...env(),...changes}));
});
test('DFT launcher selects an explicit Python binary or the native virtual environment without a shell',t=>{
  const root=temporary(t);assert.equal(pythonExecutable({PYTHON:'C:/Python With Spaces/python.exe'},root),'C:/Python With Spaces/python.exe');
  const windows=path.join(root,'.venv','Scripts','python.exe'),unix=path.join(root,'.venv','bin','python');fs.mkdirSync(path.dirname(windows),{recursive:true});fs.mkdirSync(path.dirname(unix),{recursive:true});fs.writeFileSync(windows,'fixture');fs.writeFileSync(unix,'fixture');assert.equal(pythonExecutable({},root,'win32'),windows);assert.equal(pythonExecutable({},root,'linux'),unix);
});
test('DFT setup creates persistent secrets once and preserves configured ports, database and comments',t=>{
  const root=temporary(t),filename=path.join(root,'.env'),templatePath=path.join(root,'.env.example');fs.writeFileSync(templatePath,'# Keep this comment\nPORT=3456\nDATABASE_URL=postgresql://example:example@localhost/bank\n');
  const first=configureEnvironment({filename,templatePath});assert.equal(first.created,true);assert.equal(first.databaseConfigured,true);const bytes=fs.readFileSync(filename,'utf8'),values=parseEnv(bytes);assert.equal(values.PORT,'3456');assert.equal(values.PUBLIC_ORIGIN,'http://localhost:3456');assert.match(values.SERVICE_TOKEN,/^[a-f0-9]{64}$/);assert.match(values.AUTH_ENCRYPTION_KEY,/^[a-f0-9]{64}$/);assert.notEqual(values.SERVICE_TOKEN,values.AUTH_ENCRYPTION_KEY);assert.match(bytes,/# Keep this comment/);
  assert.deepEqual(configureEnvironment({filename,templatePath}),{created:false,added:[],databaseConfigured:true});assert.equal(fs.readFileSync(filename,'utf8'),bytes);
});
test('DFT setup refuses to rotate an invalid saved encryption key or authentication token',t=>{
  const root=temporary(t),filename=path.join(root,'.env'),templatePath=path.join(root,'absent');
  for(const content of ['AUTH_ENCRYPTION_KEY=short\n','SERVICE_TOKEN=short\n']){fs.writeFileSync(filename,content);assert.throws(()=>configureEnvironment({filename,templatePath}),/will not rotate saved credentials/);assert.equal(fs.readFileSync(filename,'utf8'),content);}
});
