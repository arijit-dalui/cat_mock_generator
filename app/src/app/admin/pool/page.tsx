import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import PoolClient from "./PoolClient";

export const dynamic = "force-dynamic";

export default async function AdminPoolPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/dashboard");
  return <PoolClient username={user.username} />;
}
