import unittest
from grid_check import Grid, simulate, directional_target, validate


def config(**changes):
    c = dict(symbol='TESTUSDT', direction='long', lower=90., upper=110., grids=2,
             margin=10., leverage=30., qty_per_order=1., hours=8., days=3.,
             spacing='arithmetic', price_basis='mark', maker_fee_pct=0.,
             taker_fee_pct=0., market_slippage_pct=0., tp_roi=10., sl_roi=10.,
             targets_roi=[5., 10.])
    c.update(changes)
    return c


class GridTests(unittest.TestCase):
    def test_long_inventory_and_completed_cycle(self):
        g = Grid(config(), 100.)
        self.assertEqual(g.initial_qty, 1.)
        self.assertEqual(g.step(90.), -10.)
        self.assertEqual(g.position(), 2.)
        self.assertEqual(g.step(110.), 20.)
        self.assertEqual(g.position(), 0.)
        self.assertEqual(g.cycles, 1)

    def test_inventory_sale_does_not_count_as_new_cycle(self):
        g = Grid(config(), 100.)
        self.assertEqual(g.step(110.), 10.)
        self.assertEqual(g.cycles, 0)

    def test_short_direction(self):
        g = Grid(config(direction='short'), 100.)
        self.assertEqual(g.initial_qty, -1.)
        self.assertEqual(g.step(90.), 10.)
        self.assertEqual(g.position(), 0.)

    def test_neutral_does_not_start_long_inventory(self):
        g = Grid(config(direction='neutral'), 100.)
        self.assertEqual(g.initial_qty, 0.)
        g.step(90.)
        self.assertEqual(g.position(), 1.)
        self.assertEqual(g.step(110.), 10.)
        self.assertEqual(g.position(), -1.)

    def test_stop_order_is_not_just_terminal_roi(self):
        r = simulate(config(), [(0,99.,99.), (60000,110.,110.)], 100.)
        self.assertEqual(r['reason'], 'SL')
        self.assertEqual(r['net_pnl'], -1.)
        self.assertEqual(r['minutes'], 1)

    def test_mark_basis_can_trigger_before_last(self):
        r = simulate(config(), [(0,100.,99.)], 100.)
        self.assertEqual(r['reason'], 'SL')
        self.assertEqual(r['net_pnl'], 0.)  # Executable last differs from reference.

    def test_fees_funding_and_market_close(self):
        g = Grid(config(maker_fee_pct=.1, taker_fee_pct=.1), 100.)
        pnl = g.step(100., 100., .01)
        self.assertAlmostEqual(pnl, -1.1)
        self.assertAlmostEqual(g.close_pnl(100.), -1.2)
        self.assertAlmostEqual(g.funding, -1.)

    def test_leverage_is_not_applied_twice(self):
        a = simulate(config(leverage=20), [(0,110.,110.)], 100., use_stops=False)
        b = simulate(config(leverage=30), [(0,110.,110.)], 100., use_stops=False)
        self.assertEqual(a['roi'], b['roi'])

    def test_profit_saturates_after_inventory_is_sold(self):
        g = Grid(config(), 100.)
        g.step(110.)
        self.assertEqual(g.step(150.), 10.)
        self.assertIsNone(directional_target(config(targets_roi=[150]), 100., 150.))

    def test_invalid_inputs_are_rejected(self):
        for changes in ({'lower':120.}, {'grids':0}, {'maker_fee_pct':-1}, {'qty_per_order':0}):
            with self.assertRaises(ValueError):
                validate(config(**changes))


if __name__ == '__main__':
    unittest.main()
