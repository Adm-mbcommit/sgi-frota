/** Entradas dos cálculos. Instantes em epoch ms (UTC); datas de calendário em 'YYYY-MM-DD'. */

export interface VehicleInput {
  plate: string;
  name: string;
  /** Km de referência: âncora para rejeitar hodômetros digitados errado. */
  refKm: number;
  status: 'ATIVO' | 'PARALISADO' | 'INATIVO';
}

export interface TripInput {
  id: string;
  company: string;
  plate: string | null;
  /** Nome canônico do motorista, ou null se a grafia não está cadastrada. */
  driver: string | null;
  /** Texto original do motorista, para exibir quando não reconhecido. */
  driverRaw?: string | null;
  startedAt: number;
  endedAt: number | null;
  kmStart: number | null;
  kmEnd: number | null;
  /** Viagem sem registro de chegada. */
  open: boolean;
  status?: string | null;
}

export interface FuelingInput {
  id: string;
  company: string;
  plate: string | null;
  driver: string | null;
  at: number;
  km: number | null;
  liters: number | null;
  total: number | null;
  station: string | null;
  /** false = não completou o tanque (o consumo não é calculado nesse abastecimento). */
  fullTank: boolean | null;
  notes?: string | null;
}

export interface SpeedEventInput {
  id: string;
  plate: string | null;
  startedAt: number;
  durationH: number | null;
  vmax: number;
  vavg: number | null;
  from?: string | null;
  to?: string | null;
}

export interface PlanItemInput {
  id: string;
  plate: string;
  item: string;
  intervalKm: number | null;
  intervalMonths: number | null;
  lastKm: number | null;
  lastDate: string | null;
  /** Último serviço ainda não confirmado (vira status CONFIRMAR). */
  needsCheck: boolean;
  source?: string | null;
}

export interface VehicleDocsInput {
  plate: string;
  crlv: string | null;
  ipva: string | null;
  licensing: string | null;
  insurance: string | null;
  confirmed: boolean;
}

export interface DriverInput {
  name: string;
  cnhExpiry: string | null;
}

export interface CostInput {
  id: string;
  date: string;
  plate: string | null;
  category: string;
  description: string;
  supplier: string | null;
  amount: number | null;
  notes: string | null;
}

export interface Problem {
  code: string;
  label: string;
}
