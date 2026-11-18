"use client";

import { createContext, useContext, useEffect, useId, useRef, useState } from "react";
import { formatStoredQuetzales } from "@/lib/markets/guatemala-inventory";
import {
  PUBLIC_CART_MESSAGES,
  PUBLIC_CART_STORAGE_KEY,
  addPublicCartLine,
  cartOrderWhatsappUrl,
  publicCartTotal,
  readStoredCart,
  removePublicCartLine,
  reviewPublicCart,
  type PublicCartLine,
  type PublicCartQuote,
} from "@/lib/markets/guatemala-cart";
import { catalogPhotoPath } from "@/lib/markets/guatemala-catalog";
import { isStoreHostname } from "@/lib/markets/store-host";

interface CartContextValue {
  lines: PublicCartLine[];
  open: boolean;
  setOpen: (open: boolean) => void;
  add: (line: PublicCartLine) => void;
  remove: (id: string) => void;
}

const CartContext = createContext<CartContextValue | null>(null);

export function StoreCartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<PublicCartLine[]>([]);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState("");
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [notice, setNotice] = useState("");
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    setLines(readStoredCart(window.localStorage.getItem(PUBLIC_CART_STORAGE_KEY)));
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    window.localStorage.setItem(PUBLIC_CART_STORAGE_KEY, JSON.stringify(lines));
  }, [lines, ready]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>("button, a[href]")].filter(
        (node) => !node.hasAttribute("disabled")
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    function onFocus(event: FocusEvent) {
      const target = event.target;
      if (!panelRef.current || (target instanceof Node && panelRef.current.contains(target))) return;
      queueMicrotask(() => {
        const active = document.activeElement;
        if (!panelRef.current || (active instanceof Node && panelRef.current.contains(active))) return;
        closeRef.current?.focus();
      });
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocus);
      returnFocus.current?.focus();
    };
  }, [open]);

  function add(line: PublicCartLine) {
    const result = addPublicCartLine(lines, line);
    setLines(result.lines);
    setToast(result.message);
    if (result.added) setNotice("");
  }

  function remove(id: string) {
    setLines((current) => removePublicCartLine(current, id));
    setNotice("");
  }

  async function sendOrder() {
    if (checking || lines.length === 0) return;
    setChecking(true);
    setNotice("");
    try {
      const response = await fetch("/api/markets/guatemala/catalog/carrito", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: lines.map((line) => line.id) }),
      });
      const body = (await response.json()) as { ok?: boolean; lines?: PublicCartQuote[]; error?: string };
      if (!response.ok || !body.ok || !body.lines) {
        setNotice(body.error || PUBLIC_CART_MESSAGES.confirmFailed);
        return;
      }
      const reviewed = reviewPublicCart(lines, body.lines);
      setLines(reviewed.lines);
      if (reviewed.changed || reviewed.lines.length === 0) {
        setNotice(reviewed.message || PUBLIC_CART_MESSAGES.confirmFailed);
        return;
      }
      const origin = window.location.origin;
      const url = cartOrderWhatsappUrl(reviewed.lines, origin, isStoreHostname(window.location.host));
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      setNotice(PUBLIC_CART_MESSAGES.confirmFailed);
    } finally {
      setChecking(false);
    }
  }

  const value: CartContextValue = { lines, open, setOpen, add, remove };
  return (
    <CartContext.Provider value={value}>
      {children}
      <p className="vsa-cart-toast" role="status" aria-live="polite">{toast}</p>
      {open ? (
        <div className="vsa-cart-backdrop" onMouseDown={() => setOpen(false)}>
          <aside
            ref={panelRef}
            className="vsa-cart"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="vsa-cart-head">
              <h2 id={titleId}>Carrito</h2>
              <button ref={closeRef} type="button" onClick={() => setOpen(false)}>Cerrar</button>
            </header>
            {lines.length === 0 ? (
              <div className="vsa-cart-empty">
                <p className="vsa-mark" aria-hidden="true">VSA</p>
                <strong>{PUBLIC_CART_MESSAGES.emptyTitle}</strong>
                <p>{PUBLIC_CART_MESSAGES.emptyBody}</p>
              </div>
            ) : (
              <ul className="vsa-cart-list">
                {lines.map((line) => (
                  <li key={line.id}>
                    <span className="vsa-cart-photo">
                      {line.coverPhotoId ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={catalogPhotoPath(line.coverPhotoId, 480)} alt="" />
                      ) : <span>Sin foto</span>}
                    </span>
                    <span className="vsa-cart-copy">
                      <strong>{line.title}</strong>
                      {line.size ? <span>Talla {line.size}</span> : null}
                      <span>SKU {line.sku}</span>
                      <span className="vsa-price">{formatStoredQuetzales(line.priceGtq)}</span>
                    </span>
                    <button type="button" onClick={() => remove(line.id)}>Quitar</button>
                  </li>
                ))}
              </ul>
            )}
            <footer className="vsa-cart-foot">
              {notice ? <p className="vsa-cart-notice" role="alert">{notice}</p> : null}
              <p className="vsa-cart-note">{PUBLIC_CART_MESSAGES.shipping}</p>
              {lines.length > 0 ? (
                <>
                  <p className="vsa-cart-total"><span>Total</span><strong>{formatStoredQuetzales(publicCartTotal(lines))}</strong></p>
                  <button type="button" className="vsa-cart-send" disabled={checking} onClick={() => void sendOrder()}>
                    {checking ? PUBLIC_CART_MESSAGES.checking : PUBLIC_CART_MESSAGES.send}
                  </button>
                </>
              ) : null}
            </footer>
          </aside>
        </div>
      ) : null}
    </CartContext.Provider>
  );
}

export function CartButton() {
  const cart = useCart();
  const count = cart.lines.length;
  return (
    <button
      type="button"
      className="vsa-cart-open"
      aria-label={count === 0 ? "Carrito" : count === 1 ? "Carrito, 1 artículo" : `Carrito, ${count} artículos`}
      onClick={() => cart.setOpen(true)}
    >
      <CartIcon />
      {count > 0 ? <span className="vsa-cart-count">{count}</span> : null}
    </button>
  );
}

export function AddToCartButton({ item }: { item: PublicCartLine }) {
  const cart = useCart();
  const saved = cart.lines.some((line) => line.id === item.id);
  return (
    <button
      type="button"
      className="vsa-cart-add"
      onClick={() => {
        if (saved) cart.setOpen(true);
        else cart.add(item);
      }}
    >
      {saved ? PUBLIC_CART_MESSAGES.inCart : PUBLIC_CART_MESSAGES.add}
    </button>
  );
}

function useCart(): CartContextValue {
  const cart = useContext(CartContext);
  if (!cart) throw new Error("El carrito solo está disponible en el catálogo.");
  return cart;
}

function CartIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 7h12l-1 12H7L6 7z" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9 7a3 3 0 0 1 6 0" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
