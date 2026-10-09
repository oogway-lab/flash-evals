import { redirect } from "next/navigation";

// The dashboard lives at `/`. This route stays so existing bookmarks and the
// old links keep working.
export default function DashboardRedirect() {
    redirect("/");
}
