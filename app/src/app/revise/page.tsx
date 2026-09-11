import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import ReviseClient from "./ReviseClient";

export const dynamic = "force-dynamic";

export default async function RevisePage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return <ReviseClient username={user.username} />;
}
