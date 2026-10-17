import {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';

const databasePath=process.env.QUOTA_DB_PATH||'/data/note-taker-quota.sqlite';
if(!process.env.QUOTA_HASH_SECRET||process.env.QUOTA_HASH_SECRET.length<32){
 throw new Error('QUOTA_HASH_SECRET must be configured (at least 32 characters) before enabling public usage.');
}
mkdirSync(dirname(databasePath),{recursive:true});
const db=new DatabaseSync(databasePath,{timeout:5000});
db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
db.exec("CREATE TABLE IF NOT EXISTS note_uses (id TEXT PRIMARY KEY, day TEXT NOT NULL, device TEXT NOT NULL, ip TEXT NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS quota_device_day ON note_uses(device,day); CREATE INDEX IF NOT EXISTS quota_ip_day ON note_uses(ip,day);");
const day=()=>new Date().toISOString().slice(0,10);
const hash=v=>createHash('sha256').update(process.env.QUOTA_HASH_SECRET+'|'+v).digest('hex');
const deviceId=req=>String(req.get('X-Device-ID')||'').trim();
function identity(req){
 const raw=deviceId(req);
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw))return null;
 return {device:hash('device:'+raw),ip:hash('ip:'+String(req.ip||req.socket.remoteAddress||'')),day:day()};
}
function count(device,date){return db.prepare('SELECT COUNT(*) n FROM note_uses WHERE device=? AND day=?').get(device,date).n;}
export function usage(req){
 const i=identity(req);if(!i)return {error:'A device ID is required. Refresh the website to initialize it.',code:400};
 const used=count(i.device,i.day);
 return{date:i.day,used,limit:2,remaining:Math.max(0,2-used),maxMinutes:5,plan:'free'};
}
export function reserve(req){
 const i=identity(req);if(!i)return {error:'Device identification is required. Reload the app.',code:400};
 db.exec('BEGIN IMMEDIATE');
 try{
  const used=count(i.device,i.day);
  const sameIp=db.prepare('SELECT COUNT(*) n FROM note_uses WHERE ip=? AND day=?').get(i.ip,i.day).n;
  if(used>=2||sameIp>=10){db.exec('ROLLBACK');return{error:used>=2?'Daily free limit reached (2 notes). Use your own AI API key or choose a paid plan.':'Shared network daily allowance reached. Try again tomorrow or use your own key.',code:429,remaining:Math.max(0,2-used)}}
  const id=randomUUID();
  db.prepare('INSERT INTO note_uses (id,day,device,ip,state,created) VALUES (?,?,?,?,?,?)').run(id,i.day,i.device,i.ip,'reserved',Date.now());
  db.exec('COMMIT');
  return{id,remaining:1-used};
 }catch(e){db.exec('ROLLBACK');throw e}
}
export function draft(req,id){
 const i=identity(req);if(!i||typeof id!=='string'||!(/^[0-9a-f-]{36}$/i.test(id)))return null;
 const row=db.prepare('SELECT * FROM note_uses WHERE id=? AND device=? AND day=?').get(id,i.device,i.day);
 if(!row||row.state==='complete'||row.state==='reserved'&&Date.now()-row.created>3600000)return null;
 return row;
}
export function markTranscribed(id){db.prepare("UPDATE note_uses SET state='transcribed' WHERE id=? AND state='reserved'").run(id)}
export function startOutline(id){
 db.exec('BEGIN IMMEDIATE');
 try{
  const row=db.prepare('SELECT state,attempts FROM note_uses WHERE id=?').get(id);
  if(!row||row.state==='complete'||row.attempts>=3){db.exec('ROLLBACK');return false}
  const result=db.prepare("UPDATE note_uses SET attempts=attempts+1 WHERE id=? AND state IN ('reserved','transcribed') AND attempts<3").run(id);
  db.exec('COMMIT');return result.changes===1;
 }catch(e){db.exec('ROLLBACK');throw e}
}
export function complete(id){db.prepare("UPDATE note_uses SET state='complete' WHERE id=?").run(id)}
export function release(id){db.prepare("DELETE FROM note_uses WHERE id=? AND state='reserved'").run(id)}
