/**
 * The unified diffs the `full` scenario reports.
 *
 * One `diff.reported` event carries exactly one repository file, so a change
 * that touches four files produces four events sharing a `changeId`. Three of
 * the five below share `change-2026-08-04-0007`, which is what the component
 * inspector groups on.
 *
 * The diffs are plausible but invented: v0 has no repository access, and the
 * contract states explicitly that `unifiedDiff` is taken as reported.
 */

export interface DiffFile {
  diffId: string
  /** Omitted for a change the agent made without planning it first. */
  changeId?: string
  componentIds: string[]
  filePath: string
  unifiedDiff: string
}

export const CHANGE_IDS = {
  addTax: 'change-2026-08-04-0007',
  linkPricingToTax: 'change-2026-08-04-0008',
  dropLegacyTaxRates: 'change-2026-08-04-0009',
  dropLegacyTaxDependency: 'change-2026-08-04-0010',
  notificationsReadsOrders: 'change-2026-08-04-0011',
  addRounding: 'change-2026-08-04-0012',
  linkTaxToRounding: 'change-2026-08-04-0013',
} as const

export const PRICING_DIFF: DiffFile = {
  diffId: 'diff-2026-08-04-0011',
  changeId: CHANGE_IDS.addTax,
  componentIds: ['shop-platform.orders.domain.pricing'],
  filePath: 'internal/orders/domain/pricing/pricing.go',
  unifiedDiff: [
    '--- a/internal/orders/domain/pricing/pricing.go',
    '+++ b/internal/orders/domain/pricing/pricing.go',
    '@@ -1,8 +1,9 @@',
    ' package pricing',
    ' ',
    ' import (',
    '-\t"shop-platform/internal/orders/domain/legacy"',
    '+\t"shop-platform/internal/orders/domain/tax"',
    ' \t"shop-platform/internal/shared/money"',
    ' )',
    ' ',
    ' // Pricing turns an order into the amount the customer owes.',
    '@@ -18,11 +19,10 @@ func (p *Pricing) Total(order Order) money.Amount {',
    ' \tsum := money.Zero(order.Currency)',
    ' \tfor _, line := range order.Lines {',
    ' \t\tsum = sum.Add(line.Net)',
    ' \t}',
    '-',
    '-\tvat := sum.MultiplyFloat(legacy.RateDE)',
    '-\tsum = sum.Add(vat)',
    '-',
    '-\treturn sum.Sub(p.discountFor(order))',
    '+\tdiscounted := sum.Sub(p.discountFor(order))',
    '+\tvat := tax.For(order.DeliveryCountry).Apply(discounted)',
    '+',
    '+\treturn discounted.Add(vat)',
    ' }',
    '',
  ].join('\n'),
}

export const TAX_DIFF: DiffFile = {
  diffId: 'diff-2026-08-04-0012',
  changeId: CHANGE_IDS.addTax,
  componentIds: ['shop-platform.orders.domain.tax'],
  filePath: 'internal/orders/domain/tax/tax.go',
  unifiedDiff: [
    '--- /dev/null',
    '+++ b/internal/orders/domain/tax/tax.go',
    '@@ -0,0 +1,32 @@',
    '+// Package tax owns the VAT rules that used to sit inside pricing.',
    '+package tax',
    '+',
    '+import "shop-platform/internal/shared/money"',
    '+',
    '+// Rate is the VAT rate of exactly one delivery country.',
    '+type Rate struct {',
    '+\tCountry string',
    '+\tPercent float64',
    '+}',
    '+',
    '+var rates = map[string]Rate{',
    '+\t"DE": {Country: "DE", Percent: 19},',
    '+\t"AT": {Country: "AT", Percent: 20},',
    '+\t"CH": {Country: "CH", Percent: 8.1},',
    '+}',
    '+',
    '+// fallback keeps an unknown country explicit instead of silently untaxed.',
    '+var fallback = Rate{Country: "", Percent: 19}',
    '+',
    '+// For returns the rate of a delivery country.',
    '+func For(country string) Rate {',
    '+\tif rate, ok := rates[country]; ok {',
    '+\t\treturn rate',
    '+\t}',
    '+\treturn fallback',
    '+}',
    '+',
    '+// Apply returns the VAT owed on a net amount, rounded once, per order.',
    '+func (r Rate) Apply(net money.Amount) money.Amount {',
    '+\treturn net.MultiplyFloat(r.Percent / 100).RoundHalfUp()',
    '+}',
    '',
  ].join('\n'),
}

export const TAX_TEST_DIFF: DiffFile = {
  diffId: 'diff-2026-08-04-0013',
  changeId: CHANGE_IDS.addTax,
  componentIds: ['shop-platform.orders.domain.tax'],
  filePath: 'internal/orders/domain/tax/tax_test.go',
  unifiedDiff: [
    '--- /dev/null',
    '+++ b/internal/orders/domain/tax/tax_test.go',
    '@@ -0,0 +1,24 @@',
    '+package tax_test',
    '+',
    '+import (',
    '+\t"testing"',
    '+',
    '+\t"shop-platform/internal/orders/domain/tax"',
    '+\t"shop-platform/internal/shared/money"',
    '+)',
    '+',
    '+func TestApplyRoundsOncePerOrder(t *testing.T) {',
    '+\tcases := map[string]string{',
    '+\t\t"DE": "19.00",',
    '+\t\t"AT": "20.00",',
    '+\t\t"CH": "8.10",',
    '+\t\t"XX": "19.00",',
    '+\t}',
    '+\tfor country, want := range cases {',
    '+\t\tgot := tax.For(country).Apply(money.MustParse("EUR", "100.00"))',
    '+\t\tif got.String() != want {',
    '+\t\t\tt.Fatalf("%s: got %s, want %s", country, got, want)',
    '+\t\t}',
    '+\t}',
    '+}',
    '',
  ].join('\n'),
}

export const LEGACY_REMOVAL_DIFF: DiffFile = {
  diffId: 'diff-2026-08-04-0014',
  changeId: CHANGE_IDS.dropLegacyTaxRates,
  componentIds: ['shop-platform.orders.domain.legacy-tax-rates'],
  filePath: 'internal/orders/domain/legacy/tax_rates.go',
  unifiedDiff: [
    '--- a/internal/orders/domain/legacy/tax_rates.go',
    '+++ /dev/null',
    '@@ -1,12 +0,0 @@',
    '-// Package legacy holds the hard-coded VAT table.',
    '-//',
    '-// Deprecated: superseded by internal/orders/domain/tax.',
    '-package legacy',
    '-',
    '-// RateDE is the German VAT rate as a multiplier.',
    '-const RateDE = 0.19',
    '-',
    '-// RateFor is the single-country stand-in the pricing module used to call.',
    '-func RateFor(string) float64 {',
    '-\treturn RateDE',
    '-}',
    '',
  ].join('\n'),
}

export const NOTIFICATIONS_DIFF: DiffFile = {
  diffId: 'diff-2026-08-04-0015',
  // No changeId: an unplanned fix the implementer made while reading the topic
  // wiring. The inspector must show it ungrouped next to the grouped ones.
  componentIds: ['shop-platform.notifications'],
  filePath: 'internal/notifications/consumer.go',
  unifiedDiff: [
    '--- a/internal/notifications/consumer.go',
    '+++ b/internal/notifications/consumer.go',
    '@@ -27,7 +27,11 @@ func (c *Consumer) Start(ctx context.Context) error {',
    ' \t\treturn fmt.Errorf("subscribe %s: %w", topicOrderCreated, err)',
    ' \t}',
    ' ',
    '-\tc.total = c.total.Add(msg.Order.Gross)',
    '+\t// The gross total moved behind the tax module, so the mail template has',
    '+\t// to read the field the order actually publishes now.',
    '+\tc.total = c.total.Add(msg.Order.Total)',
    '+\tc.vat = c.vat.Add(msg.Order.Vat)',
    '+',
    ' \treturn nil',
    ' }',
    '',
  ].join('\n'),
}

export const ALL_DIFFS: DiffFile[] = [
  PRICING_DIFF,
  TAX_DIFF,
  TAX_TEST_DIFF,
  LEGACY_REMOVAL_DIFF,
  NOTIFICATIONS_DIFF,
]
