import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AnnouncementBarState {
  isVisible: boolean;
  isHydrated: boolean;
  hiddenUntil: number | null;
  checkVisibility: () => void;
  dismiss: () => void;
}

const HIDDEN_DURATION = 7 * 24 * 60 * 60 * 1000;

export const useBarStore = create<AnnouncementBarState>()(
  persist(
    (set, get) => ({
      isVisible: false,
      isHydrated: false,
      hiddenUntil: null,

      checkVisibility: () => {
        const { hiddenUntil } = get();

        const shouldShow = hiddenUntil === null || Date.now() >= hiddenUntil

        set({ isVisible: shouldShow })
      },

      dismiss: () => {
        set({
          isVisible: false,
          hiddenUntil: Date.now() + HIDDEN_DURATION
        })
      },
    }),
    {
      name: "banner-storage",
      partialize: (state) => ({
        hiddenUntil: state.hiddenUntil
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;

        state.isHydrated = true;
        state.checkVisibility();
      }
    }
  )
)