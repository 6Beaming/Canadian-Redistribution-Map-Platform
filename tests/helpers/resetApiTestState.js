import { setSupabaseTestDoubles } from "../../server/lib/supabase.js";
import { clearAuthProfileCacheForTests } from "../../server/middleware/requireAuth.js";
import { setResourceScopeTestDoubles } from "../../server/lib/authorization/resourceScopeGuard.js";

export function resetApiTestState() {
  setSupabaseTestDoubles(null);
  setResourceScopeTestDoubles(null);
  clearAuthProfileCacheForTests();
}
