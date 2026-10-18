import { PUBLIC_SOLD_BADGE } from "@/lib/markets/guatemala-catalog";

export function SoldTicket() {
  return (
    <span className="vsa-sold-ticket" aria-hidden="true">
      <svg viewBox="0 0 220 86" focusable="false">
        <path
          d="M24 10H196C196 22 180 28 180 43C180 58 196 64 196 76H24C24 64 40 58 40 43C40 28 24 22 24 10Z"
          fill="#ffe14a"
          stroke="#ffffff"
          strokeWidth="7"
          strokeLinejoin="round"
        />
      </svg>
      <span>{PUBLIC_SOLD_BADGE}</span>
    </span>
  );
}
