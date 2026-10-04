import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bucketName = "zmzm-product-images";
const applyChanges = process.argv.includes("--apply");

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};

  return Object.fromEntries(
    fs.readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/))
      .filter(Boolean)
      .map(([, name, rawValue]) => {
        const value = rawValue.replace(/^(['"])(.*)\1$/, "$2");
        return [name, value];
      })
  );
}

const env = {
  ...readEnvFile(path.join(root, ".env")),
  ...readEnvFile(path.join(root, ".env.local")),
  ...process.env,
};
const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseKey = applyChanges
  ? env.SUPABASE_SERVICE_ROLE_KEY
  : env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error(applyChanges
    ? "Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local before applying the migration."
    : "Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env before running the dry run.");
  process.exitCode = 1;
} else {
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: products, error: queryError } = await supabase
    .from("products")
    .select("id,image")
    .order("id", { ascending: true });

  if (queryError) {
    console.error("Could not read product image records:", queryError.message);
    process.exitCode = 1;
  } else {
    const imageRows = (products || []).filter((product) =>
      typeof product.image === "string" && product.image.startsWith("data:image/")
    );
    const alreadyMigrated = (products || []).length - imageRows.length;
    const estimatedBytes = imageRows.reduce((total, product) => {
      const base64 = product.image.slice(product.image.indexOf(",") + 1).replace(/\s/g, "");
      return total + Math.floor(base64.length * 3 / 4);
    }, 0);

    console.log(`Products found: ${(products || []).length}`);
    console.log(`Embedded photos to migrate: ${imageRows.length}`);
    console.log(`Already URL-backed or empty: ${alreadyMigrated}`);
    console.log(`Approximate photo bytes to upload: ${estimatedBytes}`);

    if (!applyChanges) {
      console.log("Dry run only. Review the counts, then rerun with --apply to upload and update product image URLs.");
    } else {
      const { data: bucket, error: bucketError } = await supabase.storage.getBucket(bucketName);
      if (bucketError && !/not found|does not exist/i.test(bucketError.message)) {
        console.error("Could not inspect the product image bucket:", bucketError.message);
        process.exitCode = 1;
      } else if (bucket && !bucket.public) {
        console.error(`The existing ${bucketName} bucket is private. Make it public before migrating product photos.`);
        process.exitCode = 1;
      } else if (!bucket) {
        const { error: createError } = await supabase.storage.createBucket(bucketName, {
          public: true,
          fileSizeLimit: 10 * 1024 * 1024,
          allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
        });
        if (createError) {
          console.error("Could not create the public product image bucket:", createError.message);
          process.exitCode = 1;
        }
      }

      if (!process.exitCode) {
        const imagePattern = /^data:(image\/(?:jpeg|png|webp));base64,([\s\S]+)$/i;
        let migrated = 0;

        for (const product of imageRows) {
          const match = product.image.match(imagePattern);
          if (!match) {
            console.error(`Product ${product.id} has an unsupported image data URI; no changes were made to that product.`);
            process.exitCode = 1;
            break;
          }

          const [, contentType, encoded] = match;
          const body = Buffer.from(encoded.replace(/\s/g, ""), "base64");
          const extension = contentType.toLowerCase() === "image/jpeg"
            ? "jpg"
            : contentType.toLowerCase().slice("image/".length);
          const objectPath = `products/${product.id}.${extension}`;
          const storage = supabase.storage.from(bucketName);
          const { error: uploadError } = await storage.upload(objectPath, body, {
            contentType,
            cacheControl: "31536000",
            upsert: true,
          });

          if (uploadError) {
            console.error(`Could not upload the image for product ${product.id}:`, uploadError.message);
            process.exitCode = 1;
            break;
          }

          const { data: publicUrlData } = storage.getPublicUrl(objectPath);
          const { error: updateError } = await supabase
            .from("products")
            .update({ image: publicUrlData.publicUrl })
            .eq("id", product.id);

          if (updateError) {
            console.error(`Uploaded product ${product.id}'s image but could not update its record:`, updateError.message);
            process.exitCode = 1;
            break;
          }

          migrated += 1;
          console.log(`Migrated image ${migrated}/${imageRows.length}.`);
        }

        if (!process.exitCode) {
          console.log(`Migration complete: ${migrated} product photos now use Storage URLs.`);
        }
      }
    }
  }
}
