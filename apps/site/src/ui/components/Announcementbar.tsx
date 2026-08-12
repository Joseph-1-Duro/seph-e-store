import { useBarStore } from "@/stores/bar.store";
import { ArrowRight, X } from "lucide-react";
import Link from "next/link";

export default function Announcementbar() {
  const isVisible = useBarStore((state) => state.isVisible);
  const isHydrated = useBarStore((state) => state.isHydrated);
  const dismiss = useBarStore((state) => state.dismiss);

  if (!isVisible || !isHydrated) return null;

  return (
    <div role="banner" className="announcement-bar">
      <p>
        We&apos;ve officially launched!
        <Link className="announcement-bar__link" href={"/shop"}>
          Shop Now <ArrowRight size={16} />
        </Link>
      </p>

      <button
        onClick={dismiss}
        className="announcement-bar__dismiss"
        aria-label="Dismiss announcement banner"
      >
        <X strokeWidth={4} size={18} />
      </button>
    </div>
  )
}