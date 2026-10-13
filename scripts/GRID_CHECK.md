# Calculadora rápida de grids

Necesita Python 3, sin instalar librerías ni usar claves de Binance.

```sh
python3 scripts/grid_check.py scripts/grid_btw.json
```

Edita el JSON para evaluar otro bot. `qty_per_order` es la cantidad de moneda
que Binance muestra por orden, NO los USDT invertidos. `margin` es tu inversión
real; `leverage` no vuelve a multiplicar el PnL calculado con esa cantidad.
`entry` es opcional: sin él se consulta el precio actual; con él puedes comparar
dos configuraciones con la misma entrada. `hours` permite 8 o 12 horas y `days`
consulta de 1 a 7 días, solo en memoria. TP/SL y objetivos se expresan como ROI
sobre el margen (10% de 10 USDT = 1 USDT).

El informe muestra beneficio neto por ciclo, ciclos necesarios para objetivos,
movimiento continuo requerido para distintos ROI, exposición dinámica, y
frecuencia histórica de alcanzar cotas. También compara TP antes de SL y cierre
por tiempo, con PnL neto después del cierre. Las tarifas son supuestos editables.

Para comparar movimientos recientes con una entrada actual, se trasladan los
retornos de ventanas históricas no solapadas al precio de entrada. La grilla
y el tamaño por orden se mantienen iguales. Se aplica el funding histórico
de cada ventana. Esto responde a «qué habría pasado si los movimientos de
estas ventanas se repitieran ahora»; no predice su probabilidad futura.

Se consulta precio negociado para fills y marca para valorar el PnL si se elige
`price_basis: mark`. Los disparadores no incluyen el coste futuro de cierre;
el resultado final sí. Escenarios de movimiento continuo suponen marca = último.
Las cotas por precio dependen de la trayectoria: son escenarios, no equivalencias
universales entre precio y ROI.

El modelo es deliberadamente pequeño: lotes independientes entre niveles
adyacentes, fills ideales entre cierres de un minuto. Las ventas de inventario
inicial no se cuentan como ciclos nuevos. No se modelan colas, ejecuciones
parciales, liquidaciones ni drawdown intraminuto. La distribución del inventario
inicial es aproximada; Binance puede usar otra. Neutral es una aproximación
por debajo/encima del precio inicial, sin inventario al arrancar.

Las frecuencias incluyen denominador y una banda Wilson descriptiva. Una muestra
de pocos días y mercados cambiantes no proporciona probabilidades calibradas.
Compara también peor resultado, drawdown y expiraciones: acertar el objetivo
en algún momento no significa alcanzarlo antes del stop.

No se guardan históricos. Para conservar únicamente un resultado puntual:

```sh
python3 scripts/grid_check.py scripts/grid_btw.json --output /tmp/grid-result.json
```

Pruebas de contabilidad de inventario, costes, precio de referencia y salidas:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts -p 'test_grid_check.py'
```

Referencias: [grid de Binance](https://www.binance.com/en-AU/support/faq/detail/f4c453bab89648beb722aa26634120c3)
y [datos públicos USD-M](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Kline-Candlestick-Data).
