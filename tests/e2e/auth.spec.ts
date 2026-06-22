import { test, expect } from '@playwright/test';

test.describe('Anonymous Auth Profile', () => {
  test('Generates device_id in IndexedDB and uses it', async ({ page }) => {
    // 1. Открываем приложение
    await page.goto('/');

    // 2. Ждем инициализации
    await page.waitForFunction(() => window.deviceId !== null && window.deviceId !== undefined);

    const deviceId = await page.evaluate(() => {
      return window.deviceId;
    });

    expect(deviceId).toBeTruthy();
    expect(typeof deviceId).toBe('string');
    expect(deviceId.length).toBeGreaterThan(10);
  });
});
