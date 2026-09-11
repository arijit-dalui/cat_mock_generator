import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import MocksClient from "./MocksClient";

export const dynamic = "force-dynamic";

export default async function AdminMocksPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/dashboard");
  return <MocksClient username={user.username} />;
}
