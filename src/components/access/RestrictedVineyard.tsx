import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PortalNotice } from "@/components/ui/PortalNotice";
import { Lock, RefreshCw, ArrowLeftRight, CreditCard, Mail, LifeBuoy } from "lucide-react";
import {
  useRefreshVineyardAccess,
  vineyardAccessReasonLabel,
  type VineyardAccessRow,
} from "@/lib/vineyardAccessQuery";
import { usePendingInvites } from "@/hooks/usePendingInvites";

/** Role-aware wording for a vineyard the signed-in user cannot enter. */
export function restrictedVineyardMessage(row: VineyardAccessRow): string {
  const role = row.membership_role;
  if (role === "owner") {
    if (row.is_billing_authority) {
      if (row.vineyard_access_reason === "owner_plan_not_vineyard_funding")
        return "This vineyard needs a Team plan. Your Solo plan covers your own access only. Upgrade to Team to provide access to Managers, Supervisors and Operators.";
      return vineyardAccessReasonLabel(row.vineyard_access_reason);
    }
    return "Billing for this vineyard is managed by another Owner.";
  }
  return "Access to this vineyard is managed by its Vineyard Owner.";
}

export default function RestrictedVineyard({
  row,
  onChooseAnother,
}: {
  row: VineyardAccessRow;
  onChooseAnother?: () => void;
}) {
  const navigate = useNavigate();
  const refresh = useRefreshVineyardAccess();
  const { data: invites = [] } = usePendingInvites();

  const isOwner = row.membership_role === "owner";
  const isBillingAuthority = isOwner && row.is_billing_authority;
  const needsTeamUpgrade =
    isBillingAuthority && row.vineyard_access_reason === "owner_plan_not_vineyard_funding";

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Lock className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>{row.vineyard_name ?? "This vineyard"} is restricted</CardTitle>
              <CardDescription>{restrictedVineyardMessage(row)}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2 text-xs">
            {row.membership_role && (
              <Badge variant="secondary" className="capitalize">
                {row.membership_role}
              </Badge>
            )}
            <Badge variant="outline">
              {vineyardAccessReasonLabel(row.vineyard_access_reason)}
            </Badge>
          </div>

          <div className="flex flex-wrap gap-2">
            {needsTeamUpgrade && (
              <Button onClick={() => navigate("/account/billing")}>Upgrade to Team</Button>
            )}
            <Button variant="outline" onClick={() => onChooseAnother?.() ?? navigate("/select-vineyard")}>
              <ArrowLeftRight className="mr-2 h-4 w-4" /> Choose another vineyard
            </Button>
            <Button
              variant="outline"
              onClick={() => refresh.mutate()}
              disabled={refresh.isPending}
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${refresh.isPending ? "animate-spin" : ""}`} />
              Check access again
            </Button>
            {isBillingAuthority && row.can_manage_billing && (
              <Button variant="outline" onClick={() => navigate("/account/billing")}>
                <CreditCard className="mr-2 h-4 w-4" /> Manage billing
              </Button>
            )}
            {!isOwner && (
              <>
                {invites.length > 0 && (
                  <Button variant="outline" onClick={() => navigate("/select-vineyard")}>
                    <Mail className="mr-2 h-4 w-4" /> View pending invitations (
                    {invites.length})
                  </Button>
                )}
                <Button variant="ghost" asChild>
                  <a href="mailto:support@vinetrack.com.au">
                    <LifeBuoy className="mr-2 h-4 w-4" /> Contact support
                  </a>
                </Button>
              </>
            )}
          </div>

          {isOwner && !row.is_billing_authority && (
            <PortalNotice
              compact
              variant="info"
              description="Ask the Owner who manages this vineyard's billing to review it."
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
