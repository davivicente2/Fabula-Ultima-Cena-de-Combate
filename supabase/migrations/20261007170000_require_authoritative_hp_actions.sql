-- Complete the authoritative HP rollout.
-- After the authoritative frontend is verified online, browsers may no longer
-- write the HP column directly. The SECURITY DEFINER RPC remains responsible
-- for validating and applying HP changes.

revoke update (hp) on table public.combatants from authenticated;
