import { expect, test } from '@playwright/test';
import { testEmail } from './helpers';

async function signUp(page: import('@playwright/test').Page, name: string, email: string) {
  await page.goto('/');
  await page.getByText('Create an account').click();
  await page.getByPlaceholder('Your name').fill(name);
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Password (min 8 characters)').fill('e2etestpass123');
  await page.getByText('Create Account', { exact: true }).click();
  await expect(page.getByText(name, { exact: false })).toBeVisible({ timeout: 10_000 });
}

test('create a circle, create a game with no format picker, and join it', async ({ page }) => {
  const email = testEmail('circlegame');
  await signUp(page, 'Circle Game E2E', email);

  const circleName = `E2E Circle ${Date.now()}`;
  await page.getByPlaceholder('New circle name').fill(circleName);
  await page.getByText('Create', { exact: true }).click();
  await page.waitForTimeout(1000);
  await page.getByText(circleName, { exact: true }).click();
  await page.waitForTimeout(1000);

  await page.getByText('+ New Game', { exact: true }).click();
  await page.waitForTimeout(500);

  // No format picker should exist anymore — format moved to match creation.
  await expect(page.getByText('Format', { exact: true })).not.toBeVisible();

  await page.getByText('HSR Layout Pickleball Courts', { exact: true }).first().click();
  const dateInput = page.locator('input[type="datetime-local"]');
  await dateInput.fill('2026-12-15T18:00');
  await page.getByText('Create', { exact: true }).last().click();
  await page.waitForTimeout(1200);

  // The creator auto-joins — no capacity/format text anywhere.
  await expect(page.getByText('joined', { exact: false })).toBeVisible();
});
