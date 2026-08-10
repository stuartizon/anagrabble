import type { useUser } from "@clerk/react";

type ClerkUser = NonNullable<ReturnType<typeof useUser>["user"]>;

export function getDisplayName(user: ClerkUser | null | undefined): string {
  const displayName = (user?.unsafeMetadata as { displayName?: string } | undefined)?.displayName;
  return displayName || user?.primaryEmailAddress?.emailAddress || "";
}
