import { createContext, useContext, useState, type ReactNode } from 'react';
import { todayIso } from './format';

interface Period { from: string; to: string }
const firstOfPrevMonth = () => { const [y, m] = todayIso().split('-').map(Number); return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`; };
const Ctx = createContext<{ period: Period; setPeriod: (p: Period) => void; qs: string }>(null as never);

export function PeriodProvider({ children }: { children: ReactNode }) {
  const [period, setPeriod] = useState<Period>({ from: firstOfPrevMonth(), to: todayIso() });
  return <Ctx.Provider value={{ period, setPeriod, qs: `from=${period.from}&to=${period.to}` }}>{children}</Ctx.Provider>;
}
export const usePeriod = () => useContext(Ctx);
