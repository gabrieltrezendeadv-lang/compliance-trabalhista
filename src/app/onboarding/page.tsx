import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Not authenticated → login
  if (!user) {
    redirect("/login");
  }

  // Already has tenant → dashboard (no re-onboarding)
  const { data: membership } = await supabase
    .from("organization_members")
    .select("tenant_id")
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .limit(1)
    .single();

  if (membership) {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        <OnboardingForm />
      </div>
    </div>
  );
}
