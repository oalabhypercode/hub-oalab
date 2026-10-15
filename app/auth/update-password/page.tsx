import type { Metadata } from "next";
import { UpdatePasswordForm } from "@/components/update-password-form";

export const metadata: Metadata = { title: "Neues Passwort" };

export default function Page() { return <UpdatePasswordForm />; }
