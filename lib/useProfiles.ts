"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { WardrobeProfile } from "@/lib/types";

const ACTIVE_PROFILE_KEY = "wardrobeAI:activeProfileId";
const PROFILE_CHANGED_EVENT = "wardrobeAI:profileChanged";

export function useProfiles() {
  const [profiles, setProfiles] = useState<WardrobeProfile[]>([]);
  const [activeProfileId, setActiveProfileIdState] = useState("");
  const [loadingProfiles, setLoadingProfiles] = useState(true);
  const [profileError, setProfileError] = useState("");

  const loadProfiles = useCallback(async () => {
    setLoadingProfiles(true);
    setProfileError("");

    const { data, error } = await supabase
      .from("wardrobe_profiles")
      .select("*")
      .order("display_name", { ascending: true });

    if (error) {
      setProfileError(error.message);
      setLoadingProfiles(false);
      return;
    }

    let loaded = (data ?? []) as WardrobeProfile[];

    if (loaded.length === 0) {
      const { data: seeded, error: seedError } = await supabase
        .from("wardrobe_profiles")
        .insert([
          {
            owner_id: "demo-user",
            display_name: "Manny",
            relationship: "self",
            style_profile: "Modern executive, polished but not stiff corporate. Camera-friendly, Auckland-weather aware.",
            is_active: true
          },
          {
            owner_id: "demo-user",
            display_name: "Yess",
            relationship: "wife",
            style_profile: "Smart, elegant, practical styling. Weather-aware, feminine, polished, not overly sporty.",
            is_active: false
          }
        ])
        .select("*");

      if (!seedError) loaded = (seeded ?? []) as WardrobeProfile[];
    }

    setProfiles(loaded);

    const saved = typeof window !== "undefined" ? localStorage.getItem(ACTIVE_PROFILE_KEY) : "";
    const savedStillExists = loaded.find((profile) => profile.id === saved);
    const dbActive = loaded.find((profile) => profile.is_active);
    const nextProfile = savedStillExists || dbActive || loaded[0];

    if (nextProfile) {
      setActiveProfileIdState(nextProfile.id);
      if (typeof window !== "undefined") localStorage.setItem(ACTIVE_PROFILE_KEY, nextProfile.id);
    }

    setLoadingProfiles(false);
  }, []);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const syncProfile = (profileId: string | null) => {
      if (profileId) setActiveProfileIdState(profileId);
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === ACTIVE_PROFILE_KEY) syncProfile(event.newValue);
    };

    const handleProfileChanged = (event: Event) => {
      const customEvent = event as CustomEvent<{ profileId?: string }>;
      syncProfile(customEvent.detail?.profileId || localStorage.getItem(ACTIVE_PROFILE_KEY));
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener(PROFILE_CHANGED_EVENT, handleProfileChanged);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(PROFILE_CHANGED_EVENT, handleProfileChanged);
    };
  }, []);

  const setActiveProfileId = useCallback(async (profileId: string) => {
    setActiveProfileIdState(profileId);
    if (typeof window !== "undefined") {
      localStorage.setItem(ACTIVE_PROFILE_KEY, profileId);
      window.dispatchEvent(new CustomEvent(PROFILE_CHANGED_EVENT, { detail: { profileId } }));
    }

    try {
      await supabase.from("wardrobe_profiles").update({ is_active: false, updated_at: new Date().toISOString() }).neq("id", profileId);
      await supabase.from("wardrobe_profiles").update({ is_active: true, updated_at: new Date().toISOString() }).eq("id", profileId);
    } catch {
      // localStorage is the source of truth for the current browser if the DB update is blocked.
    }
  }, []);

  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.id === activeProfileId) || profiles[0] || null,
    [profiles, activeProfileId]
  );

  return {
    profiles,
    activeProfile,
    activeProfileId: activeProfile?.id || activeProfileId,
    setActiveProfileId,
    loadingProfiles,
    profileError,
    reloadProfiles: loadProfiles
  };
}
