import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import UsersClient from "./UsersClient";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/dashboard");
  return <UsersClient username={user.username} />;
}
