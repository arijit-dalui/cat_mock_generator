import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import ReportsClient from "./ReportsClient";

export const dynamic = "force-dynamic";

export default async function AdminReportsPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/dashboard");
  return <ReportsClient username={user.username} />;
}
