import { AuthForm } from "./auth-form";

export function LoginForm(props: React.ComponentPropsWithoutRef<"div">) {
  return <AuthForm mode="login" {...props} />;
}
