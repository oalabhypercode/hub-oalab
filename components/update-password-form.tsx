import { AuthForm } from "./auth-form";

export function UpdatePasswordForm(props: React.ComponentPropsWithoutRef<"div">) {
  return <AuthForm mode="update" {...props} />;
}
