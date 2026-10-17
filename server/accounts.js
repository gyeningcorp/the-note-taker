import { Router } from 'express';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, createHash, scrypt, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
const scryptAsync=promisify(scrypt);
const filename=process.env.QUOTA_DB_PATH||'/data/note-taker-quota.sqlite';
const encryptionKey=process.env.ACCOUNT_ENCRYPTION_KEY;
if(!/^[0-9a-f]{64}$/i.test(encryptionKey||''))throw Error('ACCOUNT_ENCRYPTION_KEY must be 64 hexadecimal characters, set securely in Railway');
mkdirSync(dirname(filename),{recursive:true});
const database=new DatabaseSync(filename,{timeout:5000});
database.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
database.exec("CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,password_salt TEXT NOT NULL,password_hash TEXT NOT NULL,created_at INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS account_sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires INTEGER NOT NULL,FOREIGN KEY(user_id) REFERENCES accounts(id));CREATE TABLE IF NOT EXISTS account_keys(user_id TEXT NOT NULL,provider TEXT NOT NULL,ciphertext TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(user_id,provider),FOREIGN KEY(user_id) REFERENCES accounts(id));CREATE INDEX IF NOT EXISTS sessions_expiry ON account_sessions(expires);");
const TOKEN_COOKIE='nt_session';
const TTL=30*24*60*60*1000;
const providers=new Set(['anthropic','openai','gemini','transcription']);
const router=Router();
const attempts=new Map();
const tokenHash=raw=>createHash('sha256').update(raw).digest('hex');
const lower=x=>String(x||'').trim().toLowerCase();
const isValidEmail=x=>/^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(x)&&x.length<=254;
const cookie=s=>s.split('; ').reduce((o,v)=>{const i=v.indexOf('=');if(i>0)o[v.slice(0,i)]=v.slice(i+1);return o},{});
function browserSession(req){const token=cookie(req.headers.cookie||'')[TOKEN_COOKIE];if(!token||!(/^[0-9a-f]{64}$/.test(token)))return null;
const row=database.prepare('SELECT a.id,a.email,s.expires FROM account_sessions s JOIN accounts a ON a.id=s.user_id WHERE s.token_hash=?').get(tokenHash(token));
return row&&row.expires>Date.now()?{id:row.id,email:row.email}:null;
}
export function currentAccount(req){return browserSession(req)}
export function savedKey(req,provider){const user=browserSession(req);if(!user||!providers.has(provider))return null;
const row=database.prepare('SELECT ciphertext FROM account_keys WHERE user_id=? AND provider=?').get(user.id,provider);
if(!row)return null;
try{
 const all=Buffer.from(row.ciphertext,'base64');const iv=all.subarray(0,12),tag=all.subarray(12,28),data=all.subarray(28);
 const decipher=createDecipheriv('aes-256-gcm',Buffer.from(encryptionKey,'hex'),iv);decipher.setAuthTag(tag);
 return Buffer.concat([decipher.update(data),decipher.final()]).toString('utf8');
}catch{throw Error('Could not decrypt account key. The encryption key may have changed.')}
}
function encrypt(value){const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',Buffer.from(encryptionKey,'hex'),iv);const data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64')}
const maxAgeSec=Math.floor(TTL/1000);
function issueSession(res,userId){
 const raw=randomBytes(32).toString('hex'),expires=Date.now()+TTL;
 database.prepare('INSERT INTO account_sessions(token_hash,user_id,expires) VALUES (?,?,?)').run(tokenHash(raw),userId,expires);
 res.cookie(TOKEN_COOKIE,raw,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/api',maxAge:TTL});
}
function limit(req,res,next){
 const id=String(req.ip||'unknown'),now=Date.now(),r=attempts.get(id)||{from:now,count:0};
 if(now-r.from>15*60*1000){r.from=now;r.count=0}
 if(++r.count>30)return res.status(429).json({error:'Too many account attempts. Try again in 15 minutes.'});
 attempts.set(id,r);
 if(attempts.size>20000){for(const[k,v]of attempts)if(now-v.from>15*60*1000)attempts.delete(k)}
 next();
}
function security(req,res,next){const origin=req.get('origin');const allowed=new Set(['https://the-note-taker.vercel.app','https://the-note-taker-free.vercel.app','https://the-note-taker-gyeningcorp-4789s-projects.vercel.app','https://the-note-taker-free-gyeningcorp-4789s-projects.vercel.app','http://localhost:5173',...String(process.env.CORS_ORIGIN||'').split(',')]);if(origin&&!allowed.has(origin))return res.status(403).json({error:'Unauthorized request origin.'});next()}
router.use(security);
const fail=(res,message,status=400)=>res.status(status).json({error:message});
async function derive(pass,salt){const b=await scryptAsync(pass,Buffer.from(salt,'hex'),64,{N:16384,r:8,p:1});return b.toString('hex')}
function shape(user){return {id:user.id,email:user.email,loggedIn:true}}
router.post('/register',limit,async(req,res)=>{
 const email=lower(req.body?.email),password=req.body?.password;
 if(!isValidEmail(email))return fail(res,'Enter a valid email address.');
 if(typeof password!=='string'||password.length<12||Buffer.byteLength(password)>1024)return fail(res,'Use a password of at least 12 characters.');
 const existing=database.prepare('SELECT id FROM accounts WHERE email=?').get(email);if(existing)return fail(res,'An account already exists with that email.',409);
 try{
 const salt=randomBytes(16).toString('hex'),hash=await derive(password,salt),id=randomUUID();
 database.prepare('INSERT INTO accounts(id,email,password_salt,password_hash,created_at) VALUES (?,?,?,?,?)').run(id,email,salt,hash,Date.now());
 issueSession(res,id);return res.status(201).json({account:{id,email,loggedIn:true}});
 }catch(error){console.error('Create account error:',error.message);return fail(res,'Unable to create account.',500)}
});
router.post('/login',limit,async(req,res)=>{
 const email=lower(req.body?.email),password=req.body?.password;
 if(!isValidEmail(email)||typeof password!=='string'||password.length>1024)return fail(res,'Invalid email or password.',401);
 try{
 const user=database.prepare('SELECT * FROM accounts WHERE email=?').get(email);
 const salt=user?.password_salt||'00000000000000000000000000000000';
 const pass=await derive(password,salt),expected=Buffer.from(user?.password_hash||'0'.repeat(128),'hex');
 if(!user||!timingSafeEqual(Buffer.from(pass,'hex'),expected))return fail(res,'Invalid email or password.',401);
 issueSession(res,user.id);return res.json({account:shape(user)});
 }catch(error){console.error('Login error:',error.message);return fail(res,'Login unavailable.',500)}
});
router.get('/me',(req,res)=>{
 const account=browserSession(req);if(!account)return res.status(401).json({account:null});
 const keys=database.prepare('SELECT provider FROM account_keys WHERE user_id=?').all(account.id).map(r=>r.provider);
 res.json({account:shape(account),savedProviders:keys});
});
router.post('/logout',(req,res)=>{
 const raw=cookie(req.headers.cookie||'')[TOKEN_COOKIE];
 if(raw&&/^[0-9a-f]{64}$/.test(raw))database.prepare('DELETE FROM account_sessions WHERE token_hash=?').run(tokenHash(raw));
 res.clearCookie(TOKEN_COOKIE,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/api'});
 res.json({ok:true});
});
function mustLogin(req,res,next){const account=browserSession(req);if(!account)return fail(res,'Sign in to manage saved API keys.',401);req.account=account;next()}
router.get('/keys',mustLogin,(req,res)=>{
 const list=database.prepare('SELECT provider,updated_at FROM account_keys WHERE user_id=?').all(req.account.id);
 res.json({providers:Object.fromEntries(list.map(r=>[r.provider,{saved:true,updatedAt:r.updated_at}]))});
});
router.put('/keys/:provider',mustLogin,(req,res)=>{
 const provider=req.params.provider;
 if(!providers.has(provider))return fail(res,'Unsupported API provider.');
 const value=String(req.body?.apiKey||'').trim();
 if(value.length<12||value.length>512||/\s/.test(value))return fail(res,'Enter a valid provider API key.');
 const encrypted=encrypt(value);
 database.prepare('INSERT INTO account_keys (user_id,provider,ciphertext,updated_at) VALUES (?,?,?,?) ON CONFLICT(user_id,provider) DO UPDATE SET ciphertext=excluded.ciphertext,updated_at=excluded.updated_at').run(req.account.id,provider,encrypted,Date.now());
 return res.json({ok:true,provider,saved:true});
});
router.delete('/keys/:provider',mustLogin,(req,res)=>{
 if(!providers.has(req.params.provider))return fail(res,'Unsupported API provider.');
 database.prepare('DELETE FROM account_keys WHERE user_id=? AND provider=?').run(req.account.id,req.params.provider);
 res.json({ok:true,provider:req.params.provider});
});
router.post('/change-password',mustLogin,limit,async(req,res)=>{
 const old=req.body?.currentPassword,newPass=req.body?.newPassword;
 if(typeof old!=='string'||typeof newPass!=='string'||newPass.length<12||Buffer.byteLength(newPass)>1024)return fail(res,'New password must have at least 12 characters.');
 const user=database.prepare('SELECT password_salt,password_hash FROM accounts WHERE id=?').get(req.account.id);
 const actual=await derive(old,user.password_salt);
 if(!timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(user.password_hash,'hex')))return fail(res,'Current password is incorrect.',403);
 const salt=randomBytes(16).toString('hex'),hash=await derive(newPass,salt);
 database.prepare('UPDATE accounts SET password_salt=?,password_hash=? WHERE id=?').run(salt,hash,req.account.id);
 database.prepare('DELETE FROM account_sessions WHERE user_id=?').run(req.account.id);
 issueSession(res,req.account.id);
 res.json({ok:true});
});
export default router;
