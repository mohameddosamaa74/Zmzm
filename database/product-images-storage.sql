-- Apply this once before using Storage-backed product images in the admin page.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'zmzm-product-images',
  'zmzm-product-images',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "zmzm_product_images_public_read" on storage.objects;
create policy "zmzm_product_images_public_read"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'zmzm-product-images');

drop policy if exists "zmzm_product_images_admin_insert" on storage.objects;
create policy "zmzm_product_images_admin_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'zmzm-product-images'
  and (storage.foldername(name))[1] = 'products'
  and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
);

drop policy if exists "zmzm_product_images_admin_update" on storage.objects;
create policy "zmzm_product_images_admin_update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'zmzm-product-images'
  and (storage.foldername(name))[1] = 'products'
  and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
)
with check (
  bucket_id = 'zmzm-product-images'
  and (storage.foldername(name))[1] = 'products'
  and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
);

drop policy if exists "zmzm_product_images_admin_delete" on storage.objects;
create policy "zmzm_product_images_admin_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'zmzm-product-images'
  and (storage.foldername(name))[1] = 'products'
  and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
);
