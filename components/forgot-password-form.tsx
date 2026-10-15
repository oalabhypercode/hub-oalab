import { AuthForm } from "./auth-form";

export function ForgotPasswordForm(props: React.ComponentPropsWithoutRef<"div">) {
  return <AuthForm mode="forgot" {...props} />;
}
