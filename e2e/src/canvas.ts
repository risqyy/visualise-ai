import { expect, type Page } from '@playwright/test'

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
