const config = window.PHARMACY_CONFIG || {};
const $ = (id) => document.getElementById(id);
const form = $('sendForm'), status = $('status'), submit = $('submitBtn');
const files = [$('photos')];
let widgetId = null;
const configured = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(config.supabaseUrl || '') &&
  !config.supabaseUrl.includes('YOUR_') && config.turnstileSiteKey && !config.turnstileSiteKey.includes('YOUR_');
function show(message, ok = false){status.textContent=message;status.className=ok?'ok':'error'}
function updatePreview(){
  const p = $('preview'); p.replaceChildren();
  for(const f of files){const file=f.files?.[0];if(!file)continue;
    const img=document.createElement('img');const url=URL.createObjectURL(file);img.src=url;img.alt='待傳送處方預覽';
    img.onload=()=>URL.revokeObjectURL(url);img.onerror=()=>URL.revokeObjectURL(url);p.append(img);
  }
}
files[0].addEventListener('change',updatePreview);
$('addPhoto').addEventListener('click',()=>{
  if(files.length>=3)return;
  const wrap=document.createElement('div'), input=document.createElement('input'), label=document.createElement('label');
  input.type='file'; input.accept='image/*'; input.setAttribute('capture','environment');
  input.id=`extraPhoto${files.length}`;label.htmlFor=input.id;label.textContent=`補充照片 ${files.length+1}（選填）`;
  input.addEventListener('change',updatePreview);wrap.append(label,input);$('photoRows').append(wrap);files.push(input);
  if(files.length===3)$('addPhoto').disabled=true;
});
// 將照片重新轉成 JPEG，可減少 EXIF 定位資訊與檔案體積；不傳輸原始照片。
async function convertToJpeg(file){
  if(!file.type.startsWith('image/'))throw Error('僅接受照片檔案');
  if(file.size>18*1024*1024)throw Error('原始照片過大，請選擇 18MB 以下的圖片');
  const bitmap=await createImageBitmap(file).catch(()=>{throw Error('照片格式無法讀取，請改用手機拍照或 JPG/PNG 圖片');});
  const maxEdge=3200, ratio=Math.min(1,maxEdge/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio));
  const context=canvas.getContext('2d',{alpha:false});if(!context)throw Error('照片處理失敗');
  context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.93));
  if(!blob||blob.size>9*1024*1024)throw Error('照片轉換後仍超過 9MB，請換一張');
  return new File([blob],`prescription-${crypto.randomUUID()}.jpg`,{type:'image/jpeg'});
}
function startCaptcha(){
  if(!configured){show('尚未連接安全收件服務。目前為展示版，無法送出真實處方。');return;}
  if(!window.turnstile){setTimeout(startCaptcha,250);return;}
  if(widgetId!==null)return;
  widgetId=window.turnstile.render('#captcha',{sitekey:config.turnstileSiteKey,callback:()=>{submit.disabled=false},'expired-callback':()=>{submit.disabled=true},'error-callback':()=>{submit.disabled=true;show('人機驗證失敗，請重新整理頁面')}});
}
startCaptcha();
form.addEventListener('submit',async e=>{
  e.preventDefault();if(!configured||widgetId===null){show('尚未完成收件系統設定');return;}
  const token=window.turnstile.getResponse(widgetId);if(!token){show('請先完成人機驗證');return;}
  const source=files.map(f=>f.files?.[0]).filter(Boolean);
  if(!source.length){show('請拍攝或選擇至少一張處方照片');return;}
  submit.disabled=true;show('照片上傳中，請勿離開頁面…',true);
  try{
    const body=new FormData();body.append('name',$('customerName').value.trim());body.append('phone',$('phone').value.trim());body.append('memo',$('memo').value.trim());body.append('turnstileToken',token);body.append('consent','yes');
    for(const file of source)body.append('photos',await convertToJpeg(file));
    const response=await fetch(`${config.supabaseUrl}/functions/v1/submit-prescription`,{method:'POST',body,mode:'cors',credentials:'omit'});
    let data;try{data=await response.json()}catch{data={}};
    if(!response.ok||!data.ok)throw Error(data.message||'傳送失敗，請稍後再試');
    form.reset();$('photoRows').replaceChildren();files.splice(1);$('addPhoto').disabled=false;updatePreview();
    show(`已成功送達藥局收件系統！收件編號：${data.receiptId}。請保留編號，並等候藥局確認。`,true);
  }catch(err){show(`未完成傳送：${err?.message||'網路或系統異常'}。如不確定是否已送達，請先向藥局確認，避免重複寄件。`)}
  finally{window.turnstile.reset(widgetId);submit.disabled=true;}
});
