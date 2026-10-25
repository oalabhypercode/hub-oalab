"use client";

import { signOutAction } from "@/lib/hub-auth/actions";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();

  const logout = async () => {
    await signOutAction();
    router.push("/auth/login");
  };

  return <Button onClick={logout}>Logout</Button>;
}
