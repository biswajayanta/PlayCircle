import { expect, test } from '@playwright/test';
import { testEmail } from './helpers';

test('create a circle, create a game with no format picker, and join it', async ({ page }) => {
  const email = testEmail('circlegame');

  await page.goto('/');
  await page.getByText('Create an account').click();
  await page.getByPlaceholder('Your name').fill('Circle Game E2E');
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Password (min 8 characters)').fill('e2etestpass123');
  await page.getByText('Create Account', { exact: true }).click();
  await expect(page.getByText('Circle Game E2E', { exact: false })).toBeVisible({
    timeout: 10_000,
  });

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

  // Venue is now a real <select> dropdown, not clickable text rows —
  // selectOption is the correct Playwright API for a native select, a
  // .click() on the option text won't work while the dropdown is closed.
  await page.locator('select').selectOption({ label: 'HSR Layout Pickleball Courts' });

  const dateInput = page.locator('input[type="date"]');
  const timeInput = page.locator('input[type="time"]');
  await dateInput.fill('2026-12-15');
  await timeInput.fill('18:00');
  await page.getByText('Create', { exact: true }).last().click();
  await page.waitForTimeout(1200);

  // The creator auto-joins — no capacity/format text anywhere.
  await expect(page.getByText('joined', { exact: false })).toBeVisible();
});
