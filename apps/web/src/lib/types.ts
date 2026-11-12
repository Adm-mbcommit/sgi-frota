/* Formas das respostas da API (subconjunto usado nas telas). */
export interface Problem { code: string; label: string }
export interface VehicleSummary {
  plate: string; name: string; refKm: number; status: string; currentKm: number; lastUse: string | null; kmPerDay: number;
  trips: number; km: number; liters: number; fuelCost: number; kml: number | null; fuelCostPerKm: number | null;
  speedEvents: number; maxSpeed: number; maintenance: string; docs: string | null;
}
export interface PlanItem {
  id: string; plate: string; vehicleId: string; vehicleName: string; item: string; intervalKm: number | null; intervalMonths: number | null;
  lastKm: number | null; lastDate: string | null; nextKm: number | null; dueDate: string | null; kmLeft: number | null; daysLeft: number | null;
  forecastDays: number | null; currentKm: number | null; status: string; source: string | null;
}
export interface Dashboard {
  period: { from: string; to: string }; config: { speed: number };
  kpis: { trips: number; km: number; fuel: number; otherCosts: number; total: number; costPerKm: number | null; speedEvents: number; openTrips: number; maintenanceAlerts: number };
  vehicles: VehicleSummary[]; alerts: PlanItem[]; openTasks: Task[];
  monthlyFuel: { month: string; byVehicle: Record<string, number> }[]; speedByDriver: { driver: string; count: number }[];
  lastTripAt: string | null; lastSpeedAt: string | null;
}
export interface Trip { id: string; startedAt: string; endedAt: string | null; vehicleName: string | null; driver: string | null; driverRaw: string | null; kmStart: number | null; kmEnd: number | null; durationH: number | null; km: number | null; valid: boolean; open: boolean; problems: Problem[] }
export interface Fueling { id: string; at: string; vehicleName: string | null; driver: string | null; km: number | null; liters: number | null; total: number | null; pricePerLiter: number | null; station: string | null; kml: number | null; problems: Problem[] }
export interface SpeedEvent { id: string; startedAt: string; vehicleName: string | null; driver: string | null; vmax: number; vavg: number | null; durationH: number | null; from: string | null; to: string | null }
export interface Docs { plate: string; vehicleId: string; vehicleName: string; crlv: string | null; ipva: string | null; licensing: string | null; insurance: string | null; confirmed: boolean; next: string | null; days: number | null; status: string }
export interface Driver { id: string; name: string; aliases: string[]; cnhExpiry: string | null; active: boolean }
export interface DriverSummary { name: string; cnhExpiry: string | null; cnhStatus: string; trips: number; km: number; speedEvents: number; maxSpeed: number; fuelings: number; checklists: number }
export interface Vehicle { id: string; plate: string; name: string; model: string | null; refKm: number; status: string; aliases: string[]; active: boolean }
export interface Cost { id: string; date: string; vehicleId: string | null; vehicleName: string | null; category: string; description: string; supplier: string | null; amount: number | null; invoice: string | null; notes: string | null;
  maintenance: { km: number | null; planItemIds: string[]; items: string[] } | null }
export interface MaintenanceRecord { id: string; date: string; km: number | null; vehicleName: string; item: string; supplier: string | null; invoice: string | null; notes: string | null; source: string; costId: string | null }
export interface Task { id: string; title: string; description: string | null; status: string }
export interface User { id: string; name: string; email: string; role: string; active: boolean; lastLoginAt: string | null }
