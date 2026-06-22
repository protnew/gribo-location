import { test, expect } from '@playwright/test';

test.describe('Offline Sync Queue', () => {
  test('Mushroom stays in sync queue when offline, flushes when online', async ({ page, context }) => {
    await page.goto('/');

    // Ждем инициализации
    await page.waitForFunction(() => window.deviceId !== null && window.deviceId !== undefined);

    // 1. Отключаем интернет (Playwright Offline Mode)
    await context.setOffline(true);

    // 2. Добавляем гриб через evaluate, так как это проще
    await page.evaluate(() => {
      window.addMushroom(53.9, 27.5, 'click', 'white', false);
    });

    // 3. Проверяем localStorage, гриб должен быть там, synced: false
    const syncedState = await page.evaluate(() => {
      return window.S.mushrooms;
    });

    expect(syncedState.length).toBeGreaterThan(0);
    expect(syncedState[0].synced).toBe(false);

    // 4. Включаем интернет
    await context.setOffline(false);

    // 5. Запускаем syncData принудительно (он так-то вызывается раз в 60 сек)
    await page.evaluate(async () => {
      await window.syncData();
    });

    // 6. Проверяем, что гриб стал synced: true
    const postSyncState = await page.evaluate(() => {
      return window.S.mushrooms;
    });

    expect(postSyncState[0].synced).toBe(true);
  });
});
