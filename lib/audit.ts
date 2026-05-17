import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
export async function audit(input:{actorId?:string|null; action:string; entityType:string; entityId?:string|null; before?:unknown; after?:unknown; metadata?:unknown}) {
  await supabaseAdmin.from("audit_logs").insert({ actor_id: input.actorId ?? null, action: input.action, entity_type: input.entityType, entity_id: input.entityId ?? null, before_data: input.before ?? null, after_data: input.after ?? null, metadata: input.metadata ?? null });
}
