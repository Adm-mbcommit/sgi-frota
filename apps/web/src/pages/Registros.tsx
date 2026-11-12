/** Viagens, abastecimentos e velocidade. */
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { fdt, nf, rs } from '../lib/format';
import { usePeriod } from '../lib/period';
import type { Fueling, SpeedEvent, Trip } from '../lib/types';
import { DataTable, Header, Loading, PeriodPicker, Problems } from '../components/ui';

export function Viagens() {
  const { qs } = usePeriod();
  const q = useQuery({ queryKey: ['trips', qs], queryFn: () => api<Trip[]>('/trips?' + qs) });
  return (
    <>
      <Header title="Viagens" sub="Registros do Comando de Bordo. Linhas com problema ficam fora dos cálculos de km." />
      <PeriodPicker /><Loading q={q} />
      {q.data && <DataTable rows={q.data} maxh={620} filter={{ label: 'Todos os veículos', v: (r) => r.vehicleName }} cols={[
        { h: 'Saída', v: (r) => r.startedAt, f: (r) => fdt(r.startedAt) }, { h: 'Chegada', v: (r) => r.endedAt, f: (r) => fdt(r.endedAt) },
        { h: 'Veículo', v: (r) => r.vehicleName }, { h: 'Motorista', v: (r) => r.driver ?? (r.driverRaw ? r.driverRaw + ' (?)' : '') },
        { h: 'Km inicial', v: (r) => r.kmStart, f: (r) => nf(r.kmStart), n: true }, { h: 'Km final', v: (r) => r.kmEnd, f: (r) => nf(r.kmEnd), n: true },
        { h: 'Duração (h)', v: (r) => r.durationH, f: (r) => nf(r.durationH, 1), n: true }, { h: 'Km rodados', v: (r) => (r.valid ? r.km : null), f: (r) => (r.valid ? nf(r.km) : ''), n: true },
        { h: 'Problema', v: (r) => r.problems.map((p) => p.label).join('; '), f: (r) => <Problems list={r.problems} />, w: true },
      ]} />}
    </>
  );
}

export function Abastecimentos() {
  const { qs } = usePeriod();
  const q = useQuery({ queryKey: ['fuel', qs], queryFn: () => api<Fueling[]>('/fuelings?' + qs) });
  return (
    <>
      <Header title="Abastecimentos" sub="Preço por litro = valor total ÷ litros. Consumo entre abastecimentos consecutivos válidos." />
      <PeriodPicker /><Loading q={q} />
      {q.data && <DataTable rows={q.data} maxh={620} filter={{ label: 'Todos os veículos', v: (r) => r.vehicleName }} cols={[
        { h: 'Data', v: (r) => r.at, f: (r) => fdt(r.at) }, { h: 'Veículo', v: (r) => r.vehicleName }, { h: 'Motorista', v: (r) => r.driver },
        { h: 'Km', v: (r) => r.km, f: (r) => nf(r.km), n: true }, { h: 'Litros', v: (r) => r.liters, f: (r) => nf(r.liters, 1), n: true },
        { h: 'Total', v: (r) => r.total, f: (r) => rs(r.total), n: true }, { h: 'R$/L', v: (r) => r.pricePerLiter, f: (r) => rs(r.pricePerLiter), n: true },
        { h: 'Posto', v: (r) => r.station }, { h: 'Km/L', v: (r) => r.kml, f: (r) => nf(r.kml, 1), n: true },
        { h: 'Problema', v: (r) => r.problems.map((p) => p.label).join('; '), f: (r) => <Problems list={r.problems} />, w: true },
      ]} />}
    </>
  );
}

export function Velocidade() {
  const { qs } = usePeriod();
  const q = useQuery({ queryKey: ['speed', qs], queryFn: () => api<SpeedEvent[]>('/speed-events?' + qs) });
  return (
    <>
      <Header title="Velocidade" sub="Ocorrências acima do limite registradas pelo rastreador, com o motorista identificado pela viagem em andamento." />
      <PeriodPicker /><Loading q={q} />
      {q.data && <DataTable rows={q.data} maxh={620} filter={{ label: 'Todos os motoristas', v: (r) => r.driver ?? 'sem registro' }} cols={[
        { h: 'Início', v: (r) => r.startedAt, f: (r) => fdt(r.startedAt) }, { h: 'Veículo', v: (r) => r.vehicleName }, { h: 'Motorista', v: (r) => r.driver ?? 'sem registro' },
        { h: 'Vel. máx.', v: (r) => r.vmax, f: (r) => nf(r.vmax), n: true }, { h: 'Vel. média', v: (r) => r.vavg, f: (r) => nf(r.vavg), n: true },
        { h: 'Duração (h)', v: (r) => r.durationH, f: (r) => nf(r.durationH, 2), n: true }, { h: 'Origem', v: (r) => r.from, w: true }, { h: 'Destino', v: (r) => r.to, w: true },
      ]} />}
    </>
  );
}
