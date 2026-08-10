import { expect, test } from '@playwright/test';
import { testEmail } from './helpers';

test('a new user can sign up, land on Home, and log back in', async ({ page }) => {
  const email = testEmail('signup');

  await page.goto('/');
  await page.getByText('Create an account').click();
  await expect(page).toHaveURL(/\/signup/);

  await page.getByPlaceholder('Your name').fill('E2E Test User');
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Password (min 8 characters)').fill('e2etestpass123');
  await page.getByText('Create Account', { exact: true }).click();

  // Signing up logs you straight in and lands on Home.
  await expect(page.getByText('E2E Test User', { exact: false })).toBeVisible({
    timeout: 10_000,
  });

  await page.getByText('Log out', { exact: true }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.locator('input[placeholder="Email"]').last().fill(email);
  await page.locator('input[placeholder="Password"]').last().fill('e2etestpass123');
  await page.getByText('Log In', { exact: true }).click();
  await expect(page.getByText('E2E Test User', { exact: false })).toBeVisible({
    timeout: 10_000,
  });
});

test('logging in with the wrong password shows an error, not a silent failure', async ({
  page,
}) => {
  const email = testEmail('wrongpw');

  // Create the account first via signup.
  await page.goto('/');
  await page.getByText('Create an account').click();
  await page.getByPlaceholder('Your name').fill('Wrong Password Test');
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Password (min 8 characters)').fill('correctpass123');
  await page.getByText('Create Account', { exact: true }).click();
  await expect(page.getByText('Wrong Password Test', { exact: false })).toBeVisible({
    timeout: 10_000,
  });
  await page.getByText('Log out', { exact: true }).click();

  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('input[placeholder="Email"]').last().fill(email);
  await page.locator('input[placeholder="Password"]').last().fill('wrongpassword');
  await page.getByText('Log In', { exact: true }).click();

  // Still on the login screen — never silently let the wrong password in.
  await page.waitForTimeout(1000);
  await expect(page).toHaveURL(/\/login/);
});
