import { create } from "zustand"
import { persist } from "zustand/middleware"

interface CartStoreState {
  item: string[]
}