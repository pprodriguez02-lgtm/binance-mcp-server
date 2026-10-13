#!/usr/bin/env python3
"""Small read-only Futures grid scenario calculator. Python standard library only."""
import argparse
import concurrent.futures
import json
import math
import statistics
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone


def api(endpoint, **params):
    url = 'https://fapi.binance.com/fapi/v1/' + endpoint
    url += '?' + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=25) as response:
        return json.load(response)


def candles(symbol, endpoint, start, end):
    rows = []
    while start < end:
        chunk = api(endpoint, symbol=symbol, interval='1m', startTime=start,
                    endTime=end - 1, limit=1500)
        if not chunk:
            raise ValueError('Binance devolvió una ventana incompleta de velas.')
        rows.extend(chunk)
        start = int(chunk[-1][0]) + 60000
    if any(b[0] - a[0] != 60000 for a, b in zip(rows, rows[1:])):
        raise ValueError('Hay huecos en las velas; no se calcularán frecuencias.')
    return rows


def validate(c):
    for field in ('lower', 'upper', 'margin', 'leverage', 'qty_per_order', 'hours',
                  'days', 'tp_roi', 'sl_roi'):
        if not math.isfinite(c[field]) or c[field] <= 0:
            raise ValueError(field + ' debe ser positivo y finito.')
    if c['lower'] >= c['upper']:
        raise ValueError('lower debe ser menor que upper.')
    if type(c['grids']) is not int or not 2 <= c['grids'] <= 250:
        raise ValueError('grids debe ser un entero de 2 a 250.')
    if not 1 <= c['hours'] <= 24 or not 1 <= c['days'] <= 7:
        raise ValueError('hours: 1–24; days: 1–7. No se guardan históricos.')
    if c['direction'] not in ('long', 'short', 'neutral'):
        raise ValueError('direction: long, short o neutral.')
    if c['spacing'] not in ('arithmetic', 'geometric'):
        raise ValueError('spacing: arithmetic o geometric.')
    if c['price_basis'] not in ('mark', 'last'):
        raise ValueError('price_basis: mark o last.')
    for name in ('maker_fee_pct', 'taker_fee_pct', 'market_slippage_pct'):
        if not math.isfinite(c[name]) or not 0 <= c[name] <= 1:
            raise ValueError(name + ' debe estar entre 0 y 1 (porcentaje).')
    if any(not math.isfinite(x) or x <= 0 for x in c['targets_roi']):
        raise ValueError('targets_roi debe contener porcentajes positivos.')


def grid_levels(c):
    lo, hi, n = c['lower'], c['upper'], c['grids']
    if c['spacing'] == 'arithmetic':
        return [lo + (hi - lo) * i / n for i in range(n + 1)]
    return [lo * (hi / lo) ** (i / n) for i in range(n + 1)]


class Grid:
    """Independent adjacent-level lots; ideal fills on close-to-close crossings."""
    def __init__(self, c, entry):
        self.c, self.previous, self.cash = c, entry, 0.0
        self.q = c['qty_per_order']
        self.maker = c['maker_fee_pct'] / 100
        self.market = (c['taker_fee_pct'] + c['market_slippage_pct']) / 100
        levels = grid_levels(c)
        self.cells = []
        self.cycles = 0
        self.fees = 0.0
        self.funding = 0.0
        self.peak = 0.0
        self.drawdown = 0.0
        self.max_notional = 0.0
        self.min_roi = self.max_roi = 0.0
        self.initial_qty = 0.0
        for lo, hi in zip(levels, levels[1:]):
            direction = c['direction']
            side = 1 if direction == 'long' or (direction == 'neutral' and hi <= entry) else -1
            if direction == 'neutral' and lo < entry < hi:
                continue  # No position in the interval straddling the reference.
            held = direction == 'long' and lo >= entry - 1e-12
            held |= direction == 'short' and hi <= entry + 1e-12
            cell = dict(lo=lo, hi=hi, side=side, held=held, new=False)
            self.cells.append(cell)
            if held:
                self.trade(side * self.q, entry, self.market)
                self.initial_qty += side * self.q
        self.value(entry)

    def trade(self, quantity, price, fee):
        cost = abs(quantity) * price * fee
        self.cash -= quantity * price + cost
        self.fees += cost

    def position(self):
        return sum(x['side'] * self.q for x in self.cells if x['held'])

    def value(self, reference):
        held = sum(self.q for x in self.cells if x['held'])
        self.max_notional = max(self.max_notional, held * reference)
        pnl = self.cash + self.position() * reference
        self.peak = max(self.peak, pnl)
        self.drawdown = max(self.drawdown, self.peak - pnl)
        roi = 100 * pnl / self.c['margin']
        self.min_roi, self.max_roi = min(self.min_roi, roi), max(self.max_roi, roi)
        return pnl

    def step(self, price, reference=None, funding_rate=0.0):
        prev = self.previous
        for cell in self.cells:
            side = cell['side']
            entry_level = cell['lo'] if side == 1 else cell['hi']
            exit_level = cell['hi'] if side == 1 else cell['lo']
            enters = price <= entry_level < prev if side == 1 else prev < entry_level <= price
            exits = prev < exit_level <= price if side == 1 else price <= exit_level < prev
            if not cell['held'] and enters:
                self.trade(side * self.q, entry_level, self.maker)
                cell['held'], cell['new'] = True, True
            elif cell['held'] and exits:
                self.trade(-side * self.q, exit_level, self.maker)
                self.cycles += int(cell['new'])
                cell['held'] = False
        reference = price if reference is None else reference
        funding = -self.position() * reference * funding_rate
        self.cash += funding
        self.funding += funding
        self.previous = price
        return self.value(reference)

    def close_pnl(self, execution_price):
        held = sum(self.q for x in self.cells if x['held'])
        return self.cash + self.position() * execution_price - held * execution_price * self.market


def simulate(c, path, entry, funding=None, use_stops=True):
    grid = Grid(c, entry)
    funding = funding or {}
    reached = {str(t): False for t in c['targets_roi']}
    reason = 'tiempo'
    elapsed = 0
    price = entry
    for elapsed, (stamp, price, reference) in enumerate(path, 1):
        pnl = grid.step(price, reference, funding.get(stamp, 0.0))
        roi = 100 * pnl / c['margin']
        for t in c['targets_roi']:
            reached[str(t)] |= roi >= t
        if use_stops:
            if roi <= -c['sl_roi']:
                reason = 'SL'
                break
            if pnl <= -c['margin']:
                reason = 'margen_agotado'
                break
            if roi >= c['tp_roi']:
                reason = 'TP'
                break
    return dict(reason=reason, minutes=elapsed, net_pnl=grid.close_pnl(price),
                roi=100 * grid.close_pnl(price) / c['margin'], cycles=grid.cycles,
                drawdown=grid.drawdown, min_roi=grid.min_roi, max_roi=grid.max_roi,
                fees_before_close=grid.fees, funding=grid.funding,
                max_notional=grid.max_notional, initial_qty=grid.initial_qty, reached=reached)


def directional_target(c, entry, target):
    """Find first threshold on one monotonic path, not a universal ROI price."""
    if c['direction'] == 'neutral':
        return None
    direction = 1 if (target > 0) == (c['direction'] != 'short') else -1
    grid = Grid(c, entry)
    for i in range(1, 2001):
        price = entry * (1 + direction * 0.5 * i / 2000)
        roi = 100 * grid.step(price) / c['margin']
        if (target > 0 and roi >= target) or (target < 0 and roi <= target):
            return dict(price=price, change_pct=100 * (price / entry - 1))
    return None


def wilson(success, n):
    p, z = success / n, 1.96
    center = (p + z*z/(2*n)) / (1 + z*z/n)
    half = z * math.sqrt(p*(1-p)/n + z*z/(4*n*n)) / (1 + z*z/n)
    return [100*(center-half), 100*(center+half)]


def analyze(c):
    validate(c)
    end = int(time.time() * 1000) // 60000 * 60000
    start = end - (round(c['days'] * 1440) + 1) * 60000
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        traded_future = pool.submit(candles, c['symbol'], 'klines', start, end)
        mark_future = (pool.submit(candles, c['symbol'], 'markPriceKlines', start, end)
                       if c['price_basis'] == 'mark' else None)
        traded = traded_future.result()
        marks = mark_future.result() if mark_future else traded
    if len(traded) != round(c['days'] * 1440) + 1 or [x[0] for x in marks] != [x[0] for x in traded]:
        raise ValueError('Cobertura temporal incompleta o precios sin alinear.')
    ticker = api('ticker/price', symbol=c['symbol'])
    entry = c.get('entry') or float(ticker['price'])
    if not c['lower'] <= entry <= c['upper']:
        raise ValueError('El precio de entrada está fuera del grid; ajusta el rango o entry.')
    if c['qty_per_order'] * c['grids'] * c['upper'] > c['margin'] * c['leverage']:
        raise ValueError('Los lotes del grid superan margin × leverage; revisa qty_per_order.')
    history = api('fundingRate', symbol=c['symbol'], startTime=start, endTime=end-1, limit=1000)
    funding = {int(x['fundingTime']) // 60000 * 60000: float(x['fundingRate']) for x in history}
    count = round(c['hours'] * 60)
    blocks = []
    comparisons = {str(t): [] for t in c['targets_roi']}
    for offset in range(1, len(traded) - count + 1, count):
        baseline = float(traded[offset-1][4])
        scale = entry / baseline
        path = [(x[0], float(x[4])*scale, float(m[4])*scale)
                for x, m in zip(traded[offset:offset+count], marks[offset:offset+count])]
        result = simulate(c, path, entry, funding)
        # Unstopped excursions answer how often other ROI bounds were touched.
        full = simulate(c, path, entry, funding, use_stops=False)
        result['full_window_reached'] = full['reached']
        result['start'] = datetime.fromtimestamp(traded[offset][0]/1000, timezone.utc).isoformat()
        blocks.append(result)
        for target in c['targets_roi']:
            comparisons[str(target)].append(simulate({**c, 'tp_roi': target}, path, entry, funding))
    if not blocks:
        raise ValueError('days no alcanza para una ventana completa de hours más su precio inicial.')
    recent = traded[-count:]
    recent_marks = marks[-count:]
    actual_entry = float(traded[-count-1][4])
    actual = simulate(c, [(x[0], float(x[4]), float(m[4])) for x, m in zip(recent, recent_marks)],
                      actual_entry, funding) if c['lower'] <= actual_entry <= c['upper'] else None
    lo, hi = min(float(x[3]) for x in recent), max(float(x[2]) for x in recent)
    levels = grid_levels(c)
    profits = [c['qty_per_order']*((b-a)-(a+b)*c['maker_fee_pct']/100)
               for a, b in zip(levels, levels[1:])]
    frequencies = {}
    for target in c['targets_roi']:
        hits = sum(x['full_window_reached'][str(target)] for x in blocks)
        frequencies[str(target)] = dict(hits=hits, total=len(blocks), pct=100*hits/len(blocks),
                                         descriptive_wilson_95=wilson(hits, len(blocks)))
    return dict(config=c, entry=entry, data_end_utc=datetime.fromtimestamp(end/1000, timezone.utc).isoformat(),
                recent=dict(low=lo, high=hi, change_pct=100*(float(recent[-1][4])/actual_entry-1),
                            volume=float(sum(float(x[7]) for x in recent))),
                cycle_net_range=[min(profits), max(profits)],
                cycle_only_targets={str(t): math.ceil(c['margin']*t/100/min(profits)) if min(profits)>0 else None
                                    for t in c['targets_roi']},
                monotonic_targets={str(t): directional_target(c, entry, t)
                                   for t in c['targets_roi'] + [-c['sl_roi']]},
                historical=dict(blocks=len(blocks), tp=sum(x['reason']=='TP' for x in blocks),
                                sl=sum(x['reason']=='SL' for x in blocks),
                                timed_out=sum(x['reason']=='tiempo' for x in blocks),
                                margin_exhausted=sum(x['reason']=='margen_agotado' for x in blocks),
                                mean_net=statistics.mean(x['net_pnl'] for x in blocks),
                                median_net=statistics.median(x['net_pnl'] for x in blocks),
                                worst_net=min(x['net_pnl'] for x in blocks),
                                best_net=max(x['net_pnl'] for x in blocks),
                                max_drawdown=max(x['drawdown'] for x in blocks),
                                frequencies=frequencies,
                                tp_comparison={t: dict(tp=sum(x['reason']=='TP' for x in rows),
                                                       sl=sum(x['reason']=='SL' for x in rows),
                                                       timed_out=sum(x['reason']=='tiempo' for x in rows),
                                                       mean_net=statistics.mean(x['net_pnl'] for x in rows),
                                                       median_net=statistics.median(x['net_pnl'] for x in rows))
                                               for t, rows in comparisons.items()}), latest_actual=actual)


def report(r):
    c, h = r['config'], r['historical']
    lines = [f"{c['symbol']} · {c['direction'].upper()} · {c['hours']:g} h · {c['days']:g} días recientes",
             f"Entrada: {r['entry']:.6g} | Rango: {c['lower']}–{c['upper']} | {c['grids']} grids {c['spacing']}",
             f"Margen: {c['margin']:g} USDT | {c['leverage']:g}x | {c['qty_per_order']:g} unidades/orden | referencia {c['price_basis']}",
             f"Costes supuestos: maker {c['maker_fee_pct']}%, taker {c['taker_fee_pct']}%, deslizamiento a mercado {c['market_slippage_pct']}%.",
             f"Datos cerrados hasta {r['data_end_utc']}; sin guardar velas ni conectar la cuenta.", '',
             f"Un ciclo deja aprox. {r['cycle_net_range'][0]:.4f}–{r['cycle_net_range'][1]:.4f} USDT después de las dos comisiones maker.",
             'Objetivos (PnL sobre margen; sin multiplicar de nuevo por el apalancamiento):']
    for t in c['targets_roi']:
        move = r['monotonic_targets'][str(t)]
        movement = f"precio {move['price']:.6g}, movimiento {move['change_pct']:+.2f}%" if move else 'no alcanzado con un movimiento favorable único de hasta 50%'
        if c['direction']=='neutral':
            movement = 'el precio objetivo depende de la trayectoria; consultar frecuencia histórica'
        lines.append(f"  ROI +{t:g}% = +{c['margin']*t/100:.2f} USDT: {movement}; unos {r['cycle_only_targets'][str(t)]} ciclos si no hubiera PnL pendiente ni funding.")
    stop = r['monotonic_targets'][str(-c['sl_roi'])]
    if stop and c['direction'] != 'neutral':
        lines.append(f"  SL -{c['sl_roi']:g}%: en caída/subida continua se toca cerca de {stop['price']:.6g} ({stop['change_pct']:+.2f}%).")
    lines += ['', f"Ensayo histórico: {h['blocks']} ventanas no solapadas de {c['hours']:g} h, trasladadas al precio de entrada actual.",
              f"TP primero: {h['tp']} | SL primero: {h['sl']} | cierre por tiempo: {h['timed_out']} | margen agotado en modelo: {h['margin_exhausted']}",
              f"PnL al cerrar: media {h['mean_net']:+.3f}, mediana {h['median_net']:+.3f}, peor {h['worst_net']:+.3f}, mejor {h['best_net']:+.3f} USDT.",
              f"Mayor caída desde un pico a cierres de minuto: {h['max_drawdown']:.3f} USDT.",
              'Frecuencia de tocar objetivos SIN stop (no equivale a TP antes de SL):']
    for t, f in h['frequencies'].items():
        a,b=f['descriptive_wilson_95']
        lines.append(f"  +{float(t):g}% ROI: {f['hits']}/{f['total']} = {f['pct']:.1f}% (banda descriptiva {a:.0f}–{b:.0f}%).")
    lines += ['', f"Comparación de TP manteniendo SL -{c['sl_roi']:g}% (incluye cierre por tiempo):"]
    for t, comparison in h.get('tp_comparison', {}).items():
        lines.append(f"  TP +{float(t):g}% (+{c['margin']*float(t)/100:.2f} USDT): TP {comparison['tp']}/{h['blocks']}, SL {comparison['sl']}, tiempo {comparison['timed_out']}; PnL medio {comparison['mean_net']:+.3f} USDT.")
    recent = r['recent']
    lines += ['', f"Últimas {c['hours']:g} h reales: rango {recent['low']:.6g}–{recent['high']:.6g}, cambio {recent['change_pct']:+.2f}%."]
    if r['latest_actual']:
        x=r['latest_actual']
        lines.append(f"Mismo grid en esa ventana real: {x['reason']}, {x['cycles']} ciclos, PnL final estimado {x['net_pnl']:+.3f} USDT.")
    else:
        lines.append('No se ensaya la última ventana absoluta: al inicio el precio estaba fuera del rango.')
    lines += ['', 'Modelo aproximado: lotes entre niveles vecinos, inventario inicial superior (LONG) o inferior (SHORT); Neutral sin inventario inicial.',
              'No reproduce exactamente Binance. Cruces de cierres de 1 min, fills ideales, sin colas/ejecuciones parciales ni liquidación real; drawdown intraminuto omitido.',
              'TP/SL usa PnL antes de cierre; resultado neto incluye coste de cierre. Funding histórico aplicado al inventario estimado del minuto.',
              'Frecuencias retrospectivas con muestra pequeña y regímenes relacionados: NO probabilidades calibradas del futuro. Las bandas no corrigen esa dependencia.',
              'No se comprueban filtros de órdenes ni margen de mantenimiento; confirma cantidad/orden y liquidación en Binance. leverage solo indica capacidad máxima nominal.',
              'Ejecuta de nuevo para comparar otra configuración; no se colocan órdenes ni se guarda un historial.']
    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('config', help='JSON con parámetros del bot')
    parser.add_argument('--output', help='Guardar SOLO el informe JSON si se pide explícitamente')
    args = parser.parse_args()
    defaults = dict(direction='long', spacing='arithmetic', hours=8, days=3,
                    price_basis='mark', maker_fee_pct=.02, taker_fee_pct=.05,
                    market_slippage_pct=.02, tp_roi=10, sl_roi=10, targets_roi=[5,10,15])
    with open(args.config, encoding='utf-8') as source:
        c = {**defaults, **json.load(source)}
    result = analyze(c)
    print(report(result))
    if args.output:
        with open(args.output, 'w', encoding='utf-8') as destination:
            json.dump(result, destination, indent=2, ensure_ascii=False)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, OSError) as error:
        print('No se pudo completar el análisis:', error, file=sys.stderr)
        sys.exit(1)
