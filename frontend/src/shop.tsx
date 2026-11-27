import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, customerToken, saveCustomerToken } from './api';

export interface Customer { id: number; name: string; phone: string }
export interface CartItem { serviceId: number; name: string; price: number; qty: number; image: string | null }
export interface Cart { slug: string; company: string; items: CartItem[] }

interface Ctx {
  customer: Customer | null; ready: boolean;
  login(phone: string, password: string): Promise<void>;
  register(name: string, phone: string, password: string): Promise<void>;
  logout(): void;
  cart: Cart | null;
  add(slug: string, company: string, item: Omit<CartItem, 'qty'>): 'added' | 'other-company';
  replaceWith(slug: string, company: string, item: Omit<CartItem, 'qty'>): void;
  setQty(serviceId: number, qty: number): void;
  clear(): void;
  count: number; total: number;
}
const C = createContext<Ctx | null>(null);
const CART_KEY = 'nq.cart';

function loadCart(): Cart | null {
  try { const v = localStorage.getItem(CART_KEY); return v ? (JSON.parse(v) as Cart) : null; } catch { return null; }
}

/** Marketplace customer session and cart. The cart lives on this device; prices are re-read by the server when the order is placed. */
export function ShopProvider({ children }: { children: ReactNode }) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [ready, setReady] = useState(false);
  const [cart, setCart] = useState<Cart | null>(loadCart);

  useEffect(() => {
    if (!customerToken()) { setReady(true); return; }
    api<Customer>('/shop/me', { customer: true }).then(setCustomer).catch(() => saveCustomerToken(null)).finally(() => setReady(true));
    const off = () => { saveCustomerToken(null); setCustomer(null); };
    window.addEventListener('nq:customer-logout', off);
    return () => window.removeEventListener('nq:customer-logout', off);
  }, []);
  useEffect(() => { try { if (cart && cart.items.length) localStorage.setItem(CART_KEY, JSON.stringify(cart)); else localStorage.removeItem(CART_KEY); } catch { /* ignore */ } }, [cart]);

  const session = async (path: string, body: unknown) => {
    const r = await api<{ token: string; customer: Customer }>(path, { method: 'POST', body });
    saveCustomerToken(r.token);
    setCustomer(r.customer);
  };
  const value = useMemo<Ctx>(() => ({
    customer, ready,
    login: (phone, password) => session('/shop/login', { phone, password }),
    register: (name, phone, password) => session('/shop/register', { name, phone, password }),
    logout: () => { saveCustomerToken(null); setCustomer(null); },
    cart,
    add: (slug, company, item) => {
      if (cart && cart.slug !== slug && cart.items.length) return 'other-company';
      setCart((c) => {
        const base: Cart = c && c.slug === slug ? c : { slug, company, items: [] };
        const ex = base.items.find((i) => i.serviceId === item.serviceId);
        return { ...base, items: ex ? base.items.map((i) => (i.serviceId === item.serviceId ? { ...i, qty: Math.min(1000, i.qty + 1) } : i)) : [...base.items, { ...item, qty: 1 }] };
      });
      return 'added';
    },
    replaceWith: (slug, company, item) => setCart({ slug, company, items: [{ ...item, qty: 1 }] }),
    setQty: (id, qty) => setCart((c) => (c ? { ...c, items: qty <= 0 ? c.items.filter((i) => i.serviceId !== id) : c.items.map((i) => (i.serviceId === id ? { ...i, qty: Math.min(1000, qty) } : i)) } : c)),
    clear: () => setCart(null),
    count: cart?.items.reduce((a, i) => a + i.qty, 0) ?? 0,
    total: Math.round((cart?.items.reduce((a, i) => a + i.price * i.qty, 0) ?? 0) * 100) / 100,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [customer, ready, cart]);
  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useShop(): Ctx {
  const v = useContext(C);
  if (!v) throw new Error('ShopProvider missing');
  return v;
}
