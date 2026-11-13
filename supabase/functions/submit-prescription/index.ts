// 顧客免登入 Edge Function；所有資料寫入權限僅在本函式執行環境。
// 先用 Cloudflare Turnstile 驗證，再用 Supabase service_role 寫入私人儲存與資料表。
import { createClient } from 'npm:@supabase/supabase-js@2';

const SITE_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') || '';
const SITE_HOSTNAME = Deno.env.get('ALLOWED_HOSTNAME') || '';
const CAPTCHA_SECRET = Deno.env.get('TURNSTILE_SECRET') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const BUCKET = 'pharmacy-prescriptions';
const MAX_PHOTO_BYTES = 9 * 1024 * 1024;
const MAX_REQUEST_BYTES = 28 * 1024 * 1024;

function response(code: number, obj: Record<string,unknown>, origin: string): Response {
  return new Response(JSON.stringify(obj), {status:code,headers:{'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store', 'Access-Control-Allow-Origin':origin,'Vary':'Origin',
    'Access-Control-Allow-Methods':'POST, OPTIONS', 'Access-Control-Allow-Headers':'content-type'}});
}
function jpegSignature(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}
async function verifyCaptcha(token: string): Promise<boolean> {
  const body = new URLSearchParams({secret:CAPTCHA_SECRET,response:token});
  const controller = new AbortController();
  const stop = setTimeout(()=>controller.abort(),8000);
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method:'POST',body,signal:controller.signal});
    if (!r.ok) return false;
    const data = await r.json();
    return data.success === true && data.hostname === SITE_HOSTNAME;
  } catch {return false;} finally {clearTimeout(stop);}
}
Deno.serve(async (req: Request): Promise<Response> => {
  const requestOrigin = req.headers.get('Origin') || '';
  const allowedOrigin = requestOrigin === SITE_ORIGIN ? SITE_ORIGIN : SITE_ORIGIN;
  if (req.method === 'OPTIONS') {
    if (requestOrigin !== SITE_ORIGIN || !SITE_ORIGIN) return response(403,{ok:false,message:'不允許此來源'},'null');
    return response(200,{ok:true},SITE_ORIGIN);
  }
  if (req.method !== 'POST') return response(405,{ok:false,message:'不支援此方法'}, allowedOrigin);
  if(!SITE_ORIGIN || !SITE_HOSTNAME || !CAPTCHA_SECRET || !SUPABASE_URL || !SERVICE_ROLE) {
    return response(503,{ok:false,message:'收件服務尚未完成安全設定'},allowedOrigin);
  }
  // 此檢查只是額外防線，後端安全核心仍是 Turnstile 的伺服器驗證。
  if(requestOrigin !== SITE_ORIGIN) return response(403,{ok:false,message:'不允許此來源'},'null');
  const contentLength = Number(req.headers.get('content-length') || '0');
  if(contentLength > MAX_REQUEST_BYTES) return response(413,{ok:false,message:'檔案總大小超出上限'},allowedOrigin);
  // 逐塊限制整體請求大小，避免用戶端省略 Content-Length 造成無限制緩衝。
  let body: FormData;
  try {
    if (!req.body) throw Error('缺少請求內容');
    const reader = req.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_REQUEST_BYTES) {
        await reader.cancel();
        return response(413,{ok:false,message:'檔案總大小超出上限'},allowedOrigin);
      }
      chunks.push(value);
    }
    const contentType = req.headers.get('content-type') || '';
    if (!contentType.startsWith('multipart/form-data')) throw Error('不支援的格式');
    const boundedRequest = new Request('https://internal.invalid/upload', {
      method:'POST',headers:{'content-type':contentType},body:new Blob(chunks)
    });
    body = await boundedRequest.formData();
  } catch {return response(400,{ok:false,message:'無法讀取表單'},allowedOrigin);}
  const name = String(body.get('name')||'').trim();
  const phone = String(body.get('phone')||'').trim();
  const memo = String(body.get('memo')||'').trim();
  const token = String(body.get('turnstileToken')||'');
  const consent = String(body.get('consent')||'') === 'yes';
  const files = body.getAll('photos').filter((f): f is File => f instanceof File);
  if(!consent || name.length < 2 || name.length > 50 || !/^[0-9+()\-\s]{8,25}$/.test(phone) || memo.length > 300)
    return response(400,{ok:false,message:'聯絡資料格式不正確'},allowedOrigin);
  if(files.length < 1 || files.length > 3 || files.some(f=>f.size < 100 || f.size > MAX_PHOTO_BYTES || f.type !== 'image/jpeg'))
    return response(400,{ok:false,message:'請上傳 1–3 張 JPEG 照片，每張不超過 9MB'},allowedOrigin);
  if(files.reduce((n,f)=>n+f.size,0)>26*1024*1024)
    return response(413,{ok:false,message:'照片總大小超過限制'},allowedOrigin);
  if(!token || token.length > 2048 || !await verifyCaptcha(token))
    return response(403,{ok:false,message:'人機驗證失敗或已逾時，請重新驗證'},allowedOrigin);
  const client = createClient(SUPABASE_URL,SERVICE_ROLE,{auth:{persistSession:false,autoRefreshToken:false}});
  const paths: string[] = [];
  try {
    for(const file of files){
      const head = new Uint8Array(await file.slice(0,4).arrayBuffer());
      if(!jpegSignature(head)) throw Error('照片格式不符合 JPEG');
      const today = new Date().toISOString().slice(0,10);
      const path = `${today}/${crypto.randomUUID()}.jpg`;
      const {error}=await client.storage.from(BUCKET).upload(path,file,{contentType:'image/jpeg',upsert:false,cacheControl:'0'});
      if(error)throw Error('私人照片儲存失敗');
      paths.push(path);
    }
    const {data,error}=await client.from('prescription_submissions').insert({customer_name:name,phone,memo,photo_paths:paths,status:'new'}).select('id').single();
    if(error || !data) throw Error('收件紀錄建立失敗');
    return response(200,{ok:true,receiptId:data.id},allowedOrigin);
  }catch(e){
    if(paths.length) await client.storage.from(BUCKET).remove(paths);
    // 不輸出原始例外或病患資料到服務日誌。
    return response(500,{ok:false,message:'系統未能完成收件，請向藥局確認'},allowedOrigin);
  }
});
