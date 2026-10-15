import { AuthForm } from "./auth-form";

export function SignUpForm(props: React.ComponentPropsWithoutRef<"div">) {
  return <AuthForm mode="signup" {...props} />;
}
