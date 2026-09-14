import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Opens every collapsed container of the architecture canvas.
 *
 * A project opens on its system and container level with deeper containers
 * collapsed, so that a model of thirty-odd components is readable at the
 * resolution this suite accepts at (issue #34, ADR 0017). "Gesamtkarte" is the
 * explicit spatial action that undoes it — the same button a
 * user presses — so assertions about components three and four levels down go
 * through it rather than around it.
 *
 * Waits for the re-layout, because expanding changes the ELK input.
 */
export async function showWholeModel(page: Page): Promise<void> {
  const canvas = page.getByTestId('architecture-canvas')
  await expect(canvas).toBeVisible()
  await page.getByTestId('canvas-fit-view').click()
  await expect(canvas).toHaveAttribute('data-hidden-node-count', '0')
  await expect(canvas).toHaveAttribute('data-layouting', 'false')
}

/** Bring a graph target into view through real middle-button pans, preserving zoom.
 * A readable canvas can extend beyond the pane, and collision-free labels can
 * sit outside the node bounds used by Fit. Never bypass that with a forced click.
 * The middle button also pans over compound backgrounds without dragging nodes.
 */
export async function panIntoCanvas(page: Page, target: Locator): Promise<void> {
  const viewport = page.locator('.react-flow__viewport')
  async function settled() {
    let previous = '', matches = 0
    await expect.poll(async () => {
      const current = await viewport.getAttribute('style') ?? ''
      matches = current === previous ? matches + 1 : 0
      previous = current
      return matches
    }, { intervals: [100] }).toBeGreaterThanOrEqual(2)
  }
  await expect(target).toBeAttached()
  await settled()
  const canvas = page.getByTestId('architecture-canvas')
  const zoom = await canvas.getAttribute('data-canvas-zoom')
  const nodePositions = () => page.locator('.react-flow__node').evaluateAll((nodes) => nodes.map((node) => [node.getAttribute('data-id'), (node as HTMLElement).style.transform]))
  const positionsBefore = await nodePositions()
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const movement = await target.evaluate((element) => {
      const pane = document.querySelector('.react-flow__pane')
      if (!pane) throw new Error('React Flow pane is missing')
      const bounds = pane.getBoundingClientRect()
      const box = element.getBoundingClientRect()
      // Leave room for toolbar and border controls around the drawing surface.
      const inset = 48
      const left = bounds.left + inset, right = bounds.right - inset
      const toolbarBottom = document.querySelector('.canvas-toolbar')?.getBoundingClientRect().bottom ?? bounds.top
      const top = Math.max(bounds.top + inset, toolbarBottom + 16), bottom = bounds.bottom - inset
      if (box.left >= left && box.right <= right && box.top >= top && box.bottom <= bottom) return { done: true } as const
      if (box.width > right - left || box.height > bottom - top) throw new Error('Target is larger than the drawable canvas at the current zoom')
      const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value))
      const dx = box.left < left || box.right > right ? clamp((left + right - box.left - box.right) / 2, -bounds.width / 2, bounds.width / 2) : 0
      const dy = box.top < top || box.bottom > bottom ? clamp((top + bottom - box.top - box.bottom) / 2, -bounds.height / 2, bounds.height / 2) : 0
      const candidates = []
      for (let row = 0; row <= 8; row += 1) {
        for (let column = 0; column <= 8; column += 1) {
          const start = { x: bounds.left + 16 + (bounds.width - 32) * column / 8, y: bounds.top + 16 + (bounds.height - 32) * row / 8 }
          const hit = document.elementFromPoint(start.x, start.y)
          if (hit?.closest('.react-flow__pane') !== pane || hit.closest('.react-flow__panel, .react-flow__controls, .react-flow__minimap, .react-flow__attribution, button, a, input')) continue
          const end = { x: clamp(start.x + dx, bounds.left + 16, bounds.right - 16), y: clamp(start.y + dy, bounds.top + 16, bounds.bottom - 16) }
          candidates.push({ start, end, progress: Math.abs(end.x - start.x) + Math.abs(end.y - start.y) })
        }
      }
      candidates.sort((a, b) => b.progress - a.progress)
      const pan = candidates[0]
      if (!pan || pan.progress < 1) throw new Error('No canvas point outside controls is available for a pointer pan')
      return { done: false, start: pan.start, end: pan.end } as const
    })
    if (movement.done) return
    const before = await viewport.getAttribute('style')
    await page.mouse.move(movement.start.x, movement.start.y)
    await page.mouse.down({ button: 'middle' })
    await page.mouse.move(movement.end.x, movement.end.y, { steps: 8 })
    await page.mouse.up({ button: 'middle' })
    await expect.poll(() => viewport.getAttribute('style')).not.toBe(before)
    await settled()
    await expect(canvas).toHaveAttribute('data-canvas-zoom', zoom ?? '')
    expect(await nodePositions(), 'panning must not drag architecture components').toEqual(positionsBefore)
  }
  throw new Error('Target remains outside the drawable canvas after 12 pointer pans')
}
