/**
 * The markdown bodies the reviewer publishes.
 *
 * Real markdown, not a placeholder string: headings, ordered and unordered
 * lists, inline code and a fenced code block, so the inspector's renderer is
 * actually exercised. Both bodies are agent statements — the cockpit never
 * judges the work itself.
 */

const FENCE = '```'

export const PRICING_TAX_FEEDBACK = [
  '## What I looked at',
  '',
  'The extraction of VAT handling out of `pricing` into the new `tax` module,',
  'including `Pricing.Total` and the new `tax.Rate.Apply`.',
  '',
  '## What stands out',
  '',
  '1. **The order of operations changed.** The old code added VAT to the net sum',
  '   and subtracted the discount afterwards. The new code discounts first and',
  '   taxes the discounted amount. For percentage discounts both are defensible,',
  '   but they are not the same number.',
  '2. **Rounding is now stated once.** `Apply` calls `RoundHalfUp()` on the whole',
  '   order rather than per line. That is the behaviour the test pins down.',
  '3. **The fallback rate is silent.** An unknown delivery country falls back to',
  '   19 %, which is correct for Germany and wrong everywhere else.',
  '',
  '## Suggestion',
  '',
  'Make the sequence explicit at the call site and keep the table test next to it:',
  '',
  FENCE + 'go',
  'net := order.NetTotal()',
  'discounted := net.Sub(p.discountFor(order))',
  'total := discounted.Add(tax.For(order.DeliveryCountry).Apply(discounted))',
  FENCE,
  '',
  '- [x] rounding rule documented',
  '- [ ] fallback country decided',
  '',
  'This is a reported observation, not a measured defect.',
  '',
].join('\n')

export const NOTIFICATIONS_FEEDBACK = [
  '## Second consumer of `orders.order.created`',
  '',
  'The notification service subscribes to the same topic as inventory. Both edges',
  'are modelled separately on purpose — they fail independently.',
  '',
  '### What changed',
  '',
  '- `msg.Order.Gross` no longer exists; the consumer reads `Total` and `Vat`.',
  '- The mail template still prints a single amount, so the split is invisible to',
  '  the customer for now.',
  '',
  '### What to watch',
  '',
  '| Field | Before | After |',
  '| --- | --- | --- |',
  '| `Total` | net + VAT | discounted + VAT |',
  '| `Vat` | not published | published per order |',
  '',
  'Replaying an event from before the change through the new consumer would read',
  'a zero `Vat`. Nothing in this run verified that path.',
  '',
].join('\n')
