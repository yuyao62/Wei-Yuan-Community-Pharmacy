-- 維元社區藥局：首次設定請在 Supabase SQL Editor 執行。
-- 重要：此 SQL 不會自動建立店員帳密。先在 Auth 中建立店員，再由管理員手動授權其 user_id。
-- 請先建立全新 Supabase 專案，避免與其他應用的政策相互干擾。
create extension if not exists pgcrypto;

create table if not exists public.pharmacy_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.pharmacy_admins enable row level security;
revoke all on public.pharmacy_admins from anon, authenticated;
grant select on public.pharmacy_admins to authenticated;
drop policy if exists "pharmacy admin self lookup" on public.pharmacy_admins;
create policy "pharmacy admin self lookup" on public.pharmacy_admins for select to authenticated
  using (user_id = (select auth.uid()));

create table if not exists public.prescription_submissions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  customer_name text not null check (char_length(customer_name) between 2 and 50),
  phone text not null check (char_length(phone) between 8 and 25),
  memo text not null default '' check (char_length(memo) <= 300),
  photo_paths text[] not null check (array_length(photo_paths, 1) between 1 and 3),
  status text not null default 'new' check (status in ('new','done'))
);
create index if not exists prescription_submissions_created_at_idx on public.prescription_submissions(created_at desc);
alter table public.prescription_submissions enable row level security;
revoke all on public.prescription_submissions from anon, authenticated;
grant select,update,delete on public.prescription_submissions to authenticated;
drop policy if exists "pharmacy admins only select" on public.prescription_submissions;
drop policy if exists "pharmacy admins only update" on public.prescription_submissions;
drop policy if exists "pharmacy admins only delete" on public.prescription_submissions;
create policy "pharmacy admins only select" on public.prescription_submissions for select to authenticated
  using (exists(select 1 from public.pharmacy_admins where user_id=(select auth.uid())));
create policy "pharmacy admins only update" on public.prescription_submissions for update to authenticated
  using (exists(select 1 from public.pharmacy_admins where user_id=(select auth.uid())))
  with check (exists(select 1 from public.pharmacy_admins where user_id=(select auth.uid())));
create policy "pharmacy admins only delete" on public.prescription_submissions for delete to authenticated
  using (exists(select 1 from public.pharmacy_admins where user_id=(select auth.uid())));

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('pharmacy-prescriptions','pharmacy-prescriptions',false,9437184,array['image/jpeg'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

-- 不設任何匿名上傳／讀取政策：顧客只經由有 CAPTCHA 驗證的 Edge Function 上傳。
-- Edge Function 使用僅存於後端的管理憑證寫入，瀏覽器端永遠沒有該憑證。
drop policy if exists "pharmacy admins download" on storage.objects;
drop policy if exists "pharmacy admins delete photos" on storage.objects;
create policy "pharmacy admins download" on storage.objects for select to authenticated
  using (bucket_id='pharmacy-prescriptions' and exists(select 1 from public.pharmacy_admins where user_id=(select auth.uid())));
create policy "pharmacy admins delete photos" on storage.objects for delete to authenticated
  using (bucket_id='pharmacy-prescriptions' and exists(select 1 from public.pharmacy_admins where user_id=(select auth.uid())));

-- 完成帳號建立後，填入 Auth > Users 的「User UID」執行以下 SQL（先移除行首 --）：
-- insert into public.pharmacy_admins(user_id) values ('請填入真實的-user-uuid');
