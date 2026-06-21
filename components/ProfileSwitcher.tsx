"use client";

import { useProfiles } from "@/lib/useProfiles";

export default function ProfileSwitcher() {
  const { profiles, activeProfileId, setActiveProfileId, loadingProfiles, profileError } = useProfiles();

  if (profileError) {
    return <span className="profile-warning">Run profile DB migration</span>;
  }

  if (loadingProfiles || profiles.length === 0) {
    return <span className="profile-warning">Profiles…</span>;
  }

  return (
    <label className="profile-switcher" aria-label="Active wardrobe profile">
      <span>Profile</span>
      <select value={activeProfileId} onChange={(event) => setActiveProfileId(event.target.value)}>
        {profiles.map((profile) => (
          <option key={profile.id} value={profile.id}>
            {profile.display_name}
          </option>
        ))}
      </select>
    </label>
  );
}
