// Aviso de hora punta según la hora de Lima (America/Lima). No considera feriados.

const DIAS = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

const aMinutos = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

const aTexto = (minutos) => `${Math.floor(minutos / 60)}:${String(minutos % 60).padStart(2, '0')}`;

function horaDeLima(fecha) {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Lima',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(fecha)
      .map((p) => [p.type, p.value]),
  );
  return { dia: DIAS[partes.weekday], minutos: Number(partes.hour) * 60 + Number(partes.minute) };
}

// "2026-11-03T18:30" se interpreta como hora de Lima, sin importar la zona del servidor.
export function leerSalida(texto) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(texto ?? '');
  if (!m) return null;
  const [, a, mes, d, h, min] = m.map(Number);
  const dia = new Date(Date.UTC(a, mes - 1, d)).getUTCDay();
  if (h > 23 || min > 59) return null;
  return { dia: dia === 0 ? 7 : dia, minutos: h * 60 + min };
}

export function evaluarHorario(salida, cfg, ahora = new Date()) {
  const elegida = salida ? leerSalida(salida) : null;
  const { dia, minutos } = elegida ?? horaDeLima(ahora);
  const resultado = { cuando: elegida ? 'elegida' : 'ahora', hora: aTexto(minutos), enHoraPunta: false, mensaje: null };

  for (const franja of cfg.horasPunta) {
    if (!franja.dias.includes(dia)) continue;
    const desde = aMinutos(franja.desde);
    const hasta = aMinutos(franja.hasta);
    const sujeto = elegida ? 'A esa hora es' : 'Ahora es';
    if (minutos >= desde && minutos < hasta) {
      return {
        ...resultado,
        enHoraPunta: true,
        mensaje: `${sujeto} hora punta (${aTexto(desde)} a ${aTexto(hasta)}): más tráfico, más buses y más apuro. Si puedes, sal antes de las ${aTexto(desde)} o después de las ${aTexto(hasta)}.`,
      };
    }
    if (minutos >= desde - cfg.avisoPrevioMinutos && minutos < desde) {
      return {
        ...resultado,
        mensaje: `La hora punta empieza a las ${aTexto(desde)}. Si el viaje es largo, puede alcanzarte en el camino.`,
      };
    }
  }
  return resultado;
}
