/** Args for admin_list_user_login_activity; "all" omits the server filter. */
export function activityRpcArgs(appType: string): Record<string, string> | undefined {
  return appType && appType !== "all" ? { p_app_type: appType } : undefined;
}
