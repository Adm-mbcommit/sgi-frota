/**
 * Parâmetros das regras de negócio. Os valores padrão são os mesmos do
 * artefato original (CFG). Em produção ficam na tabela `Setting` por empresa
 * e podem ser alterados pelo administrador.
 */
export interface FleetConfig {
  /** Nome da empresa cujos registros entram nos cálculos (os formulários registram também outras). */
  empresa: string;
  /** Alerta de manutenção quando faltar este km ou menos. */
  kmAlert: number;
  /** Alerta de manutenção quando faltar este número de dias ou menos (por data ou pela previsão de uso). */
  dayAlert: number;
  /** Antecedência, em dias, para alertar documentos e CNH. */
  docDays: number;
  /** Velocidade (km/h) acima da qual um evento do rastreador conta como excesso. */
  speed: number;
  /** Duração máxima plausível de uma viagem, em horas. */
  tripH: number;
  /** Litros máximos plausíveis em um abastecimento. */
  maxL: number;
  /** Faixa plausível de preço por litro (R$). */
  pMin: number;
  pMax: number;
  /** Diferença máxima (km) entre o km final de uma viagem e o inicial da próxima. */
  jump: number;
  /** Km máximo plausível em uma única viagem. */
  maxTrip: number;
  /** Janela (km) em torno do km de referência do veículo para aceitar um hodômetro. */
  win: number;
  /** Consumo plausível (km/L). */
  kmlMin: number;
  kmlMax: number;
  /** Janela (dias) usada para o ritmo de uso diário. */
  paceDays: number;
  /** Postos cadastrados. */
  postos: string[];
}

export const DEFAULT_CONFIG: FleetConfig = {
  empresa: 'Matias Brasil',
  kmAlert: 1500,
  dayAlert: 30,
  docDays: 60,
  speed: 100,
  tripH: 24,
  maxL: 80,
  pMin: 4,
  pMax: 10,
  jump: 5,
  maxTrip: 2500,
  win: 15000,
  kmlMin: 5,
  kmlMax: 20,
  paceDays: 60,
  postos: ['Elefantinho'],
};
