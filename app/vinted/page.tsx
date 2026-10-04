"use client";

import { VintedQueue } from "../VintedQueue";

export default function VintedPage() {
  return (
    <main className="wrap">
      <header className="masthead">
        <span className="logo-mark" aria-hidden="true">
          🪄
        </span>
        <div>
          <h1>Listing Writer</h1>
          <p>Prepare items for Vinted, then post them yourself one at a time.</p>
        </div>
      </header>
      <VintedQueue />
    </main>
  );
}
