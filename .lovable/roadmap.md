# VineTrack Portal — Roadmap / Action List

Items captured but **not yet implemented**. Each entry notes scope, guardrails, and what schema/RPC support is needed before build.

---

## 1. Invited User Account Creation

**Status:** Not started — captured for future planning.

**Goal:** Allow a person who has been invited to a vineyard/team to create their portal account from an invite link, without enabling open public signup.

### Hard requirements (must not be violated)
- Signup MUST NOT become open / public — only valid invitations can create accounts.
- Invitation determines the target `vineyard_id` and starting `role`.
- Portal access remains restricted to Owner/Manager unless we explicitly broaden it.
- Must not create a duplicate auth user if the invitee already has an iOS account — link to the existing user instead.
- Do not weaken or bypass RLS.
- Do not expose `auth.users` directly to the browser.
- Do not use service-role keys in the browser; all privileged work goes through SECURITY DEFINER RPCs or Edge Functions.

### Intended flow
1. Owner/Manager invites a user by email + role from the Team page.
2. Invite record created with `vineyard_id`, `email`, `role`, `expires_at`, `status`, `token`.
3. Invitee opens portal invite link `/invite/:token`.
4. If they already have an account → sign in, then auto-accept invite.
5. If not → create account from invite flow only (token gates signup).
6. After auth, invite is accepted and a `vineyard_members` row is created with the invited role.
7. Expired / used / revoked invites cannot be used.

### Schema support needed (Rork/Supabase migration — NOT done in portal)
- `vineyard_invitations` table:
  - `id uuid pk`
  - `vineyard_id uuid` (FK)
  - `email citext not null`
  - `role` (matches existing role enum: owner / manager / supervisor / operator)
  - `token text unique not null` (random, single-use)
  - `status` enum: `pending | accepted | revoked | expired`
  - `invited_by uuid` (FK auth.users)
  - `expires_at timestamptz not null` (default now() + 7 days)
  - `accepted_at timestamptz null`, `accepted_by uuid null`
  - `created_at`, `updated_at`
- RLS: Only Owner/Manager of the target vineyard can `select`/`insert`/`update` (revoke). Invitee reads via RPC by token, never directly.
- Indexes on `(token)`, `(vineyard_id, status)`, `(email, status)`.

### RPC support needed (SECURITY DEFINER, server-side only)
- `create_vineyard_invitation(p_vineyard_id, p_email, p_role)` — Owner/Manager only; checks caller role; returns invite id + token.
- `revoke_vineyard_invitation(p_invitation_id)` — Owner/Manager only.
- `get_invitation_by_token(p_token)` — Public; returns minimal fields (vineyard name, role, status, expired flag) — never email or invited_by.
- `accept_invitation(p_token)` — Authenticated; validates token + status + expiry, matches `auth.email()` to invitation email (case-insensitive), inserts into `vineyard_members` if not already present, marks invite `accepted`.
- Optional: trigger or cron to flip `pending` → `expired` past `expires_at`.

### Email delivery
- Use the Lovable transactional email path to send the invite link.
- Template: vineyard name, inviter name, role, accept button → `${siteUrl}/invite/${token}`, expiry note.

### Portal UI to build (later, once schema + RPCs exist)
- Team page: "Invite user" dialog (email + role) — Owner/Manager only.
- Team page: pending invites list with Resend / Revoke actions.
- Public route `/invite/:token`:
  - Calls `get_invitation_by_token` to render vineyard + role.
  - If not signed in: shows "Sign in" or "Create account" (email pre-filled, locked) — both paths ultimately call `accept_invitation`.
  - If signed in: shows "Accept invitation" button.
  - Handles expired / revoked / already-accepted states clearly.
- Reset / password flows reuse existing auth.

### Open questions to resolve before build
- Do supervisors/operators get portal access via invitation, or stay iOS-only? (Default assumption: still iOS-only; portal invites are Owner/Manager only.)
- Should accepting an invite while already a member upgrade/downgrade the role, or be a no-op?
- Single-use vs. reusable invites (recommend single-use, single email).
- Email delivery path: Lovable transactional email vs. Edge Function.

### Blockers
- `vineyard_invitations` table + RPCs do not exist yet — requires Rork/Supabase migration.
- Until then, no portal UI is built. Team page remains read-only for membership.

---

## 2. Portal Chemical AI Lookup

**Status:** Not started — placeholder shown in chemical picker ("AI chemical lookup coming later").

**Goal:** Bring the iOS AI-assisted chemical lookup into the portal so Owners/Managers can create `saved_chemicals` rows from a product name without typing every field.

### Scope
- Surface inside the Spray Job/Template chemical picker → "Add chemical" flow.
- Also available from Setup → Saved Chemicals.
- Owner/Manager only.

### Backend dependency
- Reuse the existing iOS `chemical-info-lookup` Edge Function if it can be safely invoked from the portal (verify auth + RLS + rate limits).
- If not portable, wrap behind a new SECURITY DEFINER RPC or Edge Function callable from the portal.
- Must NOT require service-role key in browser.

### UX
- Free-text input ("Enter product name") → AI returns suggested name, active ingredient, group, use, default rate/unit, restrictions.
- User reviews + edits before saving to `saved_chemicals`.
- Result is then auto-attached to the spray job line that opened the flow.

### Blockers
- Need confirmation that the iOS `chemical-info-lookup` function is reachable from portal auth context.
- Need rate-limit / cost guardrails before exposing to portal users.
