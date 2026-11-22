import { test, expect } from '@playwright/test';

test('Atlas German definitions appear in the Mac popup, saved snapshot and search', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => (window as unknown as { eval(s: string): Promise<void> }).eval(`openLookup({text:'日本語',lemma:'日本語',reading:'にほんご',grammar:[],pos:'noun'},true)`));
  await expect(page.locator('#definitions')).toContainText(/Japanisch|japanisch/);
  await expect(page.locator('#definitions .dictionarySense p').first()).toBeInViewport();
  const installed = await (await page.request.get('/api/desktop/dictionary-update')).json();
  await expect(page.locator('#definitions')).toContainText('Kotoba Atlas · ' + installed.current + ' · Deutsch');
  const meaning = await page.evaluate(() => (window as unknown as { eval(s: string): string }).eval('lookupWordRecord().meaning'));
  expect(meaning).toMatch(/Japanisch|japanisch/);
  await page.screenshot({ path: 'work/atlas-mac-lookup.png' });
  await page.locator('#closeLookup').click();
  await page.getByRole('button', { name: 'Words', exact: true }).click();
  await page.getByLabel('Search dictionary').fill('Katze');
  await expect(page.locator('.dictionaryResult').first()).toContainText(/Katze/);
});

test('legacy English entries remain readable when no preferred definitions are supplied', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => (window as unknown as { eval(s: string): void }).eval(`lookupEntries=[{slug:'legacy',source:'JMdict',japanese:[{word:'猫',reading:'ねこ'}],senses:[{english_definitions:['cat'],parts_of_speech:['noun']}]}];renderDefinitions();document.getElementById('lookup').classList.add('show');`));
  await expect(page.locator('#definitions')).toContainText('cat');
  await expect(page.locator('#definitions')).not.toContainText('noun');
  await page.evaluate(()=>(window as any).eval('extras.dictionaryDetails=true;renderDefinitions();'));
  await expect(page.locator('#definitions')).toContainText('noun');
});
