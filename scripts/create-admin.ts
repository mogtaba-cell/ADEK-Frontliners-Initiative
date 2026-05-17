import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";

config({ path: ".env.local" });

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const adminEmail =
    process.env.ADMIN_EMAIL?.trim().toLowerCase() ||
    "admin@adek-frontliners.local";

  const adminPassword =
    process.env.ADMIN_PASSWORD?.trim() || "ChangeThisPassword123!";

  const adminFullName =
    process.env.ADMIN_FULL_NAME?.trim() || "System Admin";

  if (!supabaseUrl) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL in .env.local");
  }

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY in .env.local");
  }

  if (!adminEmail) {
    throw new Error("Missing ADMIN_EMAIL in .env.local");
  }

  if (!adminPassword) {
    throw new Error("Missing ADMIN_PASSWORD in .env.local");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const passwordHash = await bcrypt.hash(adminPassword, 12);

  const { data, error } = await supabase
    .from("profiles")
    .upsert(
      {
        email: adminEmail,
        username: adminEmail.split("@")[0],
        full_name: adminFullName,
        password_hash: passwordHash,
        role: "admin",
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "email",
      }
    )
    .select("id,email,role")
    .single();

  if (error) {
    throw error;
  }

  console.log("Admin ready:");
  console.log(`Email: ${data.email}`);
  console.log(`Role: ${data.role}`);
}

main().catch((error) => {
  console.error("Failed to create admin user:");
  console.error(error);
  process.exit(1);
});