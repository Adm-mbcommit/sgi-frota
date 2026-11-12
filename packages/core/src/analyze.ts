import type { FleetConfig } from './config.js';
import type { CostInput, DriverInput, FuelingInput, PlanItemInput, SpeedEventInput, TripInput, VehicleDocsInput, VehicleInput } from './types.js';
import { analyzeTrips } from './trips.js';
import { analyzeFuel } from './fuel.js';
import {
  attributeSpeedEvents, documentsStatus, kpis, maintenanceAlerts, maintenanceStatus, monthlyFuel,
  qualityReport, summarizeDrivers, summarizeVehicles, vehicleStates, type FleetInputs,
} from './fleet.js';
import { localDate, type Period } from './dates.js';

export interface FleetData {
  vehicles: VehicleInput[];
  trips: TripInput[];
  fuel: FuelingInput[];
  speed: SpeedEventInput[];
  plan: PlanItemInput[];
  docs: VehicleDocsInput[];
  drivers: DriverInput[];
  costs: CostInput[];
  checklists: { at: number; driver: string | null }[];
}

/** Executa todas as regras sobre um conjunto de dados e devolve o painel completo. */
export function analyzeFleet(data: FleetData, cfg: FleetConfig, period: Period, now: number = Date.now()) {
  const today = localDate(now);
  const trips = analyzeTrips(data.trips, data.vehicles, cfg);
  const fuel = analyzeFuel(data.fuel, data.vehicles, cfg);
  const speed = attributeSpeedEvents(data.speed, trips, cfg);
  const states = vehicleStates(data.vehicles, trips, cfg, now);
  const plan = maintenanceStatus(data.plan, states, cfg, today);
  const docs = documentsStatus(data.docs, today, cfg);
  const inputs: FleetInputs = { ...data, trips, fuel, speed, plan, docs };
  const vehicles = summarizeVehicles(inputs, states, period, cfg);
  return {
    today, period, trips, fuel, speed, plan, docs, vehicles,
    alerts: maintenanceAlerts(plan),
    drivers: summarizeDrivers(inputs, period, today, cfg),
    kpis: kpis(inputs, vehicles, period, cfg),
    monthlyFuel: monthlyFuel(inputs, cfg, now),
    quality: qualityReport(trips, fuel, cfg),
  };
}
export type FleetAnalysis = ReturnType<typeof analyzeFleet>;
