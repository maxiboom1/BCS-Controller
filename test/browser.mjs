import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { chromium } from 'playwright'
import { createApp } from '../server/app.ts'
import { hashPassword } from '../server/auth.ts'
import { Store } from '../server/db.ts'
import { Router } from '../server/router.ts'
import { simulatedDestinations, simulatedSources, startSimulator } from '../server/simulator.ts'

const secret = 'browser-only-simulator-password'
const screenshotDir = process.env.BCS_SCREENSHOT_DIR

test('desktop and touch pilot workflows', { timeout: 60_000 }, async () => {
  const extraNames = label => Array.from({ length: 60 }, (_, index) => `${label} ${index + 1}`)
  const simulator = await startSimulator({ sources: [...simulatedSources, ...extraNames('Input')],
    destinations: [...simulatedDestinations, ...extraNames('Output')] })
  const db = new Store(':memory:')
  const router = new Router({ ...simulator, mode: 'simulator', selectedLevels: true })
  const origins = []
  const app = await createApp({ db, router, origins, catalogueKey: 'browser-test' })
  let browser
  try {
    db.saveUser({ username: 'admin', password: await hashPassword(secret), enabled: true, panelIds: [] }, undefined, 'admin')
    const origin = await app.listen({ host: '127.0.0.1', port: 0 })
    origins.push(origin)
    browser = await chromium.launch({ channel: process.env.BCS_BROWSER_CHANNEL || 'chrome', headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] })
    if (screenshotDir) await mkdir(screenshotDir, { recursive: true })
    async function screenshot(page, name) {
      if (screenshotDir) await page.screenshot({ path: join(screenshotDir, name) })
    }
    async function login(page, username, path = '/') {
      await page.goto(origin + path)
      await page.getByLabel('Username', { exact: true }).fill(username)
      await page.getByLabel('Password', { exact: true }).fill(secret)
      await page.getByRole('button', { name: 'Sign in', exact: true }).click()
      await page.getByRole('button', { name: 'Sign out', exact: true }).waitFor()
    }
    const admin = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const errors = []
    admin.on('pageerror', error => errors.push(error.message))
    await login(admin, 'admin', '/admin')
    await admin.getByRole('button', { name: 'Router', exact: true }).click()
    await admin.getByRole('button', { name: 'Connect', exact: true }).click()
    await admin.getByText('Connected', { exact: true }).first().waitFor()
    await admin.getByRole('button', { name: 'Sources', exact: true }).click()
    for (const [source, alias] of [['CAM 2', 'Interview'], ['PLAYBACK', 'Deck A']]) {
      const edit = admin.getByRole('button', { name: 'Edit alias for ' + source, exact: true })
      await edit.click()
      await admin.getByLabel('Alias for ' + source, { exact: true }).fill(alias)
      await admin.getByRole('button', { name: 'Save', exact: true }).click()
      await edit.waitFor()
    }
    await screenshot(admin, 'admin-sources.png')

    await admin.getByRole('button', { name: 'Panels', exact: true }).click()
    async function panel(name, staged) {
      await admin.getByRole('button', { name: 'New panel', exact: true }).click()
      await admin.getByLabel('Panel name', { exact: true }).fill(name)
      if (!staged) {
        await admin.getByLabel('Use TAKE', { exact: true }).uncheck()
        await admin.getByLabel('All levels', { exact: true }).uncheck()
        await admin.locator('[aria-label="Available levels"]').getByRole('button', { name: 'VID', exact: true }).click()
      }
      for (const label of ['CAM 1', 'Interview', 'CAM 3']) {
        await admin.locator('[aria-label="Available sources"]').getByRole('button', { name: label, exact: true }).click()
      }
      for (const label of ['PROGRAM', 'STUDIO MON', 'SPARE']) {
        await admin.locator('[aria-label="Available destinations"]').getByRole('button', { name: label, exact: true }).click()
      }
      await admin.getByRole('button', { name: 'Save panel', exact: true }).click()
      await admin.getByRole('cell', { name, exact: true }).waitFor()
    }
    db.savePanel({ name: 'Large panel', sources: router.catalogue.sources, destinations: router.catalogue.destinations,
      levels: null, columns: 6, useTake: true }, undefined, router.catalogue.levels)
    await panel('Main routing', true)
    await panel('Video only', false)
    await screenshot(admin, 'admin-panels.png')
    await admin.getByRole('button', { name: 'Users', exact: true }).click()
    await admin.getByRole('button', { name: 'New user', exact: true }).click()
    await admin.getByLabel('Username', { exact: true }).fill('operator')
    await admin.getByLabel('Password', { exact: true }).fill(secret)
    await admin.getByLabel('Main routing', { exact: true }).check()
    await admin.getByLabel('Video only', { exact: true }).check()
    await admin.getByLabel('Large panel', { exact: true }).check()
    await admin.getByRole('button', { name: 'Save user', exact: true }).click()
    await admin.getByRole('button', { name: 'Edit user operator', exact: true }).waitFor()

    const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const touch = await browser.newPage({ viewport: { width: 1024, height: 768 }, hasTouch: true })
    const picker = page => page.getByRole('combobox', { name: 'Routing panel' })
    const selectPanel = (page, label) => picker(page).selectOption({ label })
    const popup = page => page.getByRole('region', { name: 'Routing levels for STUDIO MON', exact: true })
    const studioMix = page => page.getByRole('button', { name: 'Mixed levels for STUDIO MON', exact: true })
    const readout = page => page.locator('.status-readback')
    const feedback = page => page.locator('.status-feedback')
    const gridBounds = async page => Promise.all((await page.locator('.grid-section').all()).map(grid => grid.boundingBox()))
    for (const page of [desktop, touch]) {
      page.on('pageerror', error => errors.push(error.message))
      await login(page, 'operator')
      assert.deepEqual(await picker(page).locator('option').allTextContents(), ['Large panel', 'Main routing', 'Video only'])
      assert.equal(await picker(page).locator('option:checked').textContent(), 'Large panel')
      const take = await page.getByRole('button', { name: 'TAKE', exact: true }).boundingBox()
      assert.ok(take && take.y + take.height < page.viewportSize().height)
      const grids = page.locator('.route-grid')
      const bounds = await picker(page).boundingBox()
      assert.ok(bounds && Math.abs(bounds.x + bounds.width / 2 - page.viewportSize().width / 2) < 1)
      for (const grid of await grids.all()) {
        assert.ok(await grid.evaluate(element => element.scrollHeight > element.clientHeight))
      }
      await grids.nth(0).evaluate(element => { element.scrollTop = 150 })
      assert.equal(await grids.nth(0).evaluate(element => element.scrollTop), 150)
      assert.equal(await grids.nth(1).evaluate(element => element.scrollTop), 0)
      await grids.nth(1).evaluate(element => { element.scrollTop = 150 })
      assert.equal(await grids.nth(0).evaluate(element => element.scrollTop), 150)
      assert.equal(await grids.nth(1).evaluate(element => element.scrollTop), 150)
      assert.deepEqual(await page.getByRole('button', { name: 'TAKE', exact: true }).boundingBox(), take)
      await screenshot(page, page === desktop ? 'operator-large-desktop.png' : 'operator-large-touch.png')

      await selectPanel(page, 'Main routing')
      if (page === desktop) await studioMix(page).hover()
      else await studioMix(page).tap()
      await popup(page).getByText('A1–4', { exact: true }).waitFor()
      assert.equal(await popup(page).getByText('Deck A', { exact: true }).count(), 2)
      assert.equal(await popup(page).getByText('A5–16', { exact: true }).count(), 1)
      assert.equal(await popup(page).getByText('GRAPHICS', { exact: true }).count(), 1)
      assert.equal(await page.getByRole('button', { name: 'STUDIO MON', exact: true }).getAttribute('aria-pressed'), 'false')
      assert.equal(simulator.controls.takes, 0)
      await screenshot(page, page === desktop ? 'operator-mix-desktop.png' : 'operator-mix-touch.png')
      if (page === desktop) {
        await page.keyboard.press('Escape')
        await popup(page).waitFor({ state: 'hidden' })
        await page.mouse.move(2, 2)
        await page.getByRole('button', { name: 'STUDIO MON', exact: true }).focus()
        await page.keyboard.press('Tab')
        await popup(page).waitFor()
        await page.keyboard.press('Escape')
      } else await page.getByRole('heading', { name: 'Sources', exact: true }).tap()
      await popup(page).waitFor({ state: 'hidden' })
      await page.getByRole('button', { name: 'PROGRAM', exact: true }).click()
      await page.locator('.route-key.routed').getByText('CAM 1', { exact: true }).waitFor()
    }
    const initialBounds = await gridBounds(desktop)
    const sourceKey = desktop.getByRole('button', { name: 'Interview', exact: true })
    await sourceKey.focus()
    await desktop.keyboard.press('Space')
    assert.equal(simulator.controls.takes, 0)
    await screenshot(desktop, 'operator-staged.png')
    await desktop.getByRole('button', { name: 'TAKE', exact: true }).click()
    await feedback(desktop).getByText('Verifying TAKE…', { exact: true }).waitFor()
    assert.deepEqual(await gridBounds(desktop), initialBounds)
    await feedback(desktop).getByText('TAKE confirmed', { exact: true }).waitFor()
    assert.deepEqual(await gridBounds(desktop), initialBounds)
    await touch.locator('.route-key.routed').getByText('Interview', { exact: true }).waitFor()
    await screenshot(touch, 'operator-touch.png')
    const target = await touch.getByRole('button', { name: 'CAM 3', exact: true }).boundingBox()
    assert.ok(target && target.height >= 44 && target.width >= 44)

    await selectPanel(touch, 'Video only')
    assert.equal(await touch.getByRole('button', { name: 'TAKE', exact: true }).count(), 0)
    await studioMix(touch).tap()
    await popup(touch).getByText('A5–16', { exact: true }).waitFor()
    await touch.getByRole('button', { name: 'STUDIO MON', exact: true }).tap()
    await readout(touch).filter({ hasText: 'STUDIO MON · Routed from Deck A · outside panel' }).waitFor()
    await touch.getByRole('button', { name: 'PROGRAM', exact: true }).tap()
    await touch.getByRole('button', { name: 'CAM 3', exact: true }).tap()
    await feedback(touch).getByText('TAKE confirmed', { exact: true }).waitFor()
    await touch.locator('.route-key.routed').getByText('CAM 3', { exact: true }).waitFor()
    await touch.getByRole('button', { name: 'Mixed levels for PROGRAM', exact: true }).waitFor()
    await readout(desktop).filter({ hasText: 'PROGRAM · Mixed' }).waitFor()
    assert.equal(router.routes.get('0000').levels['01'].sourceId, '0001')

    await desktop.getByRole('button', { name: 'CAM 1', exact: true }).click()
    simulator.externalTake(0, 3, 0)
    await feedback(desktop).getByText('Routing changed. Select a source again.', { exact: true }).waitFor()
    assert.deepEqual(await gridBounds(desktop), initialBounds)
    assert.ok(await desktop.getByRole('button', { name: 'TAKE', exact: true }).isDisabled())
    await desktop.getByRole('button', { name: 'SPARE', exact: true }).click()
    await readout(desktop).filter({ hasText: 'SPARE · No crosspoint on one or more levels' }).waitFor()
    assert.ok(await desktop.getByRole('button', { name: 'CAM 1', exact: true }).isDisabled())
    await studioMix(touch).tap()
    await popup(touch).waitFor()
    simulator.externalTake(3, 2)
    await popup(touch).waitFor({ state: 'hidden' })
    await studioMix(touch).waitFor({ state: 'detached' })
    await touch.getByRole('button', { name: 'Mixed levels for PROGRAM', exact: true }).tap()
    await touch.getByRole('region', { name: 'Routing levels for PROGRAM', exact: true }).waitFor()
    await admin.getByRole('button', { name: 'Router', exact: true }).click()
    await admin.getByRole('button', { name: 'Disconnect', exact: true }).click()
    await touch.getByRole('region', { name: 'Routing levels for PROGRAM', exact: true }).waitFor({ state: 'hidden' })
    await touch.getByRole('button', { name: 'Mixed levels for PROGRAM', exact: true }).waitFor({ state: 'detached' })
    await touch.locator('.status-connection').getByText('Disconnected', { exact: true }).waitFor()
    await admin.getByRole('button', { name: 'Users', exact: true }).click()
    await admin.getByRole('button', { name: 'Edit user operator', exact: true }).click()
    await admin.getByLabel('Main routing', { exact: true }).uncheck()
    await admin.getByLabel('Large panel', { exact: true }).uncheck()
    await admin.getByRole('button', { name: 'Save user', exact: true }).click()
    await picker(desktop).waitFor({ state: 'detached' })
    await desktop.getByRole('button', { name: 'CAM 1', exact: true }).waitFor()
    assert.equal(await desktop.getByRole('button', { name: 'TAKE', exact: true }).count(), 0)
    assert.deepEqual(errors, [])
  } finally {
    await browser?.close()
    await app.close()
    await simulator.close()
    db.sql.close()
  }
})

