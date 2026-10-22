import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Ban, Hourglass, ShieldX } from "lucide-react";
import { getHubAccount } from "@/lib/hub-users/server";
import { PendingSignOut } from "./sign-out";

export const metadata: Metadata = { title: "Zugang wird geprüft" };

const states = {
  pending: {
    icon: Hourglass,
    eyebrow: "Danke für deine Registrierung.",
    title: ["Wir prüfen", "deine Angaben."],
    text: "Dein oalab-Team schaut sich deine Registrierung an und schaltet deinen Zugang frei. Danach meldest du dich wie gewohnt an und findest alles für dein Unternehmen im Client Hub.",
  },
  rejected: {
    icon: ShieldX,
    eyebrow: "Deine Registrierung",
    title: ["Kein Zugang", "freigegeben."],
    text: "Dein oalab-Team hat deine Registrierung nicht freigegeben. Wenn du glaubst, dass das ein Irrtum ist, wende dich bitte direkt an dein oalab-Team.",
  },
  disabled: {
    icon: Ban,
    eyebrow: "Dein Zugang",
    title: ["Zugang", "deaktiviert."],
    text: "Dein Zugang zum oalab Client Hub ist gerade deaktiviert. Bei Fragen wende dich bitte an dein oalab-Team.",
  },
};

async function PendingState() {
  await connection();
  const account = await getHubAccount();
  if (!account) redirect("/auth/login");
  if (account.status === "active" || account.status === "unknown") redirect("/dashboard");
  const state = states[account.status];
  const Icon = state.icon;
  return (
    <div className="auth-form">
      <span className="auth-success-icon" aria-hidden="true"><Icon size={26} /></span>
      <span className="eyebrow">{account.firstName ? `${state.eyebrow.replace(/\.$/, "")}, ${account.firstName}.` : state.eyebrow}</span>
      <h2>{state.title[0]}<br />{state.title[1]}</h2>
      <p>{state.text}</p>
      {account.status === "rejected" && account.decisionNote && <p className="pending-note"><strong>Hinweis deines oalab-Teams:</strong> {account.decisionNote}</p>}
      <PendingSignOut />
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<div className="auth-form" aria-busy="true" />}><PendingState /></Suspense>;
}
