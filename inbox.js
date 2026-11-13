import {createClient} from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const cfg=window.PHARMACY_CONFIG||{};
const $=id=>document.getElementById(id);
const ready=/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(cfg.supabaseUrl||'') &&
  !cfg.supabaseUrl.includes('YOUR_') && cfg.supabasePublishableKey && !cfg.supabasePublishableKey.includes('YOUR_');
const client=ready?createClient(cfg.supabaseUrl,cfg.supabasePublishableKey,{auth:{persistSession:false,autoRefreshToken:true,detectSessionInUrl:false}}):null;
const activeUrls=new Set();
function revoke(){for(const url of activeUrls)URL.revokeObjectURL(url);activeUrls.clear()}
function message(s,good=false){$('status').textContent=s;$('status').className=good?'ok':'error'}
function show(authorized){$('loginPanel').classList.toggle('hidden',authorized);$('inboxPanel').classList.toggle('hidden',!authorized);if(!authorized){revoke();$('list').replaceChildren()}}
function item(tag,text,className){const el=document.createElement(tag);el.textContent=text;if(className)el.className=className;return el}
async function checkAdmin(){const {data:{user},error}=await client.auth.getUser();if(error||!user)return false;
  const {data,error:adminError}=await client.from('pharmacy_admins').select('user_id').eq('user_id',user.id).maybeSingle();
  return !adminError&&!!data;
}
async function load(){revoke();$('list').replaceChildren();message('');$('count').textContent='正在讀取…';
 const {data,error}=await client.from('prescription_submissions').select('id,created_at,customer_name,phone,memo,photo_paths,status').order('created_at',{ascending:false}).limit(100);
 if(error){message('無法讀取收件匣，請確認登入及權限設定。');$('count').textContent='讀取失敗';return}
 $('count').textContent=`共顯示 ${data.length} 筆（最新 100 筆）`;
 if(!data.length){$('list').append(item('p','目前沒有收件紀錄。','muted'));return}
 for(const record of data){const box=document.createElement('article');box.className='entry';
  const header=document.createElement('div');header.className='row';
  const date=new Date(record.created_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false});
  header.append(item('strong',`${record.customer_name} ｜ ${date}`),item('span',record.status==='done'?'已處理':'待處理',`pill ${record.status==='done'?'done':''}`));box.append(header);
  box.append(item('p',`電話：${record.phone}`));box.append(item('p',`收件編號：${record.id}`,'readonly'));if(record.memo)box.append(item('p',`備註：${record.memo}`));
  const photos=document.createElement('div');photos.className='thumbs';
  const controls=document.createElement('div');controls.className='row';
  const view=item('button','查看照片','secondary small'), mark=item('button',record.status==='done'?'改回待處理':'標記已處理','secondary small'), del=item('button','刪除整筆','danger small');
  view.type=mark.type=del.type='button';controls.append(view,mark,del);box.append(controls,photos);
  view.addEventListener('click',async()=>{
   if(photos.childElementCount){for(const img of photos.querySelectorAll('img')){if(img.src.startsWith('blob:')){URL.revokeObjectURL(img.src);activeUrls.delete(img.src)}}photos.replaceChildren();view.textContent='查看照片';return;}
   view.disabled=true;view.textContent='載入中…';
   try{for(const path of record.photo_paths){const {data:blob,error}=await client.storage.from('pharmacy-prescriptions').download(path);if(error)throw error;
    const url=URL.createObjectURL(blob);activeUrls.add(url);const img=document.createElement('img');img.src=url;img.alt='處方照片（僅授權人員）';photos.append(img);}
    view.textContent='關閉照片';message('');
   }catch{message('照片載入失敗，請確認儲存空間讀取權限。');view.textContent='查看照片';}finally{view.disabled=false}
  });
  mark.addEventListener('click',async()=>{mark.disabled=true;const next=record.status==='done'?'new':'done';const {error}=await client.from('prescription_submissions').update({status:next}).eq('id',record.id);
   if(error)message('更新狀態失敗');else await load();mark.disabled=false;
  });
  del.addEventListener('click',async()=>{
   if(!confirm(`確定永久刪除「${record.customer_name}」的本筆紀錄及全部照片？此動作無法復原。`))return;
   del.disabled=true;
   const {error:storageError}=await client.storage.from('pharmacy-prescriptions').remove(record.photo_paths);
   if(storageError){message('照片刪除失敗：未刪除收件紀錄，請檢查權限。');del.disabled=false;return;}
   const {error}=await client.from('prescription_submissions').delete().eq('id',record.id);
   if(error){message('照片已刪除，但資料紀錄刪除失敗；請聯絡管理員清理。');del.disabled=false;return;}
   await load();message('資料已刪除。',true);
  });
  $('list').append(box);
 }
}
$('loginForm').addEventListener('submit',async e=>{
 e.preventDefault();if(!client){message('尚未設定 Supabase；目前無法登入。');return}
 $('loginBtn').disabled=true;message('正在登入…',true);
 const {error}=await client.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});
 if(error){message('登入失敗，請確認帳號密碼。');$('loginBtn').disabled=false;return}
 if(!await checkAdmin()){await client.auth.signOut();message('帳號未取得藥局收件權限。');$('loginBtn').disabled=false;return}
 $('password').value='';show(true);await load();$('loginBtn').disabled=false;
});
$('refreshBtn').addEventListener('click',load);
$('logoutBtn').addEventListener('click',async()=>{await client.auth.signOut();show(false);message('已登出。',true)});
if(!ready)message('展示版本：尚未設定安全雲端收件服務。');
window.addEventListener('pagehide',revoke);
