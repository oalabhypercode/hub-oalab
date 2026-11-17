import { AuthForm } from "./auth-form";

/** `linkToken`: the unused password link, redeemed by „Passwort speichern“. `account`: the login's address, shown read-only. */
export function UpdatePasswordForm(props: React.ComponentPropsWithoutRef<"div"> & { linkToken?: string; account?: string }) {
  return <AuthForm mode="update" {...props} />;
}
