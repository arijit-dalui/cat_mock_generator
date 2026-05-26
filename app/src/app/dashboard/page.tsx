import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import DashboardClient from "./DashboardClient";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  const user = currentUser();
  if (!user) redirect("/login");
  if (user.role === "admin") redirect("/admin");
  return <DashboardClient username={user.username} />;
}
