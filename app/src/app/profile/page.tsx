import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import ProfileClient from "./ProfileClient";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return (
    <ProfileClient
      username={user.username}
      role={user.role}
      createdAt={user.created_at}
    />
  );
}
